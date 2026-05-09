import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { NOTIFY, EVENT, SECTOR } from '../messages/index.js';
import { showSectorDisplay, type DisplayCtx } from '../display.js';
import { type DisplayPortCtx } from '../display-port.js';
import { showDroneEncounter, type DisplayCombatCtx } from '../display-combat.js';
import { askConfirm } from '../menus/prompts.js';
import type { Handler } from './index.js';
import { refreshMinimap, type RefreshMinimapDeps } from './utils.js';

type MovementDeps = Pick<GameContext, 'autopilot' | 'encounter' | 'input' | 'io' | 'world'> &
    DisplayCtx &
    DisplayPortCtx &
    DisplayCombatCtx &
    RefreshMinimapDeps;

export const sectorDisplay: Handler<'sectorDisplayResult', MovementDeps> = (ctx, msg) => {
    ctx.world.sectorPlayers = msg.players;
    showSectorDisplay(
        ctx,
        msg.sector,
        msg.warps,
        msg.players,
        msg.port,
        msg.sectorDrones,
        msg.planets,
        msg.ships,
        msg.collisions,
        msg.sectorMines,
    );
    refreshMinimap(ctx);
    if (ctx.autopilot.path.length > 0 && ctx.autopilot.step < ctx.autopilot.path.length) {
        const nextSector = ctx.autopilot.path[ctx.autopilot.step];
        ctx.autopilot.step = ctx.autopilot.step + 1;
        ctx.io.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
    } else if (ctx.autopilot.path.length > 0) {
        ctx.autopilot.path = [];
        ctx.autopilot.step = 0;
    }
};

export const move: Handler<'moveResult', MovementDeps> = (ctx, msg) => {
    switch (msg.outcome) {
        case 'success': {
            ctx.world.sectorPlayers = msg.players;
            const inAutopilot = ctx.autopilot.path.length > 0;
            const moreHops = inAutopilot && ctx.autopilot.step < ctx.autopilot.path.length;
            showSectorDisplay(
                ctx,
                msg.sector,
                msg.warps,
                msg.players,
                msg.port,
                msg.sectorDrones,
                msg.planets,
                msg.ships,
                msg.collisions,
                msg.sectorMines,
            );
            refreshMinimap(ctx);
            if (moreHops) {
                const nextSector = ctx.autopilot.path[ctx.autopilot.step];
                ctx.autopilot.step = ctx.autopilot.step + 1;
                ctx.io.term.writeln(render(EVENT.autopilotWarping, { sector: nextSector }));
                ctx.io.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
            } else if (inAutopilot) {
                ctx.io.term.writeln(render(EVENT.autopilotArrived, { sector: msg.sector }));
                ctx.autopilot.path = [];
                ctx.autopilot.step = 0;
            }
            break;
        }
        case 'encounter': {
            // Server stays in 'sector' location; we enter the droneEncounter
            // sub-mode here so the framework's auto-render uses the encounter
            // MenuHandler's renderPrompt (a/r prompts).
            ctx.world.mode = Menu.DroneEncounter;
            ctx.world.sectorPlayers = msg.players;
            ctx.encounter.ownerName = msg.ownerName;
            showSectorDisplay(
                ctx,
                msg.sector,
                msg.warps,
                msg.players,
                msg.port,
                msg.sectorDrones,
                msg.planets,
                msg.ships,
                msg.collisions,
                msg.sectorMines,
            );
            refreshMinimap(ctx);
            if (ctx.autopilot.path.length > 0) {
                ctx.autopilot.paused = true;
                ctx.io.term.writeln(render(EVENT.autopilotDisengaged));
            }
            const droneQty = msg.sectorDrones?.quantity ?? 0;
            showDroneEncounter(ctx, droneQty, msg.ownerName, msg.shipDrones);
            break;
        }
        case 'nonAdjacent':
            ctx.io.sendMsg({
                type: ClientMsgType.ShortestPath,
                from: ctx.world.currentSector,
                to: msg.sector,
            });
            break;
        case 'noShip':
            if (ctx.autopilot.path.length > 0) {
                ctx.autopilot.path = [];
                ctx.autopilot.step = 0;
                ctx.autopilot.paused = false;
                ctx.io.term.writeln(render(EVENT.autopilotCancelled));
            }
            ctx.io.term.writeln(render(EVENT.noShip));
            break;
        case 'destroyed':
            if (ctx.autopilot.path.length > 0) {
                ctx.autopilot.path = [];
                ctx.autopilot.step = 0;
                ctx.autopilot.paused = false;
            }
            ctx.io.term.writeln(render(EVENT.shipDestroyed, { reason: msg.reason }));
            break;
        case 'error':
            if (ctx.autopilot.path.length > 0) {
                ctx.autopilot.path = [];
                ctx.autopilot.step = 0;
                ctx.autopilot.paused = false;
                ctx.io.term.writeln(render(EVENT.autopilotCancelled));
            }
            ctx.io.term.writeln(render(NOTIFY.error, { message: msg.message }));
            break;
    }
};

export const nonAdjacent: Handler<'nonAdjacentMoveRequested', MovementDeps> = (ctx, msg) => {
    ctx.io.sendMsg({
        type: ClientMsgType.ShortestPath,
        from: ctx.world.currentSector,
        to: msg.sector,
    });
};

export const shortestPath: Handler<'shortestPathResult', MovementDeps> = (ctx, msg) => {
    if (msg.path.length <= 1) {
        ctx.io.term.writeln(render(EVENT.noPathFound));
        return;
    }
    void promptAutopilot(ctx, msg);
};

async function promptAutopilot(
    ctx: MovementDeps,
    msg: { path: { sector: number; visited: boolean }[]; hops: number; turns: number },
): Promise<void> {
    const { term } = ctx.io;
    const from = msg.path[0]?.sector ?? 0;
    const to = msg.path[msg.path.length - 1]?.sector ?? 0;
    term.writeln('');
    term.writeln(
        render(SECTOR.autopilotNotAdjacent, { hops: msg.hops, turns: msg.turns, from, to }),
    );
    const sep = render(SECTOR.autopilotPathSeparator);
    const list = msg.path
        .map((p) => render(p.visited ? SECTOR.warpVisited : SECTOR.warpUnvisited, { sector: p.sector }))
        .join(sep);
    term.writeln(`  ${list}`);

    const ok = await askConfirm(ctx, render(SECTOR.autopilotConfirm), { defaultValue: false });
    if (!ok) return;

    ctx.autopilot.path = msg.path.map((p) => p.sector);
    ctx.autopilot.step = 2;
    const nextSector = ctx.autopilot.path[1];
    term.writeln(render(NOTIFY.autopilotEngaged));
    term.writeln(render(EVENT.autopilotWarping, { sector: nextSector }));
    ctx.io.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
}

export const hyperspaceJump: Handler<'hyperspaceJumpResult', MovementDeps> = (ctx, msg) => {
    ctx.io.term.writeln(
        render(EVENT.hyperspaceJump, {
            sector: msg.targetSector,
            fuel: msg.fuelUsed,
            turns: msg.turnsUsed,
        }),
    );
    ctx.io.sendMsg({ type: ClientMsgType.SectorDisplay });
};

export const previousSector: Handler<'previousSectorResult', MovementDeps> = (ctx, msg) => {
    if (msg.sector === null) {
        ctx.io.term.writeln(render(NOTIFY.noPreviousSector));
    } else {
        ctx.io.sendMsg({ type: ClientMsgType.Move, sector: msg.sector });
    }
};

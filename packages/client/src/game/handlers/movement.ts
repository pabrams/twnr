import { ClientTag, Menu } from '@twnr/shared';
import type { TowedAlong } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { NOTIFY, EVENT, SECTOR } from '../messages/index.js';
import { showSectorDisplay, type DisplayCtx } from '../display.js';
import { type DisplayPortCtx } from '../display-port.js';
import { showDroneEncounter, type DisplayCombatCtx } from '../display-combat.js';
import { askConfirm } from '../routines/prompts.js';
import type { Handler } from './index.js';
import { refreshMinimap, type RefreshMinimapCtx } from './utils.js';

type MovementContext = Pick<
    GameContext,
    'autopilot' | 'encounter' | 'input' | 'io' | 'minimap' | 'world'
> &
    DisplayCtx &
    DisplayPortCtx &
    DisplayCombatCtx &
    RefreshMinimapCtx;

function renderTowedAlong(ctx: MovementContext, towed: TowedAlong | undefined): void {
    if (!towed) return;
    const tpl = towed.kind === 'manned' ? EVENT.towedAlongManned : EVENT.towedAlongUnmanned;
    ctx.io.term.writeln(render(tpl, { name: towed.name }));
}

export const move: Handler<'moveResult', MovementContext> = (ctx, msg) => {
    switch (msg.outcome) {
        case 'success': {
            ctx.world.sectorPlayers = msg.players;
            const inAutopilot = ctx.autopilot.path.length > 0;
            const moreHops = inAutopilot && ctx.autopilot.step < ctx.autopilot.path.length;
            showSectorDisplay(ctx, msg);
            renderTowedAlong(ctx, msg.towedAlong);
            if (msg.freedFromTow) ctx.io.term.writeln(render(EVENT.towFreedFromTow));
            refreshMinimap(ctx);
            if (moreHops) {
                const nextSector = ctx.autopilot.path[ctx.autopilot.step];
                ctx.autopilot.step = ctx.autopilot.step + 1;
                ctx.io.term.writeln(render(EVENT.autopilotWarping, { sector: nextSector }));
                ctx.io.sendMsg({ type: ClientTag.Move, sector: nextSector });
            } else if (inAutopilot) {
                ctx.io.term.writeln(render(EVENT.autopilotArrived, { sector: msg.sector }));
                ctx.autopilot.path = [];
                ctx.autopilot.step = 0;
            }
            break;
        }
        case 'encounter': {
            ctx.world.mode = Menu.DroneEncounter;
            ctx.world.sectorPlayers = msg.players;
            ctx.encounter.ownerName = msg.ownerName;
            showSectorDisplay(ctx, msg);
            renderTowedAlong(ctx, msg.towedAlong);
            if (msg.freedFromTow) ctx.io.term.writeln(render(EVENT.towFreedFromTow));
            refreshMinimap(ctx);
            if (ctx.autopilot.path.length > 0) {
                ctx.autopilot.paused = true;
                ctx.io.term.writeln(render(EVENT.autopilotDisengaged));
            }
            const droneQty = msg.sectorDrones?.quantity ?? 0;
            showDroneEncounter(ctx, droneQty, msg.ownerName, msg.shipDrones);
            // Mirror the DroneEncounter menu commands as minimap buttons so
            // mouse users don't have to switch back to the keyboard.
            openEncounterMenu(ctx);
            break;
        }
        case 'nonAdjacent':
            ctx.io.sendMsg({
                type: ClientTag.ShortestPath,
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

export const nonAdjacent: Handler<'nonAdjacentMoveRequested', MovementContext> = (ctx, msg) => {
    ctx.io.sendMsg({
        type: ClientTag.ShortestPath,
        from: ctx.world.currentSector,
        to: msg.sector,
    });
};

export const shortestPath: Handler<'shortestPathResult', MovementContext> = (ctx, msg) => {
    if (msg.hops === 0) {
        ctx.io.term.writeln(render(EVENT.alreadyInSector));
        return;
    }
    if (msg.path.length <= 1) {
        ctx.io.term.writeln(render(EVENT.noPathFound));
        return;
    }
    return promptAutopilot(ctx, msg);
};

/** Walk the DroneEncounter menu registry and turn each single-key command
 *  into a button on the minimap panel. Keeps the visible options in sync
 *  with whatever the xterm menu shows. */
function openEncounterMenu(ctx: MovementContext): void {
    const menu = ctx.catalogs.menus.get(Menu.DroneEncounter);
    if (!menu) return;
    const buttons = menu.commands
        .filter((c) => c.keyPattern.length === 1)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ label: c.label, key: c.keyPattern }));
    if (buttons.length === 0) return;
    ctx.minimap.handle?.openMenu({
        title: 'Drone encounter',
        buttons,
    });
}

async function promptAutopilot(
    ctx: MovementContext,
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
        .map((p) =>
            render(p.visited ? SECTOR.warpVisited : SECTOR.warpUnvisited, { sector: p.sector }),
        )
        .join(sep);
    term.writeln(`  ${list}`);

    ctx.minimap.handle?.openMenu({
        title: 'Engage autopilot?',
        buttons: [
            { label: 'Yes', key: 'y' },
            { label: 'No', key: 'n' },
        ],
    });
    let ok: boolean | null;
    try {
        ok = await askConfirm(ctx, render(SECTOR.autopilotConfirm), { defaultValue: false });
    } finally {
        ctx.minimap.handle?.closeMenu();
    }
    if (!ok) return;

    ctx.autopilot.path = msg.path.map((p) => p.sector);
    ctx.autopilot.step = 2;
    const nextSector = ctx.autopilot.path[1];
    term.writeln(render(EVENT.autopilotEngaged));
    term.writeln(render(EVENT.autopilotWarping, { sector: nextSector }));
    ctx.io.sendMsg({ type: ClientTag.Move, sector: nextSector });
}

export const hyperspaceJump: Handler<'hyperspaceJumpResult', MovementContext> = (ctx, msg) => {
    ctx.io.term.writeln(
        render(EVENT.hyperspaceJump, {
            sector: msg.targetSector,
            fuel: msg.fuelUsed,
            turns: msg.turnsUsed,
        }),
    );
    ctx.io.sendMsg({ type: ClientTag.SectorDisplay });
};

export const previousSector: Handler<'previousSectorResult', MovementContext> = (ctx, msg) => {
    if (msg.sector === null) {
        ctx.io.term.writeln(render(NOTIFY.noPreviousSector));
    } else {
        ctx.io.sendMsg({ type: ClientTag.Move, sector: msg.sector });
    }
};

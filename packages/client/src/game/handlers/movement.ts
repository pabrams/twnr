import { ClientMsgType } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY, EVENT } from '../messages/index.js';
import { showSectorDisplay, showPrompt } from '../display.js';
import { showAutopilotPrompt } from '../display-port.js';
import { showDroneEncounter } from '../display-combat.js';
import type { Handler } from './index.js';
import { refreshMinimap } from './utils.js';

export const sectorDisplay: Handler<'sectorDisplayResult'> = (ctx, msg) => {
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

export const move: Handler<'moveResult'> = (ctx, msg) => {
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
                !inAutopilot,
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
                showPrompt(ctx);
            }
            break;
        }
        case 'encounter': {
            ctx.world.sectorPlayers = msg.players;
            ctx.encounter.ownerName = msg.ownerName;
            showSectorDisplay(ctx, msg.sector, msg.warps, msg.players, msg.port);
            if (ctx.autopilot.path.length > 0) {
                ctx.autopilot.paused = true;
                ctx.io.term.writeln(render(EVENT.autopilotDisengaged));
            }
            showDroneEncounter(ctx, msg.sectorDrones, msg.ownerName, msg.shipDrones);
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
            showPrompt(ctx);
            break;
        case 'error':
            if (ctx.autopilot.path.length > 0) {
                ctx.autopilot.path = [];
                ctx.autopilot.step = 0;
                ctx.autopilot.paused = false;
                ctx.io.term.writeln(render(EVENT.autopilotCancelled));
            }
            ctx.io.term.writeln(render(NOTIFY.error, { message: msg.message }));
            showPrompt(ctx);
            break;
    }
};

export const nonAdjacent: Handler<'nonAdjacentMoveRequested'> = (ctx, msg) => {
    ctx.io.sendMsg({
        type: ClientMsgType.ShortestPath,
        from: ctx.world.currentSector,
        to: msg.sector,
    });
};

export const shortestPath: Handler<'shortestPathResult'> = (ctx, msg) => {
    if (msg.path.length > 1) {
        showAutopilotPrompt(ctx, msg.path, msg.hops, msg.turns);
    } else {
        ctx.io.term.writeln(render(EVENT.noPathFound));
        showPrompt(ctx);
    }
};

export const hyperspaceJump: Handler<'hyperspaceJumpResult'> = (ctx, msg) => {
    ctx.io.term.writeln(
        render(EVENT.hyperspaceJump, {
            sector: msg.targetSector,
            fuel: msg.fuelUsed,
            turns: msg.turnsUsed,
        }),
    );
    ctx.io.sendMsg({ type: ClientMsgType.SectorDisplay });
};

export const previousSector: Handler<'previousSectorResult'> = (ctx, msg) => {
    if (msg.sector === null) {
        ctx.io.term.writeln(render(NOTIFY.noPreviousSector));
        showPrompt(ctx);
    } else {
        ctx.io.sendMsg({ type: ClientMsgType.Move, sector: msg.sector });
    }
};

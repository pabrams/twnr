import { ClientMsgType } from '@twnr/shared';
import { render } from '../renderer.js';
import { NOTIFY, EVENT } from '../messages/index.js';
import { showSectorDisplay, showPrompt } from '../display.js';
import { showAutopilotPrompt } from '../display-port.js';
import { showDroneEncounter } from '../display-combat.js';
import type { Handler } from './index.js';
import { refreshMinimap } from './utils.js';

export const sectorDisplay: Handler<'sectorDisplayResult'> = (ctx, msg) => {
    ctx.sectorPlayers = msg.players;
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
    if (ctx.autopilotPath.length > 0 && ctx.autopilotStep < ctx.autopilotPath.length) {
        const nextSector = ctx.autopilotPath[ctx.autopilotStep];
        ctx.autopilotStep = ctx.autopilotStep + 1;
        ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
    } else if (ctx.autopilotPath.length > 0) {
        ctx.autopilotPath = [];
        ctx.autopilotStep = 0;
    }
};

export const move: Handler<'moveResult'> = (ctx, msg) => {
    switch (msg.outcome) {
        case 'success': {
            ctx.sectorPlayers = msg.players;
            const inAutopilot = ctx.autopilotPath.length > 0;
            const moreHops = inAutopilot && ctx.autopilotStep < ctx.autopilotPath.length;
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
                const nextSector = ctx.autopilotPath[ctx.autopilotStep];
                ctx.autopilotStep = ctx.autopilotStep + 1;
                ctx.term.writeln(render(EVENT.autopilotWarping, { sector: nextSector }));
                ctx.sendMsg({ type: ClientMsgType.Move, sector: nextSector });
            } else if (inAutopilot) {
                ctx.term.writeln(render(EVENT.autopilotArrived, { sector: msg.sector }));
                ctx.autopilotPath = [];
                ctx.autopilotStep = 0;
                showPrompt(ctx);
            }
            break;
        }
        case 'encounter': {
            ctx.sectorPlayers = msg.players;
            ctx.encounterOwnerName = msg.ownerName;
            showSectorDisplay(ctx, msg.sector, msg.warps, msg.players, msg.port);
            if (ctx.autopilotPath.length > 0) {
                ctx.autopilotPaused = true;
                ctx.term.writeln(render(EVENT.autopilotDisengaged));
            }
            showDroneEncounter(ctx, msg.sectorDrones, msg.ownerName, msg.shipDrones);
            break;
        }
        case 'nonAdjacent':
            ctx.sendMsg({
                type: ClientMsgType.ShortestPath,
                from: ctx.currentSector,
                to: msg.sector,
            });
            break;
        case 'noShip':
            if (ctx.autopilotPath.length > 0) {
                ctx.autopilotPath = [];
                ctx.autopilotStep = 0;
                ctx.autopilotPaused = false;
                ctx.term.writeln(render(EVENT.autopilotCancelled));
            }
            ctx.term.writeln(render(EVENT.noShip));
            showPrompt(ctx);
            break;
        case 'error':
            if (ctx.autopilotPath.length > 0) {
                ctx.autopilotPath = [];
                ctx.autopilotStep = 0;
                ctx.autopilotPaused = false;
                ctx.term.writeln(render(EVENT.autopilotCancelled));
            }
            ctx.term.writeln(render(NOTIFY.error, { message: msg.message }));
            showPrompt(ctx);
            break;
    }
};

export const nonAdjacent: Handler<'nonAdjacentMoveRequested'> = (ctx, msg) => {
    ctx.sendMsg({
        type: ClientMsgType.ShortestPath,
        from: ctx.currentSector,
        to: msg.sector,
    });
};

export const shortestPath: Handler<'shortestPathResult'> = (ctx, msg) => {
    if (msg.path.length > 1) {
        showAutopilotPrompt(ctx, msg.path, msg.hops, msg.turns);
    } else {
        ctx.term.writeln(render(EVENT.noPathFound));
        showPrompt(ctx);
    }
};

export const hyperspaceJump: Handler<'hyperspaceJumpResult'> = (ctx, msg) => {
    ctx.term.writeln(
        render(EVENT.hyperspaceJump, {
            sector: msg.targetSector,
            fuel: msg.fuelUsed,
            turns: msg.turnsUsed,
        }),
    );
    ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
};

export const previousSector: Handler<'previousSectorResult'> = (ctx, msg) => {
    if (msg.sector === null) {
        ctx.term.writeln(render(NOTIFY.noPreviousSector));
        showPrompt(ctx);
    } else {
        ctx.sendMsg({ type: ClientMsgType.Move, sector: msg.sector });
    }
};

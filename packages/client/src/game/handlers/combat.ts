import { ClientMsgType } from '@twnr/shared';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { showPrompt, showSectorDisplay } from '../display.js';
import { showDroneEncounter, showAttackMenu } from '../display-combat.js';
import type { Handler } from './index.js';
import { refreshMinimap } from './utils.js';

export const attackShip: Handler<'attackShipResult'> = (ctx, msg) => {
    ctx.term.writeln('');
    ctx.term.writeln(
        render(msg.destroyed ? EVENT.attackDestroyed : EVENT.attackCompleted, {
            message: msg.message || (msg.destroyed ? 'Target destroyed!' : 'Attack completed.'),
        }),
    );
    ctx.term.writeln(
        render(EVENT.attackStat, {
            label: 'Your drones lost',
            value: msg.attackerDronesLost,
        }),
    );
    ctx.term.writeln(
        render(EVENT.attackStat, {
            label: 'Defender shields lost',
            value: msg.defenderShieldsLost,
        }),
    );
    ctx.term.writeln(
        render(EVENT.attackStat, {
            label: 'Defender drones lost',
            value: msg.defenderDronesLost,
        }),
    );
    showPrompt(ctx);
};

export const attackMenu: Handler<'attackMenuResult'> = (ctx, msg) => {
    ctx.sectorPlayers = msg.players;
    showAttackMenu(ctx);
};

export const droneEncounter: Handler<'droneEncounter'> = (ctx, msg) => {
    ctx.sectorPlayers = msg.players;
    ctx.encounterOwnerName = msg.ownerName;
    showSectorDisplay(ctx, msg.sector, msg.warps, msg.players, msg.port);
    refreshMinimap(ctx);
    if (ctx.autopilotPath.length > 0) {
        ctx.autopilotPaused = true;
        ctx.term.writeln(render(EVENT.autopilotDisengaged));
    }
    showDroneEncounter(ctx, msg.sectorDrones, msg.ownerName, msg.shipDrones);
};

export const deployDronesInfo: Handler<'deployDronesInfoResult'> = (ctx, msg) => {
    const total = msg.shipDrones + msg.sectorDrones;
    const minInSector = Math.max(0, total - msg.shipMaxDrones);
    ctx.term.writeln('');
    ctx.term.writeln(
        render(EVENT.deployDronesInfo, {
            total,
            max: msg.shipMaxDrones,
            minInSector,
        }),
    );
    ctx.term.write(render(EVENT.deployDronesPrompt, { minInSector }));
};

export const deployDrones: Handler<'deployDronesResult'> = (ctx, msg) => {
    ctx.term.writeln(
        render(EVENT.deployDronesResult, {
            sector: msg.sectorDrones,
            ship: msg.shipDrones,
        }),
    );
    showPrompt(ctx);
};

export const attackSectorDrones: Handler<'attackSectorDronesResult'> = (ctx, msg) => {
    ctx.term.writeln('');
    ctx.term.writeln(
        render(EVENT.combatLost, {
            lost: msg.dronesLost,
            remaining: msg.sectorDronesRemaining,
            ship: msg.shipDrones,
        }),
    );
    if (msg.victory) {
        ctx.term.writeln(render(EVENT.sectorCleared));
        if (ctx.autopilotPaused) {
            ctx.term.writeln(render(EVENT.autopilotResuming));
            ctx.autopilotPaused = false;
            ctx.sendMsg({ type: ClientMsgType.SectorDisplay });
        } else {
            showPrompt(ctx);
        }
    } else {
        showDroneEncounter(ctx, msg.sectorDronesRemaining, ctx.encounterOwnerName, msg.shipDrones);
    }
};

export const retreatFromDrones: Handler<'retreatFromDronesResult'> = (ctx, msg) => {
    ctx.term.writeln(render(EVENT.retreated, { sector: msg.sector }));
    if (ctx.autopilotPaused) {
        ctx.autopilotPath = [];
        ctx.autopilotStep = 0;
        ctx.autopilotPaused = false;
        ctx.term.writeln(render(EVENT.autopilotCancelled));
    }
};

export const sectorDronesAlert: Handler<'sectorDronesAlert'> = (ctx, msg) => {
    ctx.term.writeln('');
    const tpl =
        msg.event === 'intrusion'
            ? EVENT.alertIntrusion
            : msg.event === 'attacked'
              ? EVENT.alertAttacked
              : msg.event === 'destroyed'
                ? EVENT.alertDestroyed
                : null;
    if (tpl) {
        const vars: Record<string, unknown> = {
            intruder: msg.intruderName,
            sector: msg.sector,
        };
        if (msg.event === 'attacked') {
            vars.lost = msg.dronesLost;
            vars.remaining = msg.dronesRemaining;
        }
        ctx.term.writeln(render(tpl, vars));
    }
};

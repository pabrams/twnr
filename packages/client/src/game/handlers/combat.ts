import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { showPrompt, showSectorDisplay, type DisplayCtx } from '../display.js';
import { showDroneEncounter, showAttackMenu, type DisplayCombatCtx } from '../display-combat.js';
import type { Handler } from './index.js';
import { refreshMinimap, type RefreshMinimapDeps } from './utils.js';

type CombatDeps = Pick<GameContext, 'autopilot' | 'encounter' | 'io' | 'world'> &
    DisplayCtx &
    DisplayCombatCtx &
    RefreshMinimapDeps;

export const attackShip: Handler<'attackShipResult', CombatDeps> = (ctx, msg) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(msg.destroyed ? EVENT.attackDestroyed : EVENT.attackCompleted, {
            message: msg.message || (msg.destroyed ? 'Target destroyed!' : 'Attack completed.'),
        }),
    );
    ctx.io.term.writeln(
        render(EVENT.attackStat, {
            label: 'Your drones lost',
            value: msg.attackerDronesLost,
        }),
    );
    ctx.io.term.writeln(
        render(EVENT.attackStat, {
            label: 'Defender shields lost',
            value: msg.defenderShieldsLost,
        }),
    );
    ctx.io.term.writeln(
        render(EVENT.attackStat, {
            label: 'Defender drones lost',
            value: msg.defenderDronesLost,
        }),
    );
    showPrompt(ctx);
};

export const attackMenu: Handler<'attackMenuResult', CombatDeps> = (ctx, msg) => {
    ctx.world.sectorPlayers = msg.players;
    showAttackMenu(ctx);
};

export const droneEncounter: Handler<'droneEncounter', CombatDeps> = (ctx, msg) => {
    ctx.world.sectorPlayers = msg.players;
    ctx.encounter.ownerName = msg.ownerName;
    showSectorDisplay(ctx, msg.sector, msg.warps, msg.players, msg.port);
    refreshMinimap(ctx);
    if (ctx.autopilot.path.length > 0) {
        ctx.autopilot.paused = true;
        ctx.io.term.writeln(render(EVENT.autopilotDisengaged));
    }
    showDroneEncounter(ctx, msg.sectorDrones, msg.ownerName, msg.shipDrones);
};

export const deployDronesInfo: Handler<'deployDronesInfoResult', CombatDeps> = (ctx, msg) => {
    const total = msg.shipDrones + msg.sectorDrones;
    const minInSector = Math.max(0, total - msg.shipMaxDrones);
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(EVENT.deployDronesInfo, {
            total,
            max: msg.shipMaxDrones,
            minInSector,
        }),
    );
    ctx.io.term.write(render(EVENT.deployDronesPrompt, { minInSector }));
};

export const deployDrones: Handler<'deployDronesResult', CombatDeps> = (ctx, msg) => {
    ctx.io.term.writeln(
        render(EVENT.deployDronesResult, {
            sector: msg.sectorDrones,
            ship: msg.shipDrones,
        }),
    );
    showPrompt(ctx);
};

export const attackSectorDrones: Handler<'attackSectorDronesResult', CombatDeps> = (ctx, msg) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(EVENT.combatLost, {
            lost: msg.dronesLost,
            remaining: msg.sectorDronesRemaining,
            ship: msg.shipDrones,
        }),
    );
    if (msg.victory) {
        ctx.io.term.writeln(render(EVENT.sectorCleared));
        if (ctx.autopilot.paused) {
            ctx.io.term.writeln(render(EVENT.autopilotResuming));
            ctx.autopilot.paused = false;
            ctx.io.sendMsg({ type: ClientMsgType.SectorDisplay });
        } else {
            showPrompt(ctx);
        }
    } else {
        showDroneEncounter(ctx, msg.sectorDronesRemaining, ctx.encounter.ownerName, msg.shipDrones);
    }
};

export const retreatFromDrones: Handler<'retreatFromDronesResult', CombatDeps> = (ctx, msg) => {
    ctx.io.term.writeln(render(EVENT.retreated, { sector: msg.sector }));
    if (ctx.autopilot.paused) {
        ctx.autopilot.path = [];
        ctx.autopilot.step = 0;
        ctx.autopilot.paused = false;
        ctx.io.term.writeln(render(EVENT.autopilotCancelled));
    }
};

export const sectorDronesAlert: Handler<'sectorDronesAlert', CombatDeps> = (ctx, msg) => {
    ctx.io.term.writeln('');
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
        ctx.io.term.writeln(render(tpl, vars));
    }
};

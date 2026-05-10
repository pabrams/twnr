import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT } from '../messages/index.js';
import { type DisplayCtx } from '../display.js';
import { showDroneEncounter, showAttackMenu, type DisplayCombatCtx } from '../display-combat.js';
import { showPrompt } from '../menus/types.js';
import { askNumber } from '../menus/prompts.js';
import type { Handler } from './index.js';

type CombatDeps = Pick<GameContext, 'autopilot' | 'encounter' | 'input' | 'io' | 'world'> &
    DisplayCtx &
    DisplayCombatCtx;

export const attackShip: Handler<'attackShipResult', CombatDeps> = (ctx, msg) => {
    // The attack target-select sub-mode is over once the shot is fired.
    if (ctx.world.mode === Menu.Attack) ctx.world.mode = Menu.Sector;
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
};

export const getAttackTargets: Handler<'getAttackTargetsResult', CombatDeps> = (ctx, msg) => {
    ctx.world.sectorPlayers = msg.players;
    // Server stays in 'sector' location; the attack-target-select sub-mode
    // is entered here when the roster has visible targets.
    if (msg.players.length > 0) ctx.world.mode = Menu.Attack;
    showAttackMenu(ctx);
};

// Display the deploy-info preamble then askNumber for qty inline. The
// deployDronesQty menu is gone — the user stays on the sector menu and
// the qty is a sub-prompt of this handler. -1 is the "accept default"
// value (server clamps to minInSector). Uses the default `GameContext`
// Deps because showPrompt's callback signature needs the full ctx.
export const deployDronesInfo: Handler<'deployDronesInfoResult'> = async (ctx, msg) => {
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
    const qty = await askNumber(ctx, render(EVENT.deployDronesPrompt, { minInSector }), {
        min: 0,
        defaultValue: -1,
    });
    if (qty === null) {
        // User cancelled with Q. No server roundtrip will follow, so
        // re-render the sector prompt manually — the framework's
        // post-envelope auto-render already fired (and was suppressed
        // by pendingResolver).
        showPrompt(ctx);
        return;
    }
    ctx.io.sendMsg({ type: ClientMsgType.DeployDrones, quantity: qty });
};

export const deployDrones: Handler<'deployDronesResult', CombatDeps> = (ctx, msg) => {
    ctx.io.term.writeln(
        render(EVENT.deployDronesResult, {
            sector: msg.sectorDrones,
            ship: msg.shipDrones,
        }),
    );
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
        // Drones cleared — exit the droneEncounter sub-mode.
        ctx.world.mode = Menu.Sector;
        ctx.io.term.writeln(render(EVENT.sectorCleared));
        if (ctx.autopilot.paused) {
            ctx.io.term.writeln(render(EVENT.autopilotResuming));
            ctx.autopilot.paused = false;
            ctx.io.sendMsg({ type: ClientMsgType.SectorDisplay });
        }
    } else {
        showDroneEncounter(ctx, msg.sectorDronesRemaining, ctx.encounter.ownerName, msg.shipDrones);
    }
};

export const retreatFromDrones: Handler<'retreatFromDronesResult', CombatDeps> = (ctx, msg) => {
    // Retreat exits the droneEncounter sub-mode (we moved back to a safe sector).
    ctx.world.mode = Menu.Sector;
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

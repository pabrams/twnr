import { ClientTag, Menu, ServerTag } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT, SECTOR } from '../messages/index.js';
import { type DisplayCtx } from '../display.js';
import { showDroneEncounter, showAttackMenu, type DisplayCombatCtx } from '../display-combat.js';
import { askConfirm, askNumber, askDeployOwnership, awaitResponse } from '../menus/prompts.js';
import type { Handler } from './index.js';

type CombatContext = Pick<GameContext, 'autopilot' | 'encounter' | 'input' | 'io' | 'world'> &
    DisplayCtx &
    DisplayCombatCtx;

export const attackShip: Handler<'attackShipResult', CombatContext> = (ctx, msg) => {
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

export const getAttackTargets: Handler<'getAttackTargetsResult', CombatContext> = async (
    ctx,
    msg,
) => {
    ctx.world.sectorPlayers = msg.players;
    if (msg.beaconPresent) {
        const ok = await askConfirm(ctx, render(SECTOR.attackBeaconPrompt), {
            defaultValue: false,
        });
        if (ok) {
            ctx.io.sendMsg({ type: ClientTag.AttackBeacon });
            const reply = await awaitResponse(ctx, [
                ServerTag.AttackBeaconResult,
                ServerTag.Error,
            ]);
            if (reply && reply.type === ServerTag.AttackBeaconResult && reply.destroyed) {
                ctx.io.term.writeln(render(SECTOR.attackBeaconDestroyed));
            }
        }
    }
    if (msg.players.length > 0) ctx.world.mode = Menu.Attack;
    showAttackMenu(ctx);
};

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
    if (qty === null) return;
    const ownership = await askDeployOwnership(ctx, render(EVENT.deployOwnershipPrompt));
    if (ownership === null) return;
    ctx.io.sendMsg({ type: ClientTag.DeployDrones, quantity: qty, ownership });
};

export const deployDrones: Handler<'deployDronesResult', CombatContext> = (ctx, msg) => {
    ctx.io.term.writeln(
        render(EVENT.deployDronesResult, {
            sector: msg.sectorDrones,
            ship: msg.shipDrones,
        }),
    );
};

export const attackSectorDrones: Handler<'attackSectorDronesResult', CombatContext> = (
    ctx,
    msg,
) => {
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
            const atDestination = ctx.autopilot.step >= ctx.autopilot.path.length;
            ctx.autopilot.paused = false;
            if (atDestination) {
                const dest = ctx.autopilot.path[ctx.autopilot.path.length - 1];
                ctx.io.term.writeln(render(EVENT.autopilotArrived, { sector: dest }));
                ctx.autopilot.path = [];
                ctx.autopilot.step = 0;
            } else {
                const nextSector = ctx.autopilot.path[ctx.autopilot.step];
                ctx.autopilot.step = ctx.autopilot.step + 1;
                ctx.io.term.writeln(render(EVENT.autopilotResuming));
                ctx.io.term.writeln(render(EVENT.autopilotWarping, { sector: nextSector }));
                ctx.io.sendMsg({ type: ClientTag.Move, sector: nextSector });
            }
        }
    } else {
        showDroneEncounter(ctx, msg.sectorDronesRemaining, ctx.encounter.ownerName, msg.shipDrones);
    }
};

export const retreatFromDrones: Handler<'retreatFromDronesResult', CombatContext> = (ctx, msg) => {
    ctx.world.mode = Menu.Sector;
    ctx.io.term.writeln(render(EVENT.retreated, { sector: msg.sector }));
    if (ctx.autopilot.paused) {
        ctx.autopilot.path = [];
        ctx.autopilot.step = 0;
        ctx.autopilot.paused = false;
        ctx.io.term.writeln(render(EVENT.autopilotCancelled));
    }
};

export const sectorDronesAlert: Handler<'sectorDronesAlert', CombatContext> = (ctx, msg) => {
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

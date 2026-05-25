import { ClientTag, Menu, ServerTag } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT, SECTOR } from '../messages/index.js';
import { type DisplayCtx } from '../display.js';
import { showDroneEncounter, showAttackMenu, type DisplayCombatCtx } from '../display-combat.js';
import { askConfirm } from '../routines/prompts.js';
import { awaitResponse } from '../routines/io.js';
import { refreshMinimap, renderAttributeChange, type RefreshMinimapCtx } from './utils.js';
import type { Handler } from './index.js';

type CombatContext = Pick<
    GameContext,
    'autopilot' | 'catalogs' | 'encounter' | 'input' | 'io' | 'minimap' | 'world'
> &
    DisplayCtx &
    DisplayCombatCtx &
    RefreshMinimapCtx;

/** Re-open the minimap floating menu for the DroneEncounter commands. */
function reopenEncounterMenu(ctx: CombatContext): void {
    const menu = ctx.catalogs.menus.get(Menu.DroneEncounter);
    if (!menu) return;
    const buttons = menu.commands
        .filter((c) => c.keyPattern.length === 1)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ label: c.label, key: c.keyPattern }));
    if (buttons.length === 0) return;
    ctx.minimap.handle?.openMenu({ title: 'Drone encounter', buttons });
}

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
    renderAttributeChange(ctx, msg.expDelta ?? 0, msg.repDelta ?? 0, 'combat');
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
            const reply = await awaitResponse(ctx, [ServerTag.AttackBeaconResult, ServerTag.Error]);
            if (reply && reply.type === ServerTag.AttackBeaconResult && reply.destroyed) {
                ctx.io.term.writeln(render(SECTOR.attackBeaconDestroyed));
            }
        }
    }
    if (msg.players.length > 0) ctx.world.mode = Menu.Attack;
    showAttackMenu(ctx);
};

export const deployDrones: Handler<'deployDronesResult', CombatContext> = (ctx, msg) => {
    ctx.io.term.writeln(
        render(EVENT.deployDronesResult, {
            sector: msg.sectorDrones,
            ship: msg.shipDrones,
        }),
    );
    refreshMinimap(ctx);
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
    renderAttributeChange(ctx, msg.expDelta ?? 0, msg.repDelta ?? 0, 'combat');
    refreshMinimap(ctx);
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
        reopenEncounterMenu(ctx);
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

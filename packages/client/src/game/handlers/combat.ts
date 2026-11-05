import { Menu, Commands, command } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { EVENT, NOTIFY } from '../messages/index.js';
import { type DisplayCtx } from '../display.js';
import { showDroneEncounter, type DisplayCombatCtx } from '../display-combat.js';
import { refreshMinimap, renderAttributeChange, type RefreshMinimapCtx } from './utils.js';
import type { ReplyHandler, EventHandler } from './index.js';

type CombatContext = Pick<
    GameContext,
    'autopilot' | 'catalogs' | 'encounter' | 'input' | 'io' | 'minimap' | 'world'
> &
    DisplayCtx &
    DisplayCombatCtx &
    RefreshMinimapCtx;

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

export const deployDrones: ReplyHandler<'DeployDrones', CombatContext> = (ctx, msg) => {
    if (msg.outcome === 'noShip') {
        ctx.io.term.writeln(render(EVENT.noShip));
        return;
    }
    ctx.io.term.writeln(
        render(EVENT.deployDronesResult, {
            sector: msg.sectorDrones,
            ship: msg.shipDrones,
        }),
    );
    refreshMinimap(ctx);
};

export const attackSectorDrones: ReplyHandler<'AttackSectorDrones', CombatContext> = (ctx, msg) => {
    if (msg.outcome === 'noShip') {
        ctx.io.term.writeln(render(EVENT.noShip));
        return;
    }
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
                ctx.io.sendMsg(command(Commands.Move, { sector: nextSector }));
            }
        }
    } else {
        showDroneEncounter(ctx, msg.sectorDronesRemaining, ctx.encounter.ownerName, msg.shipDrones);
        reopenEncounterMenu(ctx);
    }
};

export const retreatFromDrones: ReplyHandler<'RetreatFromDrones', CombatContext> = (ctx, msg) => {
    ctx.world.mode = Menu.Sector;
    if (ctx.autopilot.paused) {
        ctx.autopilot.path = [];
        ctx.autopilot.step = 0;
        ctx.autopilot.paused = false;
        ctx.io.term.writeln(render(EVENT.autopilotCancelled));
    }
    if (msg.outcome === 'destroyed') {
        ctx.io.term.writeln(render(EVENT.shipDestroyed, { reason: msg.reason }));
        return;
    }
    ctx.io.term.writeln(render(EVENT.retreated, { sector: msg.sector }));
};

export const weaponsPoweringUp: EventHandler<'WeaponsPoweringUp', CombatContext> = (ctx, msg) => {
    ctx.io.term.writeln(render(NOTIFY.weaponsPoweringUp, { attacker: msg.attackerName }));
};

export const droneWaveLaunched: EventHandler<'DroneWaveLaunched', CombatContext> = (ctx, msg) => {
    ctx.io.term.writeln(
        render(NOTIFY.droneWaveLaunched, {
            attacker: msg.attackerName,
            defender: msg.defenderName,
        }),
    );
};

export const shipAttacked: EventHandler<'ShipAttacked', CombatContext> = (ctx, msg) => {
    const attacker = msg.attackerName;
    const shields = msg.defenderShieldsLost;
    const drones = msg.defenderDronesLost;
    ctx.io.term.writeln('');
    if (msg.destroyed) {
        ctx.io.term.writeln(render(EVENT.alertShipDestroyed, { attacker }));
    } else if (shields > 0 && drones > 0) {
        ctx.io.term.writeln(render(EVENT.alertShipAttacked, { attacker, shields, drones }));
    } else if (shields > 0) {
        ctx.io.term.writeln(render(EVENT.alertShipShieldsLost, { attacker, shields }));
    } else if (drones > 0) {
        ctx.io.term.writeln(render(EVENT.alertShipDronesLost, { attacker, drones }));
    }
    renderAttributeChange(ctx, msg.expDelta ?? 0, msg.repDelta ?? 0, 'losing your ship');
};

export const sectorDronesReported: EventHandler<'SectorDronesReported', CombatContext> = (
    ctx,
    msg,
) => {
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

import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { NOTIFY, EVENT, PANEL } from '../messages/index.js';
import { askConfirm } from '../menus/prompts.js';
import { echoCommand } from '../display.js';
import { showSectorDisplay, type DisplayCtx } from '../display.js';
import {
    showPlanetMenu,
    showEarthMenu,
    showNoPlanet,
    type DisplayPlanetCtx,
} from '../display-planet.js';
import { type DisplayStarbaseCtx } from '../display-starbase.js';
import { type DisplayComputerCtx } from '../display-computer.js';
import { setMenuArgs, type MenuArgsSlot } from '../menus/types.js';
import type { Handler } from './index.js';
import { fmt, refreshMinimap, type RefreshMinimapDeps } from './utils.js';

type PlanetDeps = Pick<GameContext, 'io' | 'input' | 'ship' | 'world'> &
    DisplayCtx &
    DisplayPlanetCtx &
    DisplayStarbaseCtx &
    DisplayComputerCtx &
    RefreshMinimapDeps &
    MenuArgsSlot;

export const planetInfo: Handler<'planetInfoResult', PlanetDeps> = (ctx, msg) => {
    if (msg.hasPlanet) showPlanetMenu(ctx, msg.name, msg.colonists);
    else showNoPlanet(ctx);
};

export const takeColonists: Handler<'takeColonistsResult', PlanetDeps> = (ctx, msg) => {
    ctx.ship.shipColonists = msg.shipColonists;
    if (msg.commodity === 'fuel') ctx.world.earthColonists = msg.planetColonists;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(PANEL.takeColonistsHeader, {
            qty: fmt(msg.quantity),
            commodity: msg.commodity,
        }),
    );
    ctx.io.term.writeln(render(PANEL.planetColonistsLine, { count: fmt(msg.planetColonists) }));
    ctx.io.term.writeln(render(PANEL.shipColonistsLine, { count: msg.shipColonists }));
    // Earth case: server auto-lifted and bundled sector data into this
    // envelope. No repaint needed (same sector / port / warps); only
    // refresh sectorPlayers in case others arrived. Framework auto-
    // renders the sector prompt. Real-planet case: sector fields absent;
    // player stays on-planet, framework auto-renders the planet prompt.
    if (msg.players !== undefined) {
        ctx.world.sectorPlayers = msg.players;
    }
};

export const leaveColonists: Handler<'leaveColonistsResult', PlanetDeps> = (ctx, msg) => {
    ctx.ship.shipColonists = msg.shipColonists;
    if (msg.commodity === 'fuel') ctx.world.earthColonists = msg.planetColonists;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(PANEL.leaveColonistsHeader, {
            qty: fmt(msg.quantity),
            commodity: msg.commodity,
        }),
    );
    ctx.io.term.writeln(render(PANEL.planetColonistsLine, { count: fmt(msg.planetColonists) }));
    ctx.io.term.writeln(render(PANEL.shipColonistsLine, { count: msg.shipColonists }));
    // Earth case: server auto-lifted and bundled sector data into this
    // envelope. No repaint needed (same sector / port / warps); only
    // refresh sectorPlayers in case others arrived. Framework auto-
    // renders the sector prompt.
    if (msg.players !== undefined) {
        ctx.world.sectorPlayers = msg.players;
    }
};

export const land: Handler<'landResult', PlanetDeps> = (ctx, msg) => {
    if (msg.planets.length > 0) {
        setMenuArgs(ctx, { menu: Menu.PlanetSelect, planets: msg.planets });
    } else {
        ctx.io.term.writeln(render(EVENT.noPlanetsToLand));
    }
};

export const landOnPlanet: Handler<'landOnPlanetResult', PlanetDeps> = (ctx, msg) => {
    ctx.ship.planetEmptyHolds = msg.empty_holds;
    ctx.ship.shipColonists = msg.ship_colonists;
    if (ctx.world.mode === Menu.PlanetEarth) {
        ctx.world.earthColonists = msg.colonists_fuel ?? 0;
        showEarthMenu(ctx, ctx.world.earthColonists);
    } else {
        ctx.io.term.writeln('');
        ctx.io.term.writeln(render(PANEL.landedHeader, { name: msg.name }));
        ctx.io.term.writeln(render(PANEL.landedType, { type: msg.planetType }));
        ctx.io.term.writeln(
            render(PANEL.landedStats, {
                drones: msg.drones,
                fuel: msg.fuel,
                organics: msg.organics,
                equipment: msg.equipment,
            }),
        );
        ctx.io.term.writeln(
            render(PANEL.landedColonists, {
                fuel: msg.colonists_fuel ?? 0,
                organics: msg.colonists_organics ?? 0,
                equipment: msg.colonists_equipment ?? 0,
            }),
        );
    }
};

export const planetDisplay: Handler<'planetDisplayResult', PlanetDeps> = (ctx, msg) => {
    ctx.ship.planetEmptyHolds = msg.empty_holds;
    ctx.ship.shipColonists = msg.ship_colonists;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(PANEL.planetDisplayHeader, { name: msg.name, type: msg.planetType }),
    );
    ctx.io.term.writeln(
        render(PANEL.landedStats, {
            drones: msg.drones,
            fuel: msg.fuel,
            organics: msg.organics,
            equipment: msg.equipment,
        }),
    );
    ctx.io.term.writeln(
        render(PANEL.landedColonists, {
            fuel: msg.colonists_fuel,
            organics: msg.colonists_organics,
            equipment: msg.colonists_equipment,
        }),
    );
};

export const destroyPlanet: Handler<'destroyPlanetResult', PlanetDeps> = (ctx, msg) => {
    if (msg.destroyed) {
        ctx.io.term.writeln(render(EVENT.planetDestroyed, { name: msg.planetName }));
    }
};

export const useTerraformDevice: Handler<'useTerraformDeviceResult', PlanetDeps> = (ctx, msg) => {
    if (msg.success && msg.planet) {
        ctx.io.term.writeln(
            render(EVENT.terraformSuccess, {
                name: msg.planet.name,
                type: msg.planet.type,
            }),
        );
        if (msg.collision) ctx.io.term.writeln(render(EVENT.terraformCollision));
        ctx.io.term.writeln(
            render(EVENT.terraformDevicesRemaining, { count: msg.terraformDevices }),
        );
    } else {
        const reason =
            msg.reason === 'no_devices'
                ? 'No terraform devices on ship.'
                : msg.reason === 'restricted_sector'
                  ? 'Cannot terraform in this sector.'
                  : 'Terraform failed.';
        ctx.io.term.writeln(render(EVENT.terraformFailure, { reason }));
    }
};

export const leavePlanet: Handler<'leavePlanetResult', PlanetDeps> = (ctx, msg) => {
    ctx.io.term.writeln(render(EVENT.leftPlanet));
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
};

export const listPlanets: Handler<'listPlanetsResult', PlanetDeps> = (ctx, msg) => {
    ctx.io.term.writeln('');
    if (msg.planets.length === 0) {
        ctx.io.term.writeln(render(PANEL.listPlanetsEmpty));
    } else {
        ctx.io.term.writeln(render(PANEL.listPlanetsHeader));
        for (const p of msg.planets) {
            ctx.io.term.writeln(
                render(PANEL.listPlanetsRow, {
                    sector: p.sectorNumber,
                    name: p.name,
                    type: p.type,
                }),
            );
            ctx.io.term.writeln(
                render(PANEL.listPlanetsColonists, {
                    fuel: p.colonists_fuel,
                    organics: p.colonists_organics,
                    equipment: p.colonists_equipment,
                }),
            );
        }
    }
};

export const terraformInfo: Handler<'terraformInfoResult', PlanetDeps> = (ctx, msg) => {
    if (msg.canTerraform) {
        ctx.io.term.writeln(render(NOTIFY.terraformDevicesAvailable, { count: msg.devices }));
        // The terraformConfirm menu was collapsed: ask Y/N inline and fire
        // UseTerraformDevice on yes. Player stays on sector throughout.
        void terraformAskAndFire(ctx);
    } else if (msg.reason === 'no_devices') {
        ctx.io.term.writeln(render(NOTIFY.terraformNoDevices));
    } else {
        ctx.io.term.writeln(render(NOTIFY.error, { message: 'Cannot terraform here.' }));
    }
};

async function terraformAskAndFire(ctx: PlanetDeps): Promise<void> {
    const ok = await askConfirm(ctx, render(NOTIFY.terraformConfirm), { defaultValue: false });
    if (ok) {
        echoCommand(ctx, 'useTerraformDevice');
        ctx.io.sendMsg({ type: ClientMsgType.UseTerraformDevice });
    }
}

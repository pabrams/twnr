import { ClientMsgType, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { NOTIFY, EVENT, PANEL, PLANET } from '../messages/index.js';
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
import type { Handler } from './index.js';
import { fmt, refreshMinimap, type RefreshMinimapDeps } from './utils.js';

type PlanetDeps = Pick<GameContext, 'io' | 'input' | 'ship' | 'world'> &
    DisplayCtx &
    DisplayPlanetCtx &
    DisplayStarbaseCtx &
    DisplayComputerCtx &
    RefreshMinimapDeps;

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
    if (msg.players !== undefined) {
        ctx.world.sectorPlayers = msg.players;
    }
};

export const takeCommodity: Handler<'takeCommodityResult', PlanetDeps> = (ctx, msg) => {
    if (msg.commodity === 'drones') ctx.ship.shipDrones = msg.shipCommodity;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(PLANET.takeStockpileResult, {
            qty: fmt(msg.quantity),
            commodity: msg.commodity,
            planet: fmt(msg.planetCommodity),
            ship: fmt(msg.shipCommodity),
        }),
    );
};

export const leaveCommodity: Handler<'leaveCommodityResult', PlanetDeps> = (ctx, msg) => {
    if (msg.commodity === 'drones') ctx.ship.shipDrones = msg.shipCommodity;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(PLANET.leaveStockpileResult, {
            qty: fmt(msg.quantity),
            commodity: msg.commodity,
            planet: fmt(msg.planetCommodity),
            ship: fmt(msg.shipCommodity),
        }),
    );
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

    if (msg.players !== undefined) {
        ctx.world.sectorPlayers = msg.players;
    }
};

export const landOnPlanet: Handler<'landOnPlanetResult', PlanetDeps> = (ctx, msg) => {
    ctx.ship.planetEmptyHolds = msg.empty_holds;
    ctx.ship.shipColonists = msg.ship_colonists;
    ctx.ship.shipDrones = msg.ship_drones;
    ctx.ship.shipMaxDrones = msg.ship_max_drones;
    const isEarth = msg.name === 'Earth';
    ctx.world.mode = isEarth ? Menu.PlanetEarth : Menu.Planet;
    if (isEarth) {
        ctx.world.earthColonists = msg.colonists_fuel ?? 0;
        showEarthMenu(ctx, ctx.world.earthColonists);
    } else {
        ctx.io.term.writeln('');
        ctx.io.term.writeln(render(PANEL.landedHeader, { name: msg.name }));
        ctx.io.term.writeln(render(PANEL.landedType, { type: msg.displayType ?? msg.planetType }));
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
                drones: msg.colonists_drones ?? 0,
            }),
        );
    }
};

export const planetDisplay: Handler<'planetDisplayResult', PlanetDeps> = (ctx, msg) => {
    ctx.ship.planetEmptyHolds = msg.empty_holds;
    ctx.ship.shipColonists = msg.ship_colonists;
    ctx.ship.shipDrones = msg.ship_drones;
    ctx.ship.shipMaxDrones = msg.ship_max_drones;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(PANEL.planetDisplayHeader, {
            name: msg.name,
            type: msg.displayType ?? msg.planetType,
        }),
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
            drones: msg.colonists_drones,
        }),
    );
};

export const destroyPlanet: Handler<'destroyPlanetResult', PlanetDeps> = (ctx, msg) => {
    if (msg.destroyed) {
        ctx.world.mode = Menu.Sector;
        ctx.io.term.writeln(render(EVENT.planetDestroyed, { name: msg.planetName }));
    }
};

export const useTerraformDevice: Handler<'useTerraformDeviceResult', PlanetDeps> = (ctx, msg) => {
    if (msg.success && msg.planet) {
        ctx.io.term.writeln(
            render(EVENT.terraformSuccess, {
                name: msg.planet.name,
                type: msg.planet.displayType ?? msg.planet.type,
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
    ctx.world.mode = Menu.Sector;
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
                    type: p.displayType ?? p.type,
                }),
            );
            ctx.io.term.writeln(
                render(PANEL.listPlanetsColonists, {
                    fuel: p.colonists_fuel,
                    organics: p.colonists_organics,
                    equipment: p.colonists_equipment,
                    drones: p.colonists_drones,
                }),
            );
        }
    }
};

export const terraformInfo: Handler<'terraformInfoResult', PlanetDeps> = (ctx, msg) => {
    if (msg.canTerraform) {
        ctx.io.term.writeln(render(NOTIFY.terraformDevicesAvailable, { count: msg.devices }));

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

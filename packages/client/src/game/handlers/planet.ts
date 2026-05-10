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
import { padStartVisible } from '../display-utils.js';

type PlanetDisplayMsg = {
    id: number;
    name: string;
    planetType: string;
    displayType: string | null;
    fuel: number;
    organics: number;
    equipment: number;
    drones: number;
    colonists_fuel: number;
    colonists_organics: number;
    colonists_equipment: number;
    colonists_drones: number;
    fuel_production: number;
    organics_production: number;
    equipment_production: number;
    drone_production: number;
    max_fuel: number;
    max_org: number;
    max_equ: number;
    max_drones: number;
    colos_per_unit_per_hour: number;
    ship_fuel: number;
    ship_organics: number;
    ship_equipment: number;
    ship_drones: number;
    empty_holds: number;
};

function colsToBuildOnePerHour(prodRate: number, cpu: number): string {
    if (prodRate <= 0 || cpu <= 0) return 'N/A';
    return fmt(Math.ceil(cpu / prodRate));
}

function hourlyOutput(colos: number, prodRate: number, cpu: number): string {
    if (prodRate <= 0 || cpu <= 0) return '0';
    return fmt(Math.floor((colos * prodRate) / cpu));
}

function renderPlanetTable(ctx: { io: { term: { writeln: (s: string) => void } }; world: { currentSector: number } }, msg: PlanetDisplayMsg): void {
    const sector = ctx.world.currentSector;
    const cpu = msg.colos_per_unit_per_hour;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(PANEL.planetDisplayTitle, { id: msg.id, sector, name: msg.name }),
    );
    ctx.io.term.writeln(
        render(PANEL.planetDisplayClass, {
            class: msg.planetType,
            type: msg.displayType ?? msg.planetType,
        }),
    );
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PANEL.planetDisplayTableHead1));
    ctx.io.term.writeln(render(PANEL.planetDisplayTableHead2));
    ctx.io.term.writeln(render(PANEL.planetDisplayTableSep));

    const rows = [
        {
            item: 'Fuel Ore',
            colos: msg.colonists_fuel,
            prod: msg.fuel_production,
            planet: msg.fuel,
            ship: msg.ship_fuel,
            max: msg.max_fuel,
        },
        {
            item: 'Organics',
            colos: msg.colonists_organics,
            prod: msg.organics_production,
            planet: msg.organics,
            ship: msg.ship_organics,
            max: msg.max_org,
        },
        {
            item: 'Equipment',
            colos: msg.colonists_equipment,
            prod: msg.equipment_production,
            planet: msg.equipment,
            ship: msg.ship_equipment,
            max: msg.max_equ,
        },
        {
            item: 'Drones',
            colos: msg.colonists_drones,
            prod: msg.drone_production,
            planet: msg.drones,
            ship: msg.ship_drones,
            max: msg.max_drones,
        },
    ];
    for (const r of rows) {
        ctx.io.term.writeln(
            render(PANEL.planetDisplayTableRow, {
                item: padStartVisible(r.item, 9),
                colos: padStartVisible(fmt(Math.floor(r.colos / 1000)), 9),
                c2b1: padStartVisible(colsToBuildOnePerHour(r.prod, cpu), 9),
                hourly: padStartVisible(hourlyOutput(r.colos, r.prod, cpu), 9),
                planet: padStartVisible(fmt(r.planet), 9),
                ship: padStartVisible(fmt(r.ship), 9),
                max: padStartVisible(fmt(r.max), 9),
            }),
        );
    }

    ctx.io.term.writeln(render(PANEL.planetDisplayHolds, { holds: fmt(msg.empty_holds) }));
}

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
        renderPlanetTable(ctx, msg);
    }
};

export const planetDisplay: Handler<'planetDisplayResult', PlanetDeps> = (ctx, msg) => {
    ctx.ship.planetEmptyHolds = msg.empty_holds;
    ctx.ship.shipColonists = msg.ship_colonists;
    ctx.ship.shipDrones = msg.ship_drones;
    ctx.ship.shipMaxDrones = msg.ship_max_drones;
    renderPlanetTable(ctx, msg);
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

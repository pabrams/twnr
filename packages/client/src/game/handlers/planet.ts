import { ClientTag, Menu } from '@twnr/shared';
import type { GameContext } from '../types.js';
import { render } from '../renderer.js';
import { NOTIFY, EVENT, PLANET } from '../messages/index.js';
import { askConfirm, askChar, askLineRaw, awaitResponse } from '../routines/prompts.js';
import { type DisplayCtx } from '../display.js';
import { ServerTag } from '@twnr/shared';
import {
    showPlanetMenu,
    showEarthMenu,
    showNoPlanet,
    type DisplayPlanetCtx,
} from '../display-planet.js';
import { type DisplayStarbaseCtx } from '../display-starbase.js';
import { type DisplayComputerCtx } from '../display-computer.js';
import type { Handler } from './index.js';
import { fmt, fmtCompact, type RefreshMinimapCtx } from './utils.js';
import { padStartVisible } from '../display-utils.js';

type PlanetDisplayMsg = {
    id: number;
    universe_planet_number: number;
    name: string;
    base_level: number | null;
    base_treasury: number | null;
    base_transporter_range: number | null;
    base_construction_target_level: number | null;
    base_construction_completes_at: string | Date | null;
    planetType: string;
    displayType: string | null;
    owner_name: string | null;
    fuel: number;
    organics: number;
    equipment: number;
    drones: number;
    colonists_fuel: number;
    colonists_organics: number;
    colonists_equipment: number;
    fuel_production: number;
    organics_production: number;
    equipment_production: number;
    fig_factor_fuel: number;
    fig_factor_org: number;
    fig_factor_equ: number;
    max_fuel: number;
    max_org: number;
    max_equ: number;
    max_drones: number;
    colos_per_unit_per_hour: number;
    ship_fuel: number;
    ship_organics: number;
    ship_equipment: number;
    ship_drones: number;
    ship_max_drones: number;
    ship_colonists: number;
    empty_holds: number;
};

function colsToBuildOnePerHour(prodRate: number, cpu: number): string {
    if (prodRate <= 0 || cpu <= 0) return 'N/A';
    return fmtCompact(Math.ceil(cpu / prodRate));
}

function hourlyOutput(colos: number, prodRate: number, cpu: number): string {
    if (prodRate <= 0 || cpu <= 0) return '0';
    return fmtCompact(Math.floor((colos * prodRate) / cpu));
}

/** Drones per hour produced from the current colonist distribution and the
 *  planet's per-group fig factors.*/
function dronesPerHourFrom(msg: PlanetDisplayMsg): number {
    const fromFuel = msg.fig_factor_fuel > 0 ? msg.colonists_fuel / msg.fig_factor_fuel : 0;
    const fromOrg = msg.fig_factor_org > 0 ? msg.colonists_organics / msg.fig_factor_org : 0;
    const fromEqu = msg.fig_factor_equ > 0 ? msg.colonists_equipment / msg.fig_factor_equ : 0;
    return fromFuel + fromOrg + fromEqu;
}

/** Effective colonists-per-drone-per-hour given the current distribution.
 */
function effectiveColosPerDrone(msg: PlanetDisplayMsg): string {
    const totalAssigned =
        (msg.fig_factor_fuel > 0 ? msg.colonists_fuel : 0) +
        (msg.fig_factor_org > 0 ? msg.colonists_organics : 0) +
        (msg.fig_factor_equ > 0 ? msg.colonists_equipment : 0);
    const drones = dronesPerHourFrom(msg);
    if (drones <= 0 || totalAssigned <= 0) return 'N/A';
    return fmtCompact(Math.ceil(totalAssigned / drones));
}

function renderPlanetTable(
    ctx: { io: { term: { writeln: (s: string) => void } }; world: { currentSector: number } },
    msg: PlanetDisplayMsg,
): void {
    const sector = ctx.world.currentSector;
    const cpu = msg.colos_per_unit_per_hour;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(PLANET.displayTitle, { id: msg.universe_planet_number, sector, name: msg.name }),
    );
    ctx.io.term.writeln(
        render(PLANET.displayClass, {
            class: msg.planetType,
            type: msg.displayType ?? msg.planetType,
        }),
    );
    ctx.io.term.writeln(render(PLANET.displayOwner, { owner: msg.owner_name ?? 'unclaimed' }));
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.displayTableHead1));
    ctx.io.term.writeln(render(PLANET.displayTableHead2));
    ctx.io.term.writeln(render(PLANET.displayTableSep));

    const productRows = [
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
    ];
    for (const r of productRows) {
        ctx.io.term.writeln(
            render(PLANET.displayTableRow, {
                item: padStartVisible(r.item, 9),
                colos: padStartVisible(fmtCompact(r.colos), 9),
                c2b1: padStartVisible(colsToBuildOnePerHour(r.prod, cpu), 9),
                hourly: padStartVisible(hourlyOutput(r.colos, r.prod, cpu), 9),
                planet: padStartVisible(fmtCompact(r.planet), 9),
                ship: padStartVisible(fmtCompact(r.ship), 9),
                max: padStartVisible(fmtCompact(r.max), 9),
            }),
        );
    }
    const dronesHourly = Math.floor(dronesPerHourFrom(msg));
    ctx.io.term.writeln(
        render(PLANET.displayTableRow, {
            item: padStartVisible('Drones', 9),
            colos: padStartVisible('N/A', 9),
            c2b1: padStartVisible(effectiveColosPerDrone(msg), 9),
            hourly: padStartVisible(fmtCompact(dronesHourly), 9),
            planet: padStartVisible(fmtCompact(msg.drones), 9),
            ship: padStartVisible(fmtCompact(msg.ship_drones), 9),
            max: padStartVisible(fmtCompact(msg.max_drones), 9),
        }),
    );

    ctx.io.term.writeln(render(PLANET.displayHolds, { holds: fmt(msg.empty_holds) }));
    renderBaseLine(ctx, msg);
}

function renderBaseLine(
    ctx: { io: { term: { writeln: (s: string) => void } } },
    msg: PlanetDisplayMsg,
): void {
    const targetLevel = msg.base_construction_target_level;
    const completesAt = msg.base_construction_completes_at;
    if (targetLevel !== null && completesAt !== null) {
        const completes = new Date(completesAt);
        const msLeft = completes.getTime() - Date.now();
        const hoursLeft = Math.max(0, Math.ceil(msLeft / (60 * 60 * 1000)));
        ctx.io.term.writeln(
            render(PLANET.displayBaseConstructing, {
                level: targetLevel,
                completes: completes.toLocaleString(),
                hours: hoursLeft,
            }),
        );
        return;
    }
    if (msg.base_level !== null && msg.base_level >= 1) {
        ctx.io.term.writeln(
            render(PLANET.displayBaseSummary, {
                level: msg.base_level,
                treasury: fmt(msg.base_treasury ?? 0),
            }),
        );
        const range = msg.base_transporter_range ?? 0;
        if (range >= 1) {
            ctx.io.term.writeln(render(PLANET.displayTransporterLine, { hops: range }));
        }
    }
}

type PlanetContext = Pick<GameContext, 'io' | 'input' | 'ship' | 'planet' | 'world'> &
    DisplayCtx &
    DisplayPlanetCtx &
    DisplayStarbaseCtx &
    DisplayComputerCtx &
    RefreshMinimapCtx;

export const planetInfo: Handler<'planetInfoResult', PlanetContext> = (ctx, msg) => {
    if (msg.hasPlanet) showPlanetMenu(ctx, msg.name, msg.colonists);
    else showNoPlanet(ctx);
};

export const takeColonists: Handler<'takeColonistsResult', PlanetContext> = (ctx, msg) => {
    ctx.ship.shipColonists = msg.shipColonists;
    if (msg.commodity === 'fuel') ctx.world.earthColonists = msg.planetColonists;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(PLANET.takeColonistsHeader, {
            qty: fmt(msg.quantity),
            commodity: msg.commodity,
        }),
    );
    ctx.io.term.writeln(render(PLANET.planetColonistsLine, { count: fmt(msg.planetColonists) }));
    ctx.io.term.writeln(render(PLANET.shipColonistsLine, { count: msg.shipColonists }));
    if (msg.players !== undefined) {
        ctx.world.sectorPlayers = msg.players;
    }
};

function applyCommodityResult(
    ctx: PlanetContext,
    commodity: 'fuel' | 'organics' | 'equipment' | 'drones',
    planetAmount: number,
    shipAmount: number,
): void {
    if (commodity === 'fuel') {
        ctx.planet.fuel = planetAmount;
        ctx.ship.shipFuel = shipAmount;
    } else if (commodity === 'organics') {
        ctx.planet.organics = planetAmount;
        ctx.ship.shipOrganics = shipAmount;
    } else if (commodity === 'equipment') {
        ctx.planet.equipment = planetAmount;
        ctx.ship.shipEquipment = shipAmount;
    } else {
        ctx.planet.drones = planetAmount;
        ctx.ship.shipDrones = shipAmount;
    }
}

export const takeCommodity: Handler<'takeCommodityResult', PlanetContext> = (ctx, msg) => {
    applyCommodityResult(ctx, msg.commodity, msg.planetCommodity, msg.shipCommodity);
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

export const leaveCommodity: Handler<'leaveCommodityResult', PlanetContext> = (ctx, msg) => {
    applyCommodityResult(ctx, msg.commodity, msg.planetCommodity, msg.shipCommodity);
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

export const changePopulation: Handler<'changePopulationResult', PlanetContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PLANET.populationMoved));
    void msg;
};

export const leaveColonists: Handler<'leaveColonistsResult', PlanetContext> = (ctx, msg) => {
    ctx.ship.shipColonists = msg.shipColonists;
    if (msg.commodity === 'fuel') ctx.world.earthColonists = msg.planetColonists;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(
        render(PLANET.leaveColonistsHeader, {
            qty: fmt(msg.quantity),
            commodity: msg.commodity,
        }),
    );
    ctx.io.term.writeln(render(PLANET.planetColonistsLine, { count: fmt(msg.planetColonists) }));
    ctx.io.term.writeln(render(PLANET.shipColonistsLine, { count: msg.shipColonists }));

    if (msg.players !== undefined) {
        ctx.world.sectorPlayers = msg.players;
    }
};

function cachePlanetInteractionState(ctx: PlanetContext, msg: PlanetDisplayMsg): void {
    ctx.ship.planetEmptyHolds = msg.empty_holds;
    ctx.ship.shipColonists = msg.ship_colonists;
    ctx.ship.shipDrones = msg.ship_drones;
    ctx.ship.shipMaxDrones = msg.ship_max_drones;
    ctx.ship.shipFuel = msg.ship_fuel;
    ctx.ship.shipOrganics = msg.ship_organics;
    ctx.ship.shipEquipment = msg.ship_equipment;
    ctx.planet.fuel = msg.fuel;
    ctx.planet.organics = msg.organics;
    ctx.planet.equipment = msg.equipment;
    ctx.planet.drones = msg.drones;
    ctx.planet.maxFuel = msg.max_fuel;
    ctx.planet.maxOrg = msg.max_org;
    ctx.planet.maxEqu = msg.max_equ;
    ctx.planet.maxDrones = msg.max_drones;
}

export const landOnPlanet: Handler<'landOnPlanetResult', PlanetContext> = (ctx, msg) => {
    cachePlanetInteractionState(ctx, msg);
    const isEarth = msg.name === 'Earth';
    ctx.world.mode = isEarth ? Menu.PlanetEarth : Menu.Planet;
    if (isEarth) {
        ctx.world.earthColonists = msg.colonists_fuel ?? 0;
        showEarthMenu(ctx, ctx.world.earthColonists);
    } else {
        ctx.io.term.writeln('');
        ctx.io.term.writeln(render(PLANET.landedHeader, { name: msg.name }));
        renderPlanetTable(ctx, msg);
    }
};

export const planetDisplay: Handler<'planetDisplayResult', PlanetContext> = (ctx, msg) => {
    cachePlanetInteractionState(ctx, msg);
    renderPlanetTable(ctx, msg);
};

export const destroyPlanet: Handler<'destroyPlanetResult', PlanetContext> = (ctx, msg) => {
    if (msg.destroyed) {
        ctx.world.mode = Menu.Sector;
        ctx.io.term.writeln(render(EVENT.planetDestroyed, { name: msg.planetName }));
    }
};

export const useTerraformDevice: Handler<'useTerraformDeviceResult', PlanetContext> = async (
    ctx,
    msg,
) => {
    if (!msg.success || !msg.planet) {
        const reason =
            msg.reason === 'no_devices'
                ? 'No terraform devices on ship.'
                : msg.reason === 'restricted_sector'
                  ? 'Cannot terraform in this sector.'
                  : 'Terraform failed.';
        ctx.io.term.writeln(render(EVENT.terraformFailure, { reason }));
        return;
    }
    const planet = msg.planet;
    ctx.io.term.writeln(render(EVENT.terraformNarrative));
    if (msg.collision) ctx.io.term.writeln(render(EVENT.terraformCollision));
    ctx.io.term.writeln(
        render(EVENT.terraformDevicesRemaining, { count: msg.terraformDevices }),
    );

    const typeLabel = planet.displayType ?? planet.type;
    const rawName = await askLineRaw(
        ctx,
        render(EVENT.terraformNamePrompt, {
            type: typeLabel,
            defaultName: planet.name,
        }),
    );
    const name = rawName === null || rawName === '' ? planet.name : rawName;
    let ownership: 'personal' | 'clan' = 'personal';
    if (ctx.player.clanId !== null) {
        const ch = await askChar(ctx, render(EVENT.terraformOwnershipPrompt), ['c', 'p'], {
            defaultChar: 'p',
        });
        ownership = ch === 'c' ? 'clan' : 'personal';
    }
    ctx.io.sendMsg({
        type: ClientTag.SetTerraformedPlanet,
        planetId: planet.id,
        name,
        ownership,
    });
    const response = await awaitResponse(ctx, [
        ServerTag.SetTerraformedPlanetResult,
        ServerTag.Error,
    ]);
    if (response === null) return;
    if (response.type === ServerTag.SetTerraformedPlanetResult) {
        if (response.outcome === 'success') {
            ctx.io.term.writeln(render(EVENT.terraformConfirmed, { name: response.name }));
        } else {
            ctx.io.term.writeln(render(EVENT.terraformFailure, { reason: response.message }));
        }
    }
};

export const leavePlanet: Handler<'leavePlanetResult', PlanetContext> = (ctx) => {
    ctx.world.mode = Menu.Sector;
    ctx.io.term.writeln(render(EVENT.leftPlanet));
};

export const listPlanets: Handler<'listPlanetsResult', PlanetContext> = (ctx, msg) => {
    ctx.io.term.writeln('');
    if (msg.planets.length === 0) {
        ctx.io.term.writeln(render(PLANET.listEmpty));
    } else {
        ctx.io.term.writeln(render(PLANET.listHeader));
        for (const p of msg.planets) {
            ctx.io.term.writeln(
                render(PLANET.listRow, {
                    sector: p.sectorNumber,
                    name: p.name,
                    type: p.displayType ?? p.type,
                }),
            );
            ctx.io.term.writeln(
                render(PLANET.listColonists, {
                    fuel: p.colonists_fuel,
                    organics: p.colonists_organics,
                    equipment: p.colonists_equipment,
                }),
            );
        }
    }
};

export const terraformInfo: Handler<'terraformInfoResult', PlanetContext> = (ctx, msg) => {
    if (msg.canTerraform) {
        ctx.io.term.writeln(render(EVENT.terraformDevicesAvailable, { count: msg.devices }));

        return terraformAskAndFire(ctx);
    } else if (msg.reason === 'no_devices') {
        ctx.io.term.writeln(render(EVENT.terraformNoDevices));
    } else {
        ctx.io.term.writeln(render(NOTIFY.error, { message: 'Cannot terraform here.' }));
    }
};

async function terraformAskAndFire(ctx: PlanetContext): Promise<void> {
    const ok = await askConfirm(ctx, render(EVENT.terraformConfirm), { defaultValue: false });
    if (ok) {
        ctx.io.sendMsg({ type: ClientTag.UseTerraformDevice });
    }
}

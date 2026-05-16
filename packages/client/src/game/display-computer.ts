import { ClientTag } from '@twnr/shared';
import type { ShipCatalogEntry, PlanetConfig } from '@twnr/shared';
import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { COMPUTER, COMMON, STARBASE } from './messages/index.js';
import { indexToLetter } from './display-starbase.js';
import { centerVisible, threeColRows } from './display-utils.js';

export type DisplayComputerCtx = Pick<
    GameContext,
    'catalogs' | 'io' | 'minimap' | 'player' | 'ship' | 'world'
>;

export function showComputerPrompt(ctx: DisplayComputerCtx) {
    ctx.io.term.write(render(COMPUTER.prompt, { sector: ctx.world.currentSector }));
}

export function showComputerHelp(ctx: DisplayComputerCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render('[mg]   Computer Commands[/mg]'));
    ctx.io.term.writeln(
        render('[by]   =[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]='),
    );
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'K', text: '[bc]Known Universe[/bc]' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'L', text: '[bc]List Traders[/bc]' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'C', text: '[bc]Ship Catalog[/bc]' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'J', text: '[bc]Planetary Specs[/bc]' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: ';', text: '[bc]Current Ship Specs[/bc]' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Y', text: '[bc]Your Planets[/bc]' }));
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Z', text: '[bc]Active Ship Scan[/bc]' }));
    ctx.io.term.writeln(
        render(COMMON.menuRow, { key: 'O', text: '[bc]Change Ship Ownership[/bc]' }),
    );
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: '[bc]Exit Computer[/bc]' }));
}

export function renderVisitedSectorsResult(
    ctx: DisplayComputerCtx,
    msg: { sectors: number[]; totalSectors: number },
    mode: 'explored' | 'unexplored',
) {
    const visited = new Set(msg.sectors);
    ctx.io.term.writeln('');
    if (mode === 'explored') {
        const explored = msg.sectors.sort((a, b) => a - b);
        ctx.io.term.writeln(render(COMPUTER.exploredHeader, { count: explored.length }));
        ctx.io.term.writeln(
            explored.map((s) => render(COMPUTER.exploredSector, { n: s })).join(' '),
        );
    } else {
        const unexplored: number[] = [];
        for (let i = 1; i <= msg.totalSectors; i++) {
            if (!visited.has(i)) unexplored.push(i);
        }
        ctx.io.term.writeln(render(COMPUTER.unexploredHeader, { count: unexplored.length }));
        ctx.io.term.writeln(
            unexplored.map((s) => render(COMPUTER.unexploredSector, { n: s })).join(' '),
        );
    }
}

async function loadShipConfigs(ctx: DisplayComputerCtx): Promise<boolean> {
    if (ctx.catalogs.ships) return true;
    ctx.io.term.writeln(render(STARBASE.loadingShipCatalog));
    try {
        const res = await fetch('/api/ships');
        ctx.catalogs.ships = await res.json();
        return true;
    } catch {
        ctx.io.term.writeln(render(STARBASE.shipCatalogFailed));
        return false;
    }
}

export async function showShipCatalog(ctx: DisplayComputerCtx) {
    if (!(await loadShipConfigs(ctx))) return;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(COMPUTER.shipCatalogHeader));
    ctx.catalogs.ships!.forEach((ship, i) => {
        ctx.io.term.writeln(
            render(COMPUTER.shipCatalogRow, {
                letter: indexToLetter(i),
                name: ship.display_name ?? ship.name,
            }),
        );
    });
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

function boolToYesNoString(val: boolean): string {
    return val ? COMPUTER.shipDetailBoolYes : COMPUTER.shipDetailBoolNo;
}

function fmtNum(n: number): string {
    return n.toLocaleString();
}

const HW_DISPLAY: { name: string; label: string; isToggle?: boolean }[] = [
    { name: 'hyperspace_1', label: 'Hyperspace 1', isToggle: true },
    { name: 'hyperspace_2', label: 'Hyperspace 2', isToggle: true },
    { name: 'visual_scanner', label: 'Visual Scanner', isToggle: true },
    { name: 'planet_scanner', label: 'Planet Scanner', isToggle: true },
    { name: 'buoy', label: 'Max Beacons' },
    { name: 'proximity_mine', label: 'Max Prox Mines' },
    { name: 'seeker_mine', label: 'Max Limpet Mines' },
    { name: 'cloaking_device', label: 'Max Cloaking' },
    { name: 'corbomite', label: 'Max Corbomite' },
    { name: 'photon_torpedo', label: 'Max Photon Torps' },
    { name: 'mine_disruptor', label: 'Max Disruptors' },
    { name: 'recon_drone', label: 'Max Recon Drones' },
    { name: 'planet_buster', label: 'Max Planet Busters' },
    { name: 'terraform_device', label: 'Max Terraform' },
];

const SHIP_DETAIL_LABEL_WIDTH = 18;
const SHIP_DETAIL_VALUE_WIDTH = 10;
const SHIP_DETAIL_BODY_WIDTH = 92;

export function showShipDetail(ctx: DisplayComputerCtx, ship: ShipCatalogEntry) {
    const { term } = ctx.io;
    term.writeln('');
    const headerText = render(COMPUTER.shipDetailHeader, {
        name: ship.display_name ?? ship.name,
    });
    term.writeln('  ' + centerVisible(headerText, SHIP_DETAIL_BODY_WIDTH));
    term.writeln('');
    if (ship.make) {
        term.writeln(render(COMPUTER.shipDetailLine, { label: 'Make', value: ship.make }));
    }

    const hw = ship.hardware ?? {};
    const specs: { label: string; value: string }[] = [
        { label: 'Main Drive Cost', value: fmtNum(ship.cost_drive ?? 0) },
        { label: 'Initial Holds', value: fmtNum(ship.starting_holds) },
        { label: 'Maximum Shields', value: fmtNum(ship.max_shields) },
        { label: 'Computer Cost', value: fmtNum(ship.cost_computer ?? 0) },
        { label: 'Maximum Holds', value: fmtNum(ship.max_holds) },
        { label: 'Max Drones', value: fmtNum(ship.max_drones) },
        { label: 'Ship Hull Cost', value: fmtNum(ship.cost_hull ?? 0) },
        { label: 'Basic Hold Cost', value: fmtNum(ship.hold_cost ?? 0) },
        { label: 'Max Drone Attack', value: fmtNum(ship.max_drone_attack) },
        { label: 'Ship Base Cost', value: fmtNum(ship.base_cost ?? 0) },
        { label: 'Turns Per Warp', value: fmtNum(ship.turns_per_warp) },
        { label: 'Transport Range', value: fmtNum(ship.transporter_range) },
        { label: 'Speed', value: fmtNum(ship.speed) },
        { label: 'Offensive Odds', value: String(ship.odds_offensive) },
        { label: 'Defensive Odds', value: String(ship.odds_defensive) },
        { label: 'Escape Pod', value: boolToYesNoString(ship.has_pod) },
        { label: 'Can Land', value: boolToYesNoString(ship.can_land) },
        { label: 'Tractor Beam', value: boolToYesNoString(ship.has_tractor) },
        { label: 'Interdictor', value: boolToYesNoString(ship.has_interdictor) },
        { label: 'Visual Scanner', value: boolToYesNoString((hw.visual_scanner ?? 0) > 0) },
        { label: 'Planet Scanner', value: boolToYesNoString((hw.planet_scanner ?? 0) > 0) },
    ];
    for (const row of threeColRows(specs, {
        labelWidth: SHIP_DETAIL_LABEL_WIDTH,
        valueWidth: SHIP_DETAIL_VALUE_WIDTH,
        separator: COMPUTER.shipDetailColon,
        labelColor: 'g',
        valueColor: 'bc',
    })) {
        term.writeln(render(COMPUTER.shipDetailRow, { row }));
    }

    // Hardware capacities (after specs). Toggles become Yes/No; stackables
    // show their max count.
    const hwItems: { label: string; value: string }[] = [];
    for (const h of HW_DISPLAY) {
        if (h.name === 'visual_scanner' || h.name === 'planet_scanner') continue; // shown above
        const val = hw[h.name] ?? 0;
        hwItems.push({
            label: h.label,
            value: h.isToggle ? boolToYesNoString(val > 0) : fmtNum(val),
        });
    }
    if (hwItems.length > 0) {
        term.writeln('');
        for (const row of threeColRows(hwItems, {
            labelWidth: SHIP_DETAIL_LABEL_WIDTH,
            valueWidth: SHIP_DETAIL_VALUE_WIDTH,
            separator: COMPUTER.shipDetailColon,
            labelColor: 'g',
            valueColor: 'bc',
        })) {
            term.writeln(render(COMPUTER.shipDetailRow, { row }));
        }
    }

    if (ship.notes) {
        term.writeln('');
        term.writeln(render(COMPUTER.shipDetailLine, { label: 'Notes', value: ship.notes }));
    }
}

export async function showPlanetSpecs(ctx: DisplayComputerCtx) {
    if (!ctx.catalogs.planets) {
        ctx.io.term.writeln(render(COMPUTER.planetSpecsLoading));
        try {
            const res = await fetch('/api/planets');
            ctx.catalogs.planets = await res.json();
        } catch {
            ctx.io.term.writeln(render(COMPUTER.planetSpecsFailed));
            return;
        }
    }
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(COMPUTER.planetSpecsHeader));
    ctx.catalogs.planets!.forEach((planet, i) => {
        ctx.io.term.writeln(
            render(COMPUTER.planetSpecsRow, {
                letter: indexToLetter(i),
                type: planet.displayName ?? planet.slug,
            }),
        );
    });
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

export function showPlanetDetail(ctx: DisplayComputerCtx, planet: PlanetConfig) {
    const { term } = ctx.io;
    term.writeln('');
    term.writeln(render(COMPUTER.planetDetailHeader, { type: planet.displayName ?? planet.slug }));
    term.writeln(render(COMPUTER.planetDetailDescription, { description: planet.description }));
    const pad = (s: string) => s.padEnd(20);
    term.writeln(
        render(COMPUTER.planetDetailLine, {
            label: pad('Max Fuel Colos'),
            value: planet.maxFuelColos,
        }),
    );
    term.writeln(
        render(COMPUTER.planetDetailLine, {
            label: pad('Max Org Colos'),
            value: planet.maxOrgColos,
        }),
    );
    term.writeln(
        render(COMPUTER.planetDetailLine, {
            label: pad('Max Equ Colos'),
            value: planet.maxEquColos,
        }),
    );
    term.writeln(
        render(COMPUTER.planetDetailLine, {
            label: pad('Max Citadel'),
            value: planet.maxCitadel,
        }),
    );
    term.writeln(
        render(COMPUTER.planetDetailLine, {
            label: pad('Fuel Production'),
            value: planet.fuelProduction,
        }),
    );
    term.writeln(
        render(COMPUTER.planetDetailLine, {
            label: pad('Organics Production'),
            value: planet.organicsProduction,
        }),
    );
    term.writeln(
        render(COMPUTER.planetDetailLine, {
            label: pad('Equip Production'),
            value: planet.equipmentProduction,
        }),
    );
}

export async function showCurrentShipSpecs(ctx: DisplayComputerCtx) {
    if (!(await loadShipConfigs(ctx))) return;
    if (!ctx.ship.currentShipName) {
        ctx.io.term.writeln(render(COMPUTER.shipDataRequesting));
        ctx.io.sendMsg({ type: ClientTag.ShipInfo });
        return;
    }
    const ship = ctx.catalogs.ships!.find((s) => s.name === ctx.ship.currentShipName);
    if (!ship) {
        ctx.io.term.writeln(
            render(COMPUTER.shipConfigNotFound, { name: ctx.ship.currentShipName }),
        );
        return;
    }
    showShipDetail(ctx, ship);
}

export type OwnedShipRowDisplay = {
    id: number;
    shipNumber: number;
    sector: number | null;
    drones: number;
    shields: number;
    holds: number;
    hops: number | null;
    typeName: string;
    typeDisplayName: string | null;
    transporterRange: number;
    ownerLabel: string;
    ownerPlayerId: number | null;
    ownerClanId: number | null;
};

type RenderActiveShipScanOpts = {
    sortByHops?: boolean;
    /** When set, color hops green if `hops <= rangeFromCurrentShip`, red otherwise. */
    rangeFromCurrentShip?: number | null;
};

export function renderActiveShipScan(
    ctx: DisplayComputerCtx,
    msg: { currentShipId: number | null; ships: OwnedShipRowDisplay[] },
    opts: RenderActiveShipScanOpts = {},
) {
    const { term } = ctx.io;
    term.writeln('');
    term.writeln(render(COMPUTER.activeShipScanHeader));
    term.writeln(render(COMPUTER.activeShipScanColumns));
    term.writeln(render(COMPUTER.activeShipScanRule));
    if (msg.ships.length === 0) {
        term.writeln(render(COMPUTER.activeShipScanEmpty));
        return;
    }
    const ships = opts.sortByHops
        ? [...msg.ships].sort((a, b) => hopsKey(a.hops) - hopsKey(b.hops))
        : msg.ships;
    const range = opts.rangeFromCurrentShip ?? null;
    for (const s of ships) {
        const isCurrent = s.id === msg.currentShipId;
        const sectStr = s.sector === null ? '----' : String(s.sector);
        const hopsStr = s.hops === null ? '   -' : String(s.hops).padStart(4);
        const hopsTemplate =
            range === null
                ? COMPUTER.activeShipScanHopsNeutral
                : s.hops !== null && s.hops <= range
                  ? COMPUTER.activeShipScanHopsInRange
                  : COMPUTER.activeShipScanHopsOutOfRange;
        const ownerStr =
            s.ownerClanId !== null
                ? 'clan'
                : s.ownerPlayerId === ctx.player.id
                  ? 'you'
                  : s.ownerLabel;
        term.writeln(
            render(COMPUTER.activeShipScanRow, {
                marker: isCurrent
                    ? render(COMPUTER.activeShipScanCurrentMarker)
                    : render(COMPUTER.activeShipScanBlankMarker),
                shipNum: String(s.shipNumber).padStart(4),
                sect: sectStr.padStart(4),
                name: '.'.padEnd(16),
                owner: ownerStr.padEnd(10),
                drones: String(s.drones).padStart(6),
                shields: String(s.shields).padStart(7),
                holds: String(s.holds).padStart(5),
                hops: render(hopsTemplate, { hops: hopsStr }),
                type: (s.typeDisplayName ?? s.typeName).padEnd(16),
            }),
        );
    }
}

function hopsKey(hops: number | null): number {
    return hops === null ? Number.MAX_SAFE_INTEGER : hops;
}

export function renderTransporterPrelude(
    ctx: DisplayComputerCtx,
    msg: {
        currentShipTypeName: string | null;
        currentShipTypeDisplayName: string | null;
        currentShipTransporterRange: number | null;
    },
) {
    const { term } = ctx.io;
    const shipName = msg.currentShipTypeDisplayName ?? msg.currentShipTypeName;
    if (!shipName || msg.currentShipTransporterRange === null) {
        term.writeln(render(COMPUTER.transporterNoCurrentShip));
        return;
    }
    if (msg.currentShipTransporterRange === 0) {
        term.writeln(render(COMPUTER.transporterIntrasectorOnly, { ship: shipName }));
    } else {
        term.writeln(
            render(COMPUTER.transporterRangeStatement, {
                ship: shipName,
                range: msg.currentShipTransporterRange,
            }),
        );
    }
}

export function renderTransporterOptions(ctx: DisplayComputerCtx) {
    const { term } = ctx.io;
    term.writeln('');
    term.writeln(render(COMPUTER.transporterOptionDetails));
    term.writeln(render(COMPUTER.transporterOptionExit));
}

export type ShipDetailDisplay = {
    shipNumber: number;
    typeName: string;
    typeDisplayName: string | null;
    sector: number | null;
    drones: number;
    maxDrones: number;
    shields: number;
    maxShields: number;
    holds: number;
    maxHolds: number;
    transporterRange: number;
    cargoFuel: number;
    cargoOrganics: number;
    cargoEquipment: number;
    cargoColonists: number;
    hardware: Record<string, number>;
    hardwareMax: Record<string, number>;
};

export function renderShipDetail(ctx: DisplayComputerCtx, s: ShipDetailDisplay) {
    const { term } = ctx.io;
    term.writeln('');
    term.writeln(render(COMPUTER.transporterDetailHeader, { shipNum: s.shipNumber }));
    const pad = (label: string) => label.padEnd(16);
    const xy = (a: number, b: number) => `${a} / ${b}`;
    const lines: { label: string; value: string | number }[] = [
        { label: 'Type', value: s.typeDisplayName ?? s.typeName },
        { label: 'Sector', value: s.sector ?? '—' },
        { label: 'Drones', value: xy(s.drones, s.maxDrones) },
        { label: 'Shields', value: xy(s.shields, s.maxShields) },
        { label: 'Holds', value: xy(s.holds, s.maxHolds) },
        { label: 'Transport Range', value: s.transporterRange },
        { label: 'Fuel', value: s.cargoFuel },
        { label: 'Organics', value: s.cargoOrganics },
        { label: 'Equipment', value: s.cargoEquipment },
        { label: 'Colonists', value: s.cargoColonists },
    ];
    for (const l of lines) {
        term.writeln(
            render(COMPUTER.transporterDetailLine, {
                label: pad(l.label),
                value: l.value,
            }),
        );
    }
    if (ctx.catalogs.hardware && ctx.catalogs.hardware.length > 0) {
        let any = false;
        for (const item of ctx.catalogs.hardware) {
            const max = s.hardwareMax[item.name] ?? 0;
            if (max === 0) continue;
            const qty = s.hardware[item.name] ?? 0;
            if (!any) {
                term.writeln('');
                any = true;
            }
            term.writeln(
                render(COMPUTER.transporterDetailLine, {
                    label: pad(item.label),
                    value: `${qty} / ${max}`,
                }),
            );
        }
    }
}

export async function showTraderList(ctx: DisplayComputerCtx) {
    ctx.io.term.writeln(render(COMPUTER.traderListLoading));
    try {
        const res = await fetch(`/api/universes/${ctx.player.universeId}/players`);
        const traders: {
            name: string;
            shipName: string | null;
            coloredShipName: string | null;
            clanNumber: number | null;
            clanName: string | null;
        }[] = await res.json();
        ctx.io.term.writeln('');
        ctx.io.term.writeln(render(COMPUTER.traderListHeader));
        ctx.io.term.writeln(
            render(COMPUTER.traderListColumns, {
                name: 'Name'.padEnd(24),
                clan: 'Clan'.padEnd(5),
                ship: 'Ship',
            }),
        );
        for (const t of traders) {
            const ship =
                t.shipName === null
                    ? render(COMPUTER.traderListShipDestroyed)
                    : (t.coloredShipName ?? t.shipName);
            const clanCell =
                t.clanNumber === null
                    ? render(COMPUTER.traderListClanNA, {}) + '   '
                    : render(COMPUTER.traderListClanValue, {
                          n: String(t.clanNumber).padEnd(4),
                      });
            ctx.io.term.writeln(
                render(COMPUTER.traderListRow, {
                    name: t.name.padEnd(24),
                    clan: clanCell,
                    ship,
                }),
            );
        }
    } catch {
        ctx.io.term.writeln(render(COMPUTER.traderListFailed));
    }
}

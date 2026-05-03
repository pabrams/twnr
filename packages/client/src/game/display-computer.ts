import { ClientMsgType, Menu } from '@twnr/shared';
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
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: '[bc]Exit Computer[/bc]' }));
    showComputerPrompt(ctx);
}

export function showKnownUniverseMenu(ctx: DisplayComputerCtx) {
    ctx.io.term.write(render(COMPUTER.knownUniversePrompt));
}

export function showExploredSectors(ctx: DisplayComputerCtx) {
    ctx.minimap.knownUniverseMode = 'explored';
    ctx.io.sendMsg({ type: ClientMsgType.VisitedSectors });
}

export function showUnexploredSectors(ctx: DisplayComputerCtx) {
    ctx.minimap.knownUniverseMode = 'unexplored';
    ctx.io.sendMsg({ type: ClientMsgType.VisitedSectors });
}

export function renderVisitedSectorsResult(
    ctx: DisplayComputerCtx,
    msg: { sectors: number[]; totalSectors: number },
) {
    const mode = ctx.minimap.knownUniverseMode;
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
    ctx.io.sendMsg({ type: ClientMsgType.ChangeMenu, menu: Menu.Computer });
    showComputerPrompt(ctx);
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
        showComputerPrompt(ctx);
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
    showShipInterestPrompt(ctx);
}

/**
 * Return the raw tag-markup form so the outer `render()` on the whole row
 * processes it. If we pre-rendered here, the string would already contain
 * ANSI escapes, and padding helpers (which strip `[tag]` markup, not ANSI)
 * would miscount its visible length and misalign the column.
 */
function boolStr(val: boolean): string {
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
    { name: 'buoy', label: 'Max Buoys' },
    { name: 'proximity_mine', label: 'Max Prox Mines' },
    { name: 'seeker_mine', label: 'Max Seeker Mines' },
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
        { label: 'Escape Pod', value: boolStr(ship.has_pod) },
        { label: 'Can Land', value: boolStr(ship.can_land) },
        { label: 'Tractor Beam', value: boolStr(ship.has_tractor) },
        { label: 'Interdictor', value: boolStr(ship.has_interdictor) },
        { label: 'Visual Scanner', value: boolStr((hw.visual_scanner ?? 0) > 0) },
        { label: 'Planet Scanner', value: boolStr((hw.planet_scanner ?? 0) > 0) },
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
            value: h.isToggle ? boolStr(val > 0) : fmtNum(val),
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

/**
 * Repeat prompt shown after a ship's stats. Both the Computer ship-catalog
 * flow and the Shipyards examine flow reuse it so behavior stays consistent.
 */
export function showShipInterestPrompt(ctx: DisplayComputerCtx) {
    ctx.io.term.write(render(COMPUTER.shipInterestPrompt));
}

export async function showPlanetSpecs(ctx: DisplayComputerCtx) {
    if (!ctx.catalogs.planets) {
        ctx.io.term.writeln(render(COMPUTER.planetSpecsLoading));
        try {
            const res = await fetch('/api/planets');
            ctx.catalogs.planets = await res.json();
        } catch {
            ctx.io.term.writeln(render(COMPUTER.planetSpecsFailed));
            showComputerPrompt(ctx);
            return;
        }
    }
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(COMPUTER.planetSpecsHeader));
    ctx.catalogs.planets!.forEach((planet, i) => {
        ctx.io.term.writeln(
            render(COMPUTER.planetSpecsRow, {
                letter: indexToLetter(i),
                type: planet.type,
            }),
        );
    });
    ctx.io.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
    showPlanetSpecsPrompt(ctx);
}

export function showPlanetSpecsPrompt(ctx: DisplayComputerCtx) {
    ctx.io.term.write(render(COMPUTER.planetSpecsPrompt));
}

export function showPlanetDetail(ctx: DisplayComputerCtx, planet: PlanetConfig) {
    const { term } = ctx.io;
    term.writeln('');
    term.writeln(render(COMPUTER.planetDetailHeader, { type: planet.type }));
    term.writeln(render(COMPUTER.planetDetailDescription, { description: planet.description }));
    const pad = (s: string) => s.padEnd(20);
    term.writeln(
        render(COMPUTER.planetDetailLine, {
            label: pad('Max Colonists'),
            value: planet.maxColonists,
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
    showPlanetSpecsPrompt(ctx);
}

export async function showCurrentShipSpecs(ctx: DisplayComputerCtx) {
    if (!(await loadShipConfigs(ctx))) return;
    if (!ctx.ship.currentShipName) {
        ctx.io.term.writeln(render(COMPUTER.shipDataRequesting));
        ctx.io.sendMsg({ type: ClientMsgType.ShipInfo });
        showComputerPrompt(ctx);
        return;
    }
    const ship = ctx.catalogs.ships!.find((s) => s.name === ctx.ship.currentShipName);
    if (!ship) {
        ctx.io.term.writeln(
            render(COMPUTER.shipConfigNotFound, { name: ctx.ship.currentShipName }),
        );
        showComputerPrompt(ctx);
        return;
    }
    showShipDetail(ctx, ship);
    showComputerPrompt(ctx);
}

export async function showTraderList(ctx: DisplayComputerCtx) {
    ctx.io.term.writeln(render(COMPUTER.traderListLoading));
    try {
        const res = await fetch(`/api/universes/${ctx.player.universeId}/players`);
        const traders: {
            name: string;
            shipName: string | null;
            coloredShipName: string | null;
        }[] = await res.json();
        ctx.io.term.writeln('');
        ctx.io.term.writeln(render(COMPUTER.traderListHeader));
        ctx.io.term.writeln(render(COMPUTER.traderListColumns, { name: 'Name'.padEnd(24) }));
        for (const t of traders) {
            const ship =
                t.shipName === null
                    ? render(COMPUTER.traderListShipDestroyed)
                    : (t.coloredShipName ?? t.shipName);
            ctx.io.term.writeln(
                render(COMPUTER.traderListRow, {
                    name: t.name.padEnd(24),
                    ship,
                }),
            );
        }
    } catch {
        ctx.io.term.writeln(render(COMPUTER.traderListFailed));
    }
    showComputerPrompt(ctx);
}

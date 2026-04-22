import { ClientMsgType, Menu } from '@twnr/shared';
import type { ShipCatalogEntry, PlanetConfig } from '@twnr/shared';
import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { COMPUTER, COMMON, STARBASE } from './messages/index.js';
import { indexToLetter } from './display-starbase.js';

export function showComputerPrompt(ctx: GameContext) {
    ctx.term.write(render(COMPUTER.prompt, { sector: ctx.currentSector }));
}

export function showComputerActivated(ctx: GameContext) {
    ctx.term.writeln(render(COMPUTER.activated));
    showComputerPrompt(ctx);
}

export function showComputerDeactivated(ctx: GameContext) {
    ctx.term.writeln(render(COMPUTER.deactivated));
}

export function showComputerHelp(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(render('[mg]   Computer Commands[/mg]'));
    ctx.term.writeln(
        render('[by]   =[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]=[g]-[/g]='),
    );
    ctx.term.writeln(render(COMMON.menuRow, { key: 'K', text: '[bc]Known Universe[/bc]' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'L', text: '[bc]List Traders[/bc]' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'C', text: '[bc]Ship Catalog[/bc]' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'J', text: '[bc]Planetary Specs[/bc]' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: ';', text: '[bc]Current Ship Specs[/bc]' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Y', text: '[bc]Your Planets[/bc]' }));
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: '[bc]Exit Computer[/bc]' }));
    showComputerPrompt(ctx);
}

export function showKnownUniverseMenu(ctx: GameContext) {
    ctx.term.write(render(COMPUTER.knownUniversePrompt));
}

export function showExploredSectors(ctx: GameContext) {
    ctx.knownUniverseMode = 'explored';
    ctx.sendMsg({ type: ClientMsgType.VisitedSectors });
}

export function showUnexploredSectors(ctx: GameContext) {
    ctx.knownUniverseMode = 'unexplored';
    ctx.sendMsg({ type: ClientMsgType.VisitedSectors });
}

export function renderVisitedSectorsResult(
    ctx: GameContext,
    msg: { sectors: number[]; totalSectors: number },
) {
    const mode = ctx.knownUniverseMode;
    const visited = new Set(msg.sectors);
    ctx.term.writeln('');
    if (mode === 'explored') {
        const explored = msg.sectors.sort((a, b) => a - b);
        ctx.term.writeln(render(COMPUTER.exploredHeader, { count: explored.length }));
        ctx.term.writeln(explored.map((s) => render(COMPUTER.exploredSector, { n: s })).join(' '));
    } else {
        const unexplored: number[] = [];
        for (let i = 1; i <= msg.totalSectors; i++) {
            if (!visited.has(i)) unexplored.push(i);
        }
        ctx.term.writeln(render(COMPUTER.unexploredHeader, { count: unexplored.length }));
        ctx.term.writeln(
            unexplored.map((s) => render(COMPUTER.unexploredSector, { n: s })).join(' '),
        );
    }
    ctx.changeMenu(Menu.Computer);
    showComputerPrompt(ctx);
}

async function loadShipConfigs(ctx: GameContext): Promise<boolean> {
    if (ctx.shipConfigs) return true;
    ctx.term.writeln(render(STARBASE.loadingShipCatalog));
    try {
        const res = await fetch('/api/ships');
        ctx.shipConfigs = await res.json();
        return true;
    } catch {
        ctx.term.writeln(render(STARBASE.shipCatalogFailed));
        showComputerPrompt(ctx);
        return false;
    }
}

export async function showShipCatalog(ctx: GameContext) {
    if (!(await loadShipConfigs(ctx))) return;
    ctx.term.writeln('');
    ctx.term.writeln(render(COMPUTER.shipCatalogHeader));
    ctx.shipConfigs!.forEach((ship, i) => {
        ctx.term.writeln(
            render(COMPUTER.shipCatalogRow, { letter: indexToLetter(i), name: ship.name }),
        );
    });
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

function detailLine(label: string, value: string | number | boolean, pad = 22): string {
    return render(COMPUTER.shipDetailLine, {
        label: label.padEnd(pad),
        value: String(value),
    });
}

function boolStr(val: boolean): string {
    return render(val ? COMPUTER.shipDetailBoolYes : COMPUTER.shipDetailBoolNo);
}

const HW_DISPLAY: { name: string; label: string; isToggle?: boolean }[] = [
    { name: 'hyperspace_1', label: 'Hyperspace 1', isToggle: true },
    { name: 'hyperspace_2', label: 'Hyperspace 2', isToggle: true },
    { name: 'visual_scanner', label: 'Visual Scanner', isToggle: true },
    { name: 'planet_scanner', label: 'Planet Scanner', isToggle: true },
    { name: 'buoy', label: 'Max Buoys' },
    { name: 'proximity_mine', label: 'Max Proximity Mines' },
    { name: 'seeker_mine', label: 'Max Seeker Mines' },
    { name: 'orbital_mine', label: 'Max Orbital Mines' },
    { name: 'cloaking_device', label: 'Max Cloaking' },
    { name: 'corbomite', label: 'Max Corbomite' },
    { name: 'photon_torpedo', label: 'Max Photon Torpedoes' },
    { name: 'mine_disruptor', label: 'Max Disruptors' },
    { name: 'recon_drone', label: 'Max Recon Drones' },
    { name: 'planet_buster', label: 'Max Planet Busters' },
    { name: 'terraform_device', label: 'Max Terraform Dev.' },
];

export function showShipDetail(ctx: GameContext, ship: ShipCatalogEntry) {
    const { term } = ctx;
    term.writeln('');
    term.writeln(render(COMPUTER.shipDetailHeader, { name: ship.name }));
    if (ship.make) term.writeln(detailLine('Make', ship.make));
    term.writeln(detailLine('Price', ship.base_cost?.toLocaleString() ?? '?'));
    term.writeln(detailLine('Speed', ship.speed));
    term.writeln(detailLine('Turns/Warp', ship.turns_per_warp));
    term.writeln(detailLine('Starting Holds', ship.starting_holds));
    term.writeln(detailLine('Max Holds', ship.max_holds));
    term.writeln(detailLine('Max Drones', ship.max_drones));
    term.writeln(detailLine('Max Shields', ship.max_shields));
    term.writeln(detailLine('Odds Offensive', ship.odds_offensive));
    term.writeln(detailLine('Odds Defensive', ship.odds_defensive));
    term.writeln(detailLine('Max Drone Attack', ship.max_drone_attack));
    term.writeln(detailLine('Transporter Range', ship.transporter_range));
    term.writeln(detailLine('Has Escape Pod', boolStr(ship.has_pod)));
    term.writeln(detailLine('Can Land', boolStr(ship.can_land)));
    term.writeln(detailLine('Has Tractor', boolStr(ship.has_tractor)));
    term.writeln(detailLine('Has Interdictor', boolStr(ship.has_interdictor)));
    const hw = ship.hardware ?? {};
    for (const h of HW_DISPLAY) {
        const val = hw[h.name] ?? 0;
        term.writeln(detailLine(h.label, h.isToggle ? boolStr(val > 0) : val));
    }
    if (ship.notes) term.writeln(detailLine('Notes', ship.notes));
}

export async function showPlanetSpecs(ctx: GameContext) {
    if (!ctx.planetConfigs) {
        ctx.term.writeln(render(COMPUTER.planetSpecsLoading));
        try {
            const res = await fetch('/api/planets');
            ctx.planetConfigs = await res.json();
        } catch {
            ctx.term.writeln(render(COMPUTER.planetSpecsFailed));
            showComputerPrompt(ctx);
            return;
        }
    }
    ctx.term.writeln('');
    ctx.term.writeln(render(COMPUTER.planetSpecsHeader));
    ctx.planetConfigs!.forEach((planet, i) => {
        ctx.term.writeln(
            render(COMPUTER.planetSpecsRow, {
                letter: indexToLetter(i),
                type: planet.type,
            }),
        );
    });
    ctx.term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Back' }));
}

export function showPlanetDetail(ctx: GameContext, planet: PlanetConfig) {
    const { term } = ctx;
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
}

export async function showCurrentShipSpecs(ctx: GameContext) {
    if (!(await loadShipConfigs(ctx))) return;
    if (!ctx.currentShipName) {
        ctx.term.writeln(render(COMPUTER.shipDataRequesting));
        ctx.sendMsg({ type: ClientMsgType.ShipInfo });
        showComputerPrompt(ctx);
        return;
    }
    const ship = ctx.shipConfigs!.find((s) => s.name === ctx.currentShipName);
    if (!ship) {
        ctx.term.writeln(render(COMPUTER.shipConfigNotFound, { name: ctx.currentShipName }));
        showComputerPrompt(ctx);
        return;
    }
    showShipDetail(ctx, ship);
    showComputerPrompt(ctx);
}

export async function showTraderList(ctx: GameContext) {
    ctx.term.writeln(render(COMPUTER.traderListLoading));
    try {
        const res = await fetch(`/api/universes/${ctx.universeId}/players`);
        const traders: {
            name: string;
            shipName: string | null;
            shipDisplayName: string | null;
        }[] = await res.json();
        ctx.term.writeln('');
        ctx.term.writeln(render(COMPUTER.traderListHeader));
        ctx.term.writeln(render(COMPUTER.traderListColumns, { name: 'Name'.padEnd(24) }));
        for (const t of traders) {
            const ship =
                t.shipName === null
                    ? render(COMPUTER.traderListShipDestroyed)
                    : (t.shipDisplayName ?? t.shipName);
            ctx.term.writeln(
                render(COMPUTER.traderListRow, {
                    name: t.name.padEnd(24),
                    ship,
                }),
            );
        }
    } catch {
        ctx.term.writeln(render(COMPUTER.traderListFailed));
    }
    showComputerPrompt(ctx);
}

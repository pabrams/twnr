import { ClientMsgType } from '@twnr/shared';
import type { ShipCatalogEntry, PlanetConfig } from '@twnr/shared';
import type { GameContext } from './types.js';
import { colors } from './constants.js';
import { indexToLetter } from './display-starbase.js';

const mg = colors.magenta;

export function showComputerPrompt(ctx: GameContext) {
    ctx.term.write(
        `\r\n${mg('Computer command')} ${mg('[')}${colors.boldCyan(String(ctx.currentSector))}${mg(']')} ${mg('(')}${colors.boldYellow('?')}=${colors.boldYellow('Help')}${mg(')')} ${colors.boldYellow(':')} `,
    );
}

export function showComputerActivated(ctx: GameContext) {
    ctx.mode = 'computer';
    ctx.term.writeln(`\r\n${colors.boldCyan('<Computer activated>')}`);
    showComputerPrompt(ctx);
}

export function showComputerDeactivated(ctx: GameContext) {
    ctx.term.writeln(`\r\n${colors.boldCyan('<Computer deactivated>')}`);
}

export function showComputerHelp(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(`  ${colors.cyan('K')}  Known Universe`);
    ctx.term.writeln(`  ${colors.cyan('L')}  List Traders`);
    ctx.term.writeln(`  ${colors.cyan('C')}  Ship Catalog`);
    ctx.term.writeln(`  ${colors.cyan('J')}  Planetary Specs`);
    ctx.term.writeln(`  ${colors.cyan(';')}  Current Ship Specs`);
    ctx.term.writeln(`  ${colors.cyan('Y')}  Your Planets`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Exit Computer`);
    showComputerPrompt(ctx);
}

export function showKnownUniverseMenu(ctx: GameContext) {
    ctx.mode = 'knownUniverse';
    ctx.term.write(
        `\r\n${colors.boldCyan('Known Universe')} — ${colors.cyan('E')}xplored, ${colors.cyan('U')}nexplored, ${colors.cyan('Q')}uit? `,
    );
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
    if (mode === 'explored') {
        const explored = msg.sectors.sort((a, b) => a - b);
        ctx.term.writeln('');
        ctx.term.writeln(`${colors.boldCyan('Explored sectors')} (${explored.length}):`);
        ctx.term.writeln(explored.map((s) => colors.boldCyan(String(s))).join(' '));
    } else {
        const unexplored: number[] = [];
        for (let i = 1; i <= msg.totalSectors; i++) {
            if (!visited.has(i)) unexplored.push(i);
        }
        ctx.term.writeln('');
        ctx.term.writeln(`${colors.boldCyan('Unexplored sectors')} (${unexplored.length}):`);
        ctx.term.writeln(unexplored.map((s) => colors.boldRed(String(s))).join(' '));
    }
    ctx.changeMenu('computer');
    showComputerPrompt(ctx);
}

export async function showShipCatalog(ctx: GameContext) {
    ctx.mode = 'shipCatalog';
    if (!ctx.shipConfigs) {
        ctx.term.writeln(`\r\n${colors.white('Loading ship catalog...')}`);
        try {
            const res = await fetch('/api/ships');
            ctx.shipConfigs = await res.json();
        } catch {
            ctx.term.writeln(colors.boldRed('Failed to load ship catalog.'));
            showComputerPrompt(ctx);
            return;
        }
    }
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Ship Catalog ==='));
    ctx.shipConfigs!.forEach((ship, i) => {
        const letter = indexToLetter(i);
        ctx.term.writeln(`  ${colors.boldYellow(letter)}  ${colors.white(ship.name)}`);
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

function shipLine(label: string, value: string | number | boolean, pad = 22): string {
    return `  ${colors.boldYellow(label.padEnd(pad))} ${colors.white(String(value))}`;
}

function boolStr(val: boolean): string {
    return val ? colors.boldGreen('Yes') : colors.white('No');
}

// Hardware display labels (order matters for display)
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
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan(`=== ${ship.name} ===`));
    if (ship.make) ctx.term.writeln(shipLine('Make', ship.make));
    ctx.term.writeln(shipLine('Price', ship.base_cost?.toLocaleString() ?? '?'));
    ctx.term.writeln(shipLine('Speed', ship.speed));
    ctx.term.writeln(shipLine('Turns/Warp', ship.turns_per_warp));
    ctx.term.writeln(shipLine('Starting Holds', ship.starting_holds));
    ctx.term.writeln(shipLine('Max Holds', ship.max_holds));
    ctx.term.writeln(shipLine('Max Drones', ship.max_drones));
    ctx.term.writeln(shipLine('Max Shields', ship.max_shields));
    ctx.term.writeln(shipLine('Odds Offensive', ship.odds_offensive));
    ctx.term.writeln(shipLine('Odds Defensive', ship.odds_defensive));
    ctx.term.writeln(shipLine('Max Drone Attack', ship.max_drone_attack));
    ctx.term.writeln(shipLine('Transporter Range', ship.transporter_range));
    ctx.term.writeln(shipLine('Has Escape Pod', boolStr(ship.has_pod)));
    ctx.term.writeln(shipLine('Can Land', boolStr(ship.can_land)));
    ctx.term.writeln(shipLine('Has Tractor', boolStr(ship.has_tractor)));
    ctx.term.writeln(shipLine('Has Interdictor', boolStr(ship.has_interdictor)));
    const hw = ship.hardware ?? {};
    for (const h of HW_DISPLAY) {
        const val = hw[h.name] ?? 0;
        if (h.isToggle) {
            ctx.term.writeln(shipLine(h.label, boolStr(val > 0)));
        } else {
            ctx.term.writeln(shipLine(h.label, val));
        }
    }
    if (ship.notes) ctx.term.writeln(shipLine('Notes', ship.notes));
}

export async function showPlanetSpecs(ctx: GameContext) {
    ctx.mode = 'planetSpecs';
    if (!ctx.planetConfigs) {
        ctx.term.writeln(`\r\n${colors.white('Loading planetary specs...')}`);
        try {
            const res = await fetch('/api/planets');
            ctx.planetConfigs = await res.json();
        } catch {
            ctx.term.writeln(colors.boldRed('Failed to load planetary specs.'));
            showComputerPrompt(ctx);
            return;
        }
    }
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Planetary Specifications ==='));
    ctx.planetConfigs!.forEach((planet, i) => {
        const letter = indexToLetter(i);
        ctx.term.writeln(`  ${colors.boldYellow(letter)}  ${colors.white(planet.type)}`);
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showPlanetDetail(ctx: GameContext, planet: PlanetConfig) {
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan(`=== ${planet.type} ===`));
    ctx.term.writeln(`  ${colors.white(planet.description)}`);
    ctx.term.writeln(
        `  ${colors.boldYellow('Max Colonists'.padEnd(20))} ${colors.white(String(planet.maxColonists))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Max Citadel'.padEnd(20))} ${colors.white(String(planet.maxCitadel))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Fuel Production'.padEnd(20))} ${colors.white(String(planet.fuelProduction))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Organics Production'.padEnd(20))} ${colors.white(String(planet.organicsProduction))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Equip Production'.padEnd(20))} ${colors.white(String(planet.equipmentProduction))}`,
    );
}

export async function showCurrentShipSpecs(ctx: GameContext) {
    if (!ctx.shipConfigs) {
        try {
            const res = await fetch('/api/ships');
            ctx.shipConfigs = await res.json();
        } catch {
            ctx.term.writeln(colors.boldRed('Failed to load ship catalog.'));
            showComputerPrompt(ctx);
            return;
        }
    }
    if (!ctx.currentShipName) {
        ctx.term.writeln(colors.white('Requesting ship data...'));
        ctx.sendMsg({ type: ClientMsgType.ShipInfo });
        showComputerPrompt(ctx);
        return;
    }
    const ship = ctx.shipConfigs!.find((s) => s.name === ctx.currentShipName);
    if (!ship) {
        ctx.term.writeln(colors.boldRed(`Ship config not found for: ${ctx.currentShipName}`));
        showComputerPrompt(ctx);
        return;
    }
    showShipDetail(ctx, ship);
    showComputerPrompt(ctx);
}

export async function showTraderList(ctx: GameContext) {
    ctx.term.writeln(`\r\n${colors.white('Loading traders...')}`);
    try {
        const res = await fetch(`/api/universes/${ctx.universeId}/players`);
        const traders: { name: string; shipName: string }[] = await res.json();
        ctx.term.writeln('');
        ctx.term.writeln(colors.boldCyan('=== Traders in Universe ==='));
        ctx.term.writeln(`  ${colors.boldWhite('Name'.padEnd(24))} ${colors.boldWhite('Ship')}`);
        for (const t of traders) {
            ctx.term.writeln(
                `  ${colors.boldYellow(t.name.padEnd(24))} ${colors.white(t.shipName)}`,
            );
        }
    } catch {
        ctx.term.writeln(colors.boldRed('Failed to load trader list.'));
    }
    showComputerPrompt(ctx);
}

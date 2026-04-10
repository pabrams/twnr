import { ClientMsgType } from '@twnr/shared';
import type { GameContext } from './types.js';
import { colors } from './constants.js';

export function showComputerMenu(ctx: GameContext) {
    ctx.setMode('computer');
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Ship Computer ==='));
    ctx.term.writeln(`  ${colors.cyan('K')}  Known Universe`);
    ctx.term.writeln(`  ${colors.cyan('L')}  List Traders`);
    ctx.term.writeln(`  ${colors.cyan('C')}  Ship Catalog`);
    ctx.term.writeln(`  ${colors.cyan('J')}  Planetary Specs`);
    ctx.term.writeln(`  ${colors.cyan(';')}  Current Ship Specs`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Exit Computer`);
}

export function showKnownUniverseMenu(ctx: GameContext) {
    ctx.setMode('knownUniverse');
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('Known Universe'));
    ctx.term.writeln(`  ${colors.cyan('E')}  Explored sectors`);
    ctx.term.writeln(`  ${colors.cyan('U')}  Unexplored sectors`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showExploredSectors(ctx: GameContext) {
    const explored = Array.from(ctx.visitedSet).sort((a, b) => a - b);
    ctx.term.writeln('');
    ctx.term.writeln(`${colors.boldCyan('Explored sectors')} (${explored.length}):`);
    ctx.term.writeln(explored.map((s) => colors.boldCyan(String(s))).join(' '));
}

export function showUnexploredSectors(ctx: GameContext) {
    const unexplored: number[] = [];
    for (let i = 1; i <= ctx.totalSectors; i++) {
        if (!ctx.visitedSet.has(i)) unexplored.push(i);
    }
    ctx.term.writeln('');
    ctx.term.writeln(`${colors.boldCyan('Unexplored sectors')} (${unexplored.length}):`);
    ctx.term.writeln(unexplored.map((s) => colors.boldRed(String(s))).join(' '));
}

export async function showShipCatalog(ctx: GameContext) {
    ctx.setMode('shipCatalog');
    if (!ctx.shipConfigs) {
        ctx.term.writeln(`\r\n${colors.white('Loading ship catalog...')}`);
        try {
            const res = await fetch('/api/ships');
            ctx.setShipConfigs(await res.json());
        } catch {
            ctx.term.writeln(colors.boldRed('Failed to load ship catalog.'));
            showComputerMenu(ctx);
            return;
        }
    }
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Ship Catalog ==='));
    ctx.shipConfigs!.forEach((ship: any, i: number) => {
        const letter = String.fromCharCode(65 + i);
        ctx.term.writeln(`  ${colors.boldYellow(letter)}  ${colors.white(ship.name)}`);
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showShipDetail(ctx: GameContext, ship: any) {
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan(`=== ${ship.name} ===`));
    ctx.term.writeln(
        `  ${colors.boldYellow('Price'.padEnd(16))} ${colors.white(String(ship.price))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Max Drones'.padEnd(16))} ${colors.white(String(ship.maxDrones))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Max Shields'.padEnd(16))} ${colors.white(String(ship.maxShields))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Starting Holds'.padEnd(16))} ${colors.white(String(ship.startingHolds))}`,
    );
    ctx.term.writeln(
        `  ${colors.boldYellow('Max Holds'.padEnd(16))} ${colors.white(String(ship.maxHolds))}`,
    );
    ctx.term.writeln('');
    ctx.term.writeln(`Press ${colors.boldYellow('Q')} to go back.`);
}

export async function showPlanetSpecs(ctx: GameContext) {
    ctx.setMode('planetSpecs');
    if (!ctx.planetConfigs) {
        ctx.term.writeln(`\r\n${colors.white('Loading planetary specs...')}`);
        try {
            const res = await fetch('/api/planets');
            ctx.setPlanetConfigs(await res.json());
        } catch {
            ctx.term.writeln(colors.boldRed('Failed to load planetary specs.'));
            showComputerMenu(ctx);
            return;
        }
    }
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Planetary Specifications ==='));
    ctx.planetConfigs!.forEach((planet: any, i: number) => {
        const letter = String.fromCharCode(65 + i);
        ctx.term.writeln(`  ${colors.boldYellow(letter)}  ${colors.white(planet.type)}`);
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showPlanetDetail(ctx: GameContext, planet: any) {
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
    ctx.term.writeln('');
    ctx.term.writeln(`Press ${colors.boldYellow('Q')} to go back.`);
}

export async function showCurrentShipSpecs(ctx: GameContext) {
    if (!ctx.shipConfigs) {
        try {
            const res = await fetch('/api/ships');
            ctx.setShipConfigs(await res.json());
        } catch {
            ctx.term.writeln(colors.boldRed('Failed to load ship catalog.'));
            return;
        }
    }
    if (!ctx.currentShipName) {
        ctx.term.writeln(colors.white('Requesting ship data...'));
        ctx.sendMsg({ type: ClientMsgType.ShipInfo });
        return;
    }
    const ship = ctx.shipConfigs!.find((s: any) => s.name === ctx.currentShipName);
    if (!ship) {
        ctx.term.writeln(colors.boldRed(`Ship config not found for: ${ctx.currentShipName}`));
        return;
    }
    showShipDetail(ctx, ship);
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
}

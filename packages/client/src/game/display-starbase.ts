import { Menu } from '@twnr/shared';
import type { ShipCatalogEntry } from '@twnr/shared';
import type { GameContext } from './types.js';
import { colors } from './constants.js';

const mg = colors.magenta;

export function showStarbasePrompt(ctx: GameContext) {
    ctx.term.write(
        `\r\n${mg('<')}${colors.boldCyan('Starbase')}${mg('>')} ${mg('Where to?')} ${mg('(')}${colors.boldYellow('?')}=${colors.boldYellow('Help')}${mg(')')} `,
    );
}

export function showStarbaseMenu(ctx: GameContext) {
    ctx.mode = Menu.Starbase;
    showStarbasePrompt(ctx);
}

export function showStarbaseHelp(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(`  ${colors.cyan('S')}  Shipyards`);
    ctx.term.writeln(`  ${colors.cyan('H')}  Hardware Store`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Leave Starbase`);
    showStarbasePrompt(ctx);
}

export function showHardwarePrompt(ctx: GameContext) {
    ctx.term.write(
        `\r\n${mg('<')}${colors.boldCyan('Starbase Hardware')}${mg('>')} ${mg('What do you need')} ${mg('(')}${colors.boldYellow('?')}${mg(')')}${mg('?')} `,
    );
}

function fmt(n: number): string {
    return n.toLocaleString();
}

export function showHardwareMenu(ctx: GameContext) {
    ctx.mode = Menu.StarbaseHardware;
    showHardwarePrompt(ctx);
}

// Map hardware_item name to menu key for display
const HW_KEY_MAP: Record<string, string> = {
    terraform_device: 'T',
    planet_buster: 'B',
    buoy: 'U',
    proximity_mine: 'P',
    seeker_mine: 'S',
    orbital_mine: 'O',
    mine_disruptor: 'D',
    hyperspace_1: '1',
    hyperspace_2: '2',
    visual_scanner: 'V',
    planet_scanner: 'N',
    cloaking_device: 'K',
    corbomite: 'C',
    photon_torpedo: 'H',
    recon_drone: 'R',
};

export function showHardwareHelp(ctx: GameContext) {
    const items = ctx.hardwarePrices;
    ctx.term.writeln('');
    if (items) {
        for (const item of items) {
            const key = HW_KEY_MAP[item.name] ?? '?';
            ctx.term.writeln(
                `  ${colors.cyan(key)}  ${item.label.padEnd(19)} ${colors.white(fmt(item.price))}`,
            );
        }
    }
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
    showHardwarePrompt(ctx);
}

export function showBuyQtyPrompt(ctx: GameContext, item: string) {
    ctx.mode = Menu.StarbaseBuyQty;
    ctx.term.write(`\r\n${colors.cyan(`How many ${item}?`)} `);
}

export function showPlanetSelectMenu(
    ctx: GameContext,
    planets: { id: number; name: string; type: string }[],
) {
    ctx.mode = Menu.PlanetSelect;
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Select a Planet ==='));
    planets.forEach((p, i) => {
        ctx.term.writeln(
            `  ${colors.boldYellow(String(i + 1))}  ${colors.white(p.name)} (${p.type})`,
        );
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showHyperspaceJumpPrompt(ctx: GameContext) {
    ctx.mode = Menu.HyperspaceJumpTarget;
    ctx.term.write(`\r\n${colors.cyan('Target sector for hyperspace jump?')} `);
}

// --- Shipyards ---

export function showShipyardsPrompt(ctx: GameContext) {
    ctx.term.write(
        `\r\n${mg('<')}${colors.boldCyan('Shipyards')}${mg('>')} ${mg('What do you need')} ${mg('(')}${colors.boldYellow('?')}${mg(')')}${mg('?')} `,
    );
}

export function showShipyardsMenu(ctx: GameContext) {
    ctx.mode = Menu.Shipyards;
    showShipyardsPrompt(ctx);
}

export function showShipyardsHelp(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(`  ${colors.cyan('B')}  Buy a new ship`);
    ctx.term.writeln(`  ${colors.cyan('E')}  Examine ship specs`);
    ctx.term.writeln(`  ${colors.cyan('P')}  Purchase equipment (Class 0)`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back to Starbase`);
    showShipyardsPrompt(ctx);
}

/** Map index to letter, skipping Q (reserved for quit). */
export function indexToLetter(i: number): string {
    // A=0..O=14 then skip P→Q, so 15=R, 16=S, etc.
    const code = 65 + i + (i >= 16 ? 1 : 0); // 16 = index where Q would be
    return String.fromCharCode(code);
}

/** Reverse: letter back to index, accounting for skipped Q. */
export function letterToIndex(letter: string): number {
    const code = letter.toUpperCase().charCodeAt(0) - 65;
    if (code > 16) return code - 1; // after Q, shift back
    return code;
}

function calculateShipPrice(ship: ShipCatalogEntry): number {
    return (
        (ship.cost_drive ?? 0) +
        (ship.cost_computer ?? 0) +
        (ship.cost_hull ?? 0) +
        (ship.starting_holds ?? 0) * (ship.hold_cost ?? 0)
    );
}

export async function showShipBuyList(ctx: GameContext) {
    ctx.changeMenu(Menu.ShipyardsBuy);
    if (!ctx.shipConfigs) {
        ctx.term.writeln(`\r\n${colors.white('Loading ship catalog...')}`);
        try {
            const res = await fetch('/api/ships');
            ctx.shipConfigs = await res.json();
        } catch {
            ctx.term.writeln(colors.boldRed('Failed to load ship catalog.'));
            showShipyardsPrompt(ctx);
            return;
        }
    }
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Shipyards - Buy ==='));
    ctx.shipConfigs!.forEach((ship, i) => {
        const letter = indexToLetter(i);
        const price = calculateShipPrice(ship);
        const current =
            ship.name === ctx.currentShipName ? ` ${colors.boldGreen('(current)')}` : '';
        ctx.term.writeln(
            `  ${colors.boldYellow(letter)}  ${colors.white(ship.name.padEnd(24))} ${colors.boldYellow(price.toLocaleString().padStart(10))} cr${current}`,
        );
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showShipExamineList(ctx: GameContext) {
    ctx.changeMenu(Menu.ShipyardsExamine);
    showShipBuyListInternal(ctx, 'Examine');
}

async function showShipBuyListInternal(ctx: GameContext, label: string) {
    if (!ctx.shipConfigs) {
        ctx.term.writeln(`\r\n${colors.white('Loading ship catalog...')}`);
        try {
            const res = await fetch('/api/ships');
            ctx.shipConfigs = await res.json();
        } catch {
            ctx.term.writeln(colors.boldRed('Failed to load ship catalog.'));
            showShipyardsPrompt(ctx);
            return;
        }
    }
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan(`=== Shipyards - ${label} ===`));
    ctx.shipConfigs!.forEach((ship, i) => {
        const letter = indexToLetter(i);
        ctx.term.writeln(`  ${colors.boldYellow(letter)}  ${colors.white(ship.name)}`);
    });
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
}

export function showTradeinPrompt(
    ctx: GameContext,
    shipName: string,
    price: number,
    tradeinCredit: number,
) {
    ctx.changeMenu(Menu.ShipyardsTradein);
    ctx.term.writeln('');
    ctx.term.writeln(
        `${colors.boldCyan(shipName)} — ${colors.boldYellow('Price')}: ${colors.white(price.toLocaleString())} cr`,
    );
    if (tradeinCredit > 0) {
        ctx.term.writeln(
            `${colors.boldYellow('Trade-in credit')}: ${colors.white(tradeinCredit.toLocaleString())} cr`,
        );
        ctx.term.writeln(
            `${colors.boldYellow('Net cost with trade-in')}: ${colors.white((price - tradeinCredit).toLocaleString())} cr`,
        );
    }
    ctx.term.write(
        `\r\n${colors.cyan('Trade in your current ship?')} ${mg('(')}${colors.boldYellow('Y')}/${colors.boldYellow('N')}/${colors.boldYellow('Q')}uit${mg(')')} `,
    );
}

export function showShipyardsClass0Menu(ctx: GameContext) {
    ctx.changeMenu(Menu.ShipyardsClass0);
    ctx.term.writeln('');
    ctx.term.writeln(`  ${colors.cyan('F')}  Buy drones`);
    ctx.term.writeln(`  ${colors.cyan('S')}  Buy shields`);
    ctx.term.writeln(`  ${colors.cyan('H')}  Buy holds`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
    ctx.term.write(`\r\n${mg('<')}${colors.boldCyan('Shipyards Equipment')}${mg('>')} `);
}

export function showShipyardsClass0QtyPrompt(ctx: GameContext, item: string) {
    ctx.changeMenu(Menu.ShipyardsClass0Qty);
    ctx.term.write(`\r\n${colors.cyan(`How many ${item}?`)} `);
}

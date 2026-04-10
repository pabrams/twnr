import type { GameContext } from './types.js';
import { colors } from './constants.js';

const mg = colors.magenta;

export function showStarbasePrompt(ctx: GameContext) {
    ctx.term.write(
        `\r\n${mg('<')}${colors.boldCyan('Starbase')}${mg('>')} ${mg('Where to?')} ${mg('(')}${colors.boldYellow('?')}=${colors.boldYellow('Help')}${mg(')')} `,
    );
}

export function showStarbaseMenu(ctx: GameContext) {
    ctx.setMode('starbase');
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
    ctx.setMode('starbaseHardware');
    showHardwarePrompt(ctx);
}

export function showHardwareHelp(ctx: GameContext) {
    const p = ctx.hardwarePrices;
    ctx.term.writeln('');
    if (p) {
        ctx.term.writeln(
            `  ${colors.cyan('T')}  Terraform Device  ${colors.white(fmt(p.terraformDevice))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('B')}  Planet Buster      ${colors.white(fmt(p.planetBuster))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('U')}  Space Buoy         ${colors.white(fmt(p.spaceBuoy))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('P')}  Proximity Mine     ${colors.white(fmt(p.proximityMine))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('S')}  Seeker Mine        ${colors.white(fmt(p.seekerMine))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('O')}  Orbital Mine       ${colors.white(fmt(p.orbitalMine))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('D')}  Mine Disruptor     ${colors.white(fmt(p.mineDisruptor))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('1')}  Hyperspace Drive 1 ${colors.white(fmt(p.hyperspace1))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('2')}  Hyperspace Drive 2 ${colors.white(fmt(p.hyperspace2))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('V')}  Visual Scanner     ${colors.white(fmt(p.visualScanner))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('N')}  Planet Scanner     ${colors.white(fmt(p.planetScanner))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('K')}  Cloaking Device    ${colors.white(fmt(p.cloakingDevice))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('C')}  Corbomite          ${colors.white(fmt(p.corbomite))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('H')}  Photon Torpedo     ${colors.white(fmt(p.photonTorpedo))}`,
        );
        ctx.term.writeln(
            `  ${colors.cyan('R')}  Recon Drone        ${colors.white(fmt(p.reconDrone))}`,
        );
    }
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
    showHardwarePrompt(ctx);
}

export function showBuyQtyPrompt(ctx: GameContext, item: string) {
    ctx.setMode('starbaseBuyQty');
    ctx.term.write(`\r\n${colors.cyan(`How many ${item}?`)} `);
}

export function showPlanetSelectMenu(
    ctx: GameContext,
    planets: { id: number; name: string; type: string }[],
) {
    ctx.setMode('planetSelect');
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
    ctx.setMode('hyperspaceJumpTarget');
    ctx.term.write(`\r\n${colors.cyan('Target sector for hyperspace jump?')} `);
}

// --- Shipyards ---

export function showShipyardsPrompt(ctx: GameContext) {
    ctx.term.write(
        `\r\n${mg('<')}${colors.boldCyan('Shipyards')}${mg('>')} ${mg('What do you need')} ${mg('(')}${colors.boldYellow('?')}${mg(')')}${mg('?')} `,
    );
}

export function showShipyardsMenu(ctx: GameContext) {
    ctx.setMode('shipyards');
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

function calculateShipPrice(ship: any): number {
    return (
        (ship.cost_drive ?? 0) +
        (ship.cost_computer ?? 0) +
        (ship.cost_hull ?? 0) +
        (ship.starting_holds ?? 0) * (ship.hold_cost ?? 0)
    );
}

export async function showShipBuyList(ctx: GameContext) {
    ctx.changeMenu('shipyardsBuy');
    if (!ctx.shipConfigs) {
        ctx.term.writeln(`\r\n${colors.white('Loading ship catalog...')}`);
        try {
            const res = await fetch('/api/ships');
            ctx.setShipConfigs(await res.json());
        } catch {
            ctx.term.writeln(colors.boldRed('Failed to load ship catalog.'));
            showShipyardsPrompt(ctx);
            return;
        }
    }
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan('=== Shipyards - Buy ==='));
    ctx.shipConfigs!.forEach((ship: any, i: number) => {
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
    ctx.changeMenu('shipyardsExamine');
    showShipBuyListInternal(ctx, 'Examine');
}

async function showShipBuyListInternal(ctx: GameContext, label: string) {
    if (!ctx.shipConfigs) {
        ctx.term.writeln(`\r\n${colors.white('Loading ship catalog...')}`);
        try {
            const res = await fetch('/api/ships');
            ctx.setShipConfigs(await res.json());
        } catch {
            ctx.term.writeln(colors.boldRed('Failed to load ship catalog.'));
            showShipyardsPrompt(ctx);
            return;
        }
    }
    ctx.term.writeln('');
    ctx.term.writeln(colors.boldCyan(`=== Shipyards - ${label} ===`));
    ctx.shipConfigs!.forEach((ship: any, i: number) => {
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
    ctx.changeMenu('shipyardsTradein');
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
    ctx.changeMenu('shipyardsClass0');
    ctx.term.writeln('');
    ctx.term.writeln(`  ${colors.cyan('F')}  Buy drones`);
    ctx.term.writeln(`  ${colors.cyan('S')}  Buy shields`);
    ctx.term.writeln(`  ${colors.cyan('H')}  Buy holds`);
    ctx.term.writeln(`  ${colors.cyan('Q')}  Back`);
    ctx.term.write(`\r\n${mg('<')}${colors.boldCyan('Shipyards Equipment')}${mg('>')} `);
}

export function showShipyardsClass0QtyPrompt(ctx: GameContext, item: string) {
    ctx.changeMenu('shipyardsClass0Qty');
    ctx.term.write(`\r\n${colors.cyan(`How many ${item}?`)} `);
}

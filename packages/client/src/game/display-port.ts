import type { GameContext } from './types.js';
import { colorSector } from './types.js';
import { colors } from './constants.js';

const mg = colors.magenta;

export function showAutopilotPrompt(ctx: GameContext, path: number[], hops: number) {
    ctx.setAutopilotPath(path);
    ctx.setAutopilotStep(1);
    ctx.changeMenu('autopilotPrompt');
    ctx.term.writeln('');
    ctx.term.writeln(
        `${colors.boldYellow('That sector is not adjacent.')} Shortest path ${mg('(')}${colors.boldCyan(String(hops))} hops${mg(')')}:`,
    );
    ctx.term.writeln(
        `  ${path.map((s) => colorSector(s, ctx.visitedSet)).join(` ${colors.green('>')} `)}`,
    );
    ctx.term.write(
        `\r\n${colors.cyan('Engage autopilot?')} ${mg('(')}${colors.boldYellow('Y')}/${colors.boldYellow('N')}${mg(')')} `,
    );
}

export async function showClass0Menu(ctx: GameContext) {
    ctx.changeMenu('class0');
    if (!ctx.class0Prices) {
        try {
            const res = await fetch('/api/class0-prices');
            ctx.setClass0Prices(await res.json());
        } catch {
            ctx.setClass0Prices({ dronePrice: 20, shieldPrice: 10, holdPrice: 50 });
        }
    }
    const p = ctx.class0Prices!;
    ctx.term.writeln('');
    ctx.term.writeln(
        `${colors.boldGreen('Docked')} at ${colors.boldCyan('Stardock Supply Depot')}`,
    );
    ctx.term.writeln(
        `  ${colors.cyan('F')}  Buy Drones ${colors.white(`(${p.dronePrice} credits each)`)}`,
    );
    ctx.term.writeln(
        `  ${colors.cyan('S')}  Buy Shields ${colors.white(`(${p.shieldPrice} credits each)`)}`,
    );
    ctx.term.writeln(
        `  ${colors.cyan('H')}  Buy Holds ${colors.white(`(${p.holdPrice} credits each)`)}`,
    );
    ctx.term.writeln(`  ${colors.cyan('Q')}  Leave port`);
}

export function showClass0QtyPrompt(ctx: GameContext, buyType: string) {
    ctx.changeMenu('class0Qty');
    ctx.term.write(`\r\n${colors.cyan(`How many ${buyType}?`)} `);
}

export function showJettisonConfirm(ctx: GameContext) {
    ctx.changeMenu('jettisonConfirm');
    ctx.term.write(
        `\r\n${colors.boldYellow('Jettison all cargo?')} This cannot be undone. ${mg('(')}${colors.boldYellow('Y')}/${colors.boldYellow('N')}${mg(')')} `,
    );
}

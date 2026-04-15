import type { GameContext } from './types.js';
import { colors } from './constants.js';

const mg = colors.magenta;

export function showAutopilotPrompt(
    ctx: GameContext,
    path: { sector: number; visited: boolean }[],
    hops: number,
) {
    ctx.autopilotPath = path.map((p) => p.sector);
    ctx.autopilotStep = 0;
    ctx.term.writeln('');
    ctx.term.writeln(
        `${colors.boldYellow('That sector is not adjacent.')} Shortest path ${mg('(')}${colors.boldCyan(String(hops))} hops${mg(')')}:`,
    );
    ctx.term.writeln(
        `  ${path.map((p) => (p.visited ? colors.boldCyan(String(p.sector)) : `${mg('(')}${colors.boldRed(String(p.sector))}${mg(')')}`)).join(` ${colors.green('>')} `)}`,
    );
    ctx.term.write(
        `\r\n${colors.cyan('Engage autopilot?')} ${mg('(')}${colors.boldYellow('Y')}/${colors.boldYellow('N')}${mg(')')} `,
    );
}

export async function showClass0Menu(ctx: GameContext) {
    if (!ctx.class0Prices) {
        try {
            const res = await fetch('/api/class0-prices');
            ctx.class0Prices = await res.json();
        } catch {
            ctx.class0Prices = { dronePrice: 20, shieldPrice: 10, holdPrice: 50 };
        }
    }
    const p = ctx.class0Prices!;
    ctx.term.writeln('');
    ctx.term.writeln(
        `${colors.boldGreen('Docked')} at ${colors.boldCyan('Starbase Supply Depot')}`,
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
    ctx.term.write(`\r\n${colors.cyan(`How many ${buyType}?`)} `);
}

export function showTradeQtyPrompt(
    ctx: GameContext,
    commodity: string,
    action: 'buy' | 'sell',
    portTrading: number,
    onBoard: number,
    maxQty: number,
) {
    const actionWord = action === 'buy' ? 'selling' : 'buying';
    ctx.term.writeln('');
    ctx.term.writeln(
        `${mg('We are')} ${action === 'buy' ? colors.boldRed(actionWord) : colors.boldGreen(actionWord)} ${mg('up to')} ${colors.boldYellow(String(portTrading))}${mg('.')} ${mg('You have')} ${colors.boldYellow(String(onBoard))} ${mg('in your holds.')}`,
    );
    ctx.term.write(
        `${mg('How many holds of')} ${colors.boldCyan(commodity)} ${mg('do you want to')} ${action === 'buy' ? colors.boldRed('buy') : colors.boldGreen('sell')} ${mg('[')}${colors.boldYellow(String(maxQty))}${mg(']?')} `,
    );
}

export function showTradeConfirmPrompt(
    ctx: GameContext,
    totalPrice: number,
    action: 'buy' | 'sell',
) {
    const verb = action === 'buy' ? 'sell' : 'buy';
    ctx.term.writeln(
        `\r\n${mg("We'll")} ${verb} ${mg('them for')} ${colors.boldYellow(totalPrice.toLocaleString())} ${mg('credits.')}`,
    );
    ctx.term.write(
        `${mg('Accept?')} ${mg('(')}${colors.boldYellow('Y')}${mg('/')}${colors.boldYellow('N')}${mg(')')} `,
    );
}

export function showNoTradeMessage(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(
        colors.white("You don't have anything they want, and they don't have anything you need."),
    );
}

export function showJettisonConfirm(ctx: GameContext) {
    ctx.term.write(
        `\r\n${colors.boldYellow('Jettison all cargo?')} This cannot be undone. ${mg('(')}${colors.boldYellow('Y')}/${colors.boldYellow('N')}${mg(')')} `,
    );
}

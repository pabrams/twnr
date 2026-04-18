import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { SECTOR, PORT, COMMON } from './messages/index.js';

export function showAutopilotPrompt(
    ctx: GameContext,
    path: { sector: number; visited: boolean }[],
    hops: number,
) {
    ctx.autopilotPath = path.map((p) => p.sector);
    ctx.autopilotStep = 0;
    const { term } = ctx;
    term.writeln('');
    term.writeln(render(SECTOR.autopilotNotAdjacent, { hops }));
    const sep = render(SECTOR.autopilotPathSeparator);
    const list = path
        .map((p) => {
            const tpl = p.visited ? SECTOR.warpVisited : SECTOR.warpUnvisited;
            return render(tpl, { sector: p.sector });
        })
        .join(sep);
    term.writeln(`  ${list}`);
    term.write(render(SECTOR.autopilotConfirm));
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
    const { term } = ctx;
    term.writeln('');
    term.writeln(render(PORT.class0DockHeader));
    term.writeln(
        render(COMMON.menuRow, {
            key: 'F',
            text: `Buy Drones ${render(PORT.class0Drones, { price: p.dronePrice })}`,
        }),
    );
    term.writeln(
        render(COMMON.menuRow, {
            key: 'S',
            text: `Buy Shields ${render(PORT.class0Shields, { price: p.shieldPrice })}`,
        }),
    );
    term.writeln(
        render(COMMON.menuRow, {
            key: 'H',
            text: `Buy Holds ${render(PORT.class0Holds, { price: p.holdPrice })}`,
        }),
    );
    term.writeln(render(COMMON.menuRow, { key: 'Q', text: 'Leave port' }));
}

export function showClass0QtyPrompt(ctx: GameContext, buyType: string) {
    ctx.term.write(render(COMMON.howManyPrompt, { item: buyType }));
}

export function showTradeQtyPrompt(
    ctx: GameContext,
    commodity: string,
    action: 'buy' | 'sell',
    portTrading: number,
    onBoard: number,
    maxQty: number,
) {
    const infoTpl = action === 'buy' ? PORT.tradeQtyInfoBuy : PORT.tradeQtyInfoSell;
    const promptTpl = action === 'buy' ? PORT.tradeQtyPromptBuy : PORT.tradeQtyPromptSell;
    ctx.term.writeln('');
    ctx.term.writeln(render(infoTpl, { portTrading, onBoard }));
    ctx.term.write(render(promptTpl, { commodity, maxQty }));
}

export function showTradeConfirmPrompt(
    ctx: GameContext,
    totalPrice: number,
    action: 'buy' | 'sell',
) {
    const tpl = action === 'buy' ? PORT.tradeConfirmSell : PORT.tradeConfirmBuy;
    ctx.term.writeln(render(tpl, { total: totalPrice.toLocaleString() }));
    ctx.term.write(render(PORT.tradeConfirmAccept));
}

export function showNoTradeMessage(ctx: GameContext) {
    ctx.term.writeln('');
    ctx.term.writeln(render(PORT.noTrade));
}

export function showJettisonConfirm(ctx: GameContext) {
    ctx.term.write(render(SECTOR.jettisonConfirm));
}

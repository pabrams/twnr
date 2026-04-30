import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { PORT } from './messages/index.js';

export type DisplayPortCtx = Pick<
    GameContext,
    'autopilot' | 'catalogs' | 'io' | 'ship' | 'starbase'
>;

/** Max units of a given item the player can buy right now. */
export function class0MaxBuy(kind: 'drones' | 'shields' | 'holds', ctx: DisplayPortCtx): number {
    const s = ctx.starbase.class0ShipState;
    const p = ctx.catalogs.class0Prices;
    if (!s || !p) return 0;
    let roomLeft: number;
    let unitPrice: number;
    if (kind === 'drones') {
        roomLeft = Math.max(0, s.maxDrones - s.drones);
        unitPrice = p.dronePrice;
    } else if (kind === 'shields') {
        roomLeft = Math.max(0, s.maxShields - s.shields);
        unitPrice = p.shieldPrice;
    } else {
        roomLeft = Math.max(0, s.maxHolds - s.holds);
        unitPrice = p.holdPrice;
    }
    const affordable = unitPrice > 0 ? Math.floor(s.credits / unitPrice) : 0;
    return Math.min(roomLeft, affordable);
}

function formatTimestamp(): string {
    const d = new Date();
    const time = d.toLocaleTimeString('en-US', { hour12: true });
    const date = d.toDateString();
    return `${time} ${date}`;
}

export async function showClass0Menu(ctx: DisplayPortCtx) {
    if (!ctx.catalogs.class0Prices) {
        try {
            const res = await fetch('/api/class0-prices');
            ctx.catalogs.class0Prices = await res.json();
        } catch {
            ctx.catalogs.class0Prices = { dronePrice: 20, shieldPrice: 10, holdPrice: 50 };
        }
    }
    const p = ctx.catalogs.class0Prices!;
    const { term } = ctx.io;
    const canBuyHolds = class0MaxBuy('holds', ctx);
    const canBuyDrones = class0MaxBuy('drones', ctx);
    const canBuyShields = class0MaxBuy('shields', ctx);
    const pad = (n: number) => String(n).padStart(6);

    term.writeln('');
    if (ctx.starbase.class0ShipState) {
        term.writeln(
            render(PORT.class0CreditsLine, {
                credits: ctx.starbase.class0ShipState.credits.toLocaleString(),
            }),
        );
    }
    term.writeln(render(PORT.class0CommerceHeader, { timestamp: formatTimestamp() }));
    term.writeln(
        render(PORT.class0RowHolds, { price: pad(p.holdPrice), canBuy: pad(canBuyHolds) }),
    );
    term.writeln(
        render(PORT.class0RowDrones, { price: pad(p.dronePrice), canBuy: pad(canBuyDrones) }),
    );
    term.writeln(
        render(PORT.class0RowShields, { price: pad(p.shieldPrice), canBuy: pad(canBuyShields) }),
    );
    term.write(render(PORT.class0BuyPrompt));
}

export function showClass0QtyPrompt(ctx: DisplayPortCtx, buyType: 'drones' | 'shields' | 'holds') {
    const s = ctx.starbase.class0ShipState;
    const max = class0MaxBuy(buyType, ctx);
    const shipName =
        ctx.ship.currentColoredShipName ?? s?.shipName ?? ctx.ship.currentShipName ?? '';

    const { term } = ctx.io;
    if (buyType === 'drones') {
        term.writeln(render(PORT.class0QtyYouHaveFighters, { qty: s?.drones ?? 0 }));
        term.write(render(PORT.class0QtyPromptFighters, { shipName, max }));
    } else if (buyType === 'shields') {
        term.writeln(render(PORT.class0QtyYouHaveShields, { qty: s?.shields ?? 0 }));
        term.write(render(PORT.class0QtyPromptShields, { max }));
    } else {
        term.writeln(render(PORT.class0QtyYouHaveHolds, { qty: s?.holds ?? 0 }));
        term.write(render(PORT.class0QtyPromptHolds, { max }));
    }
}

export function showTradeQtyPrompt(
    ctx: DisplayPortCtx,
    commodity: string,
    action: 'buy' | 'sell',
    portTrading: number,
    onBoard: number,
    maxQty: number,
) {
    const infoTpl = action === 'buy' ? PORT.tradeQtyInfoBuy : PORT.tradeQtyInfoSell;
    const promptTpl = action === 'buy' ? PORT.tradeQtyPromptBuy : PORT.tradeQtyPromptSell;
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(infoTpl, { portTrading, onBoard }));
    ctx.io.term.write(render(promptTpl, { commodity, maxQty }));
}

export function showNoTradeMessage(ctx: DisplayPortCtx) {
    ctx.io.term.writeln('');
    ctx.io.term.writeln(render(PORT.noTrade));
}

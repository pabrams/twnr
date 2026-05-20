import { maxAffordableHolds, nextHoldCost } from '@twnr/shared';
import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { PORT } from './messages/index.js';

export type DisplayPortCtx = Pick<
    GameContext,
    'autopilot' | 'catalogs' | 'io' | 'ship' | 'starbase'
>;

/** Max units of a given item the player can buy right now. Holds use the
 *  cumulative formula `Σ (B + k·I). */
export function class0MaxBuy(kind: 'drones' | 'shields' | 'holds', ctx: DisplayPortCtx): number {
    const s = ctx.starbase.class0ShipState;
    const p = ctx.catalogs.class0Prices;
    if (!s || !p) return 0;
    if (kind === 'drones') {
        const roomLeft = Math.max(0, s.maxDrones - s.drones);
        const affordable = p.dronePrice > 0 ? Math.floor(s.credits / p.dronePrice) : 0;
        return Math.min(roomLeft, affordable);
    }
    if (kind === 'shields') {
        const roomLeft = Math.max(0, s.maxShields - s.shields);
        const affordable = p.shieldPrice > 0 ? Math.floor(s.credits / p.shieldPrice) : 0;
        return Math.min(roomLeft, affordable);
    }
    const roomLeft = Math.max(0, s.maxHolds - s.holds);
    const affordable = maxAffordableHolds(s.holds, s.credits, p.holdBaseCost, p.holdCostIncrement);
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
            ctx.catalogs.class0Prices = {
                dronePrice: 20,
                shieldPrice: 10,
                holdBaseCost: 200,
                holdCostIncrement: 20,
                holdBaseCostMin: 151,
                holdBaseCostMax: 249,
                holdCostPeriodDays: 18,
            };
        }
    }
    const p = ctx.catalogs.class0Prices!;
    const { term } = ctx.io;
    const canBuyHolds = class0MaxBuy('holds', ctx);
    const canBuyDrones = class0MaxBuy('drones', ctx);
    const canBuyShields = class0MaxBuy('shields', ctx);
    const pad = (n: number) => String(n).padStart(6);
    // Cost shown is for the *next* hold (B + currentHolds·I).
    const currentHolds = ctx.starbase.class0ShipState?.holds ?? 0;
    const nextHold = nextHoldCost(currentHolds, p.holdBaseCost, p.holdCostIncrement);

    term.writeln('');
    if (ctx.starbase.class0ShipState) {
        term.writeln(
            render(PORT.class0CreditsLine, {
                credits: ctx.starbase.class0ShipState.credits.toLocaleString(),
            }),
        );
    }
    term.writeln(render(PORT.class0CommerceHeader, { timestamp: formatTimestamp() }));
    term.writeln(render(PORT.class0RowHolds, { price: pad(nextHold), canBuy: pad(canBuyHolds) }));
    term.writeln(
        render(PORT.class0RowDrones, { price: pad(p.dronePrice), canBuy: pad(canBuyDrones) }),
    );
    term.writeln(
        render(PORT.class0RowShields, { price: pad(p.shieldPrice), canBuy: pad(canBuyShields) }),
    );
    term.write(render(PORT.class0BuyPrompt));
}

/** Print the "you have N <thing>" preamble line for a class-0 buy and
 * return the corresponding prompt-text string + the max the player can
 * buy. The routine then passes the text to askNumber. (Old version
 * wrote the prompt itself; with askNumber owning the prompt write, we
 * split.) */
export function class0QtyPreamble(
    ctx: DisplayPortCtx,
    buyType: 'drones' | 'shields' | 'holds',
): { promptText: string; max: number } {
    const s = ctx.starbase.class0ShipState;
    const max = class0MaxBuy(buyType, ctx);
    const shipName =
        ctx.ship.currentColoredShipName ?? s?.shipName ?? ctx.ship.currentShipName ?? '';

    const { term } = ctx.io;
    if (buyType === 'drones') {
        term.writeln(render(PORT.class0QtyYouHaveFighters, { qty: s?.drones ?? 0 }));
        return { promptText: render(PORT.class0QtyPromptFighters, { shipName, max }), max };
    }
    if (buyType === 'shields') {
        term.writeln(render(PORT.class0QtyYouHaveShields, { qty: s?.shields ?? 0 }));
        return { promptText: render(PORT.class0QtyPromptShields, { max }), max };
    }
    term.writeln(render(PORT.class0QtyYouHaveHolds, { qty: s?.holds ?? 0 }));
    return { promptText: render(PORT.class0QtyPromptHolds, { max }), max };
}

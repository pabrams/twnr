/**
 * Dynamic port pricing — legacy-derived linear model, physical-stock variant.
 *
 * Each port stores per-commodity *physical stock* in the `fuel`/`organics`/
 * `equipment` columns. For an S-action commodity that stock is the
 * inventory the port has available to sell; for a B-action commodity it is
 * the stock the port has accumulated by buying (or by being upgraded), which
 * regenerates back down to zero over time. The asking/offering price per
 * unit is computed at trade time from stock + max + MCIC; static price
 * columns no longer exist.
 *
 * Forward formula:
 *   price(tp) = base + (priceAt100 − base) × (tp − floorTp) / (100 − floorTp)
 * where
 *   tp          = action === 'S' ? stock/max : (max − stock)/max, ×100
 *   priceAt100  = base + slope × |MCIC|
 *   floorTp     = below this trading %, price clamps to base
 *
 * Display semantics: legacy floors percentages and derived "Trading" amounts
 * rather than rounding. Match that here so the client renders identically.
 */

import type { PortAction } from './port-classes.js';

export type PriceCommodity = 'fuel' | 'organics' | 'equipment';

export type CommodityPricing = {
    /** Floor price asymptote (paid when the port has nothing to trade with). */
    base: number;
    /** Trading % below which price clamps to base. */
    floorTp: number;
    /** Price-at-100 change per MCIC unit (legacy reverse-engineered). */
    slope: number;
};

export const COMMODITY_PRICING: Record<PriceCommodity, CommodityPricing> = {
    fuel: { base: 25, floorTp: 10, slope: 0.2 },
    organics: { base: 50, floorTp: 11, slope: 0.4 },
    equipment: { base: 90, floorTp: 12, slope: 0.7 },
};

/** legacy bigbang MCIC ranges per commodity. Sign is set by class action
 *  (B → negative, S → positive); the absolute value lives within these
 *  ranges. Player-built ports always lock at ±60 (B) / ±50 (S). */
export const MCIC_BIGBANG_RANGE: Record<PriceCommodity, { min: number; max: number }> = {
    fuel: { min: 40, max: 90 },
    organics: { min: 30, max: 75 },
    equipment: { min: 20, max: 65 },
};

/** Productivity bigbang range. Max stock for the commodity at any port is
 *  `prod * 10`. Range chosen to match observed legacy starting
 *  max amounts of ~600..2800. Upgrades (future) grow `prod` per invested
 *  unit. */
export const PRODUCTIVITY_BIGBANG_RANGE = { min: 60, max: 280 } as const;

/** Per-unit cost of an upgrade is 10× the commodity's base price (legacy).
 *  Investing 1 unit grows prod by 1 → max grows by 10 → stock also grows by
 *  10 (the physical commodity lands on the port). */
export function upgradeUnitCost(commodity: PriceCommodity): number {
    return COMMODITY_PRICING[commodity].base * 10;
}

export function priceAt100FromMcic(commodity: PriceCommodity, mcic: number): number {
    const { base, slope } = COMMODITY_PRICING[commodity];
    return base + slope * Math.abs(mcic);
}

/** Trading % for a given commodity stock, max, and direction. Mirrors the
 *  number shown after the port name in the commerce report. */
export function tradingPercent(action: PortAction, stock: number, max: number): number {
    if (max <= 0) return 0;
    const capacity = action === 'S' ? stock : max - stock;
    return (capacity / max) * 100;
}

/** "Trading" amount as displayed in the commerce report:
 *  - Selling port: current stock available for sale
 *  - Buying port: room remaining to buy (max − stock)
 */
export function tradingDisplayed(action: PortAction, stock: number, max: number): number {
    const value = action === 'S' ? stock : max - stock;
    return Math.max(0, Math.floor(value));
}

/** Floored "% of max" integer (0..100) shown in the commerce report. */
export function tradingPercentDisplay(action: PortAction, stock: number, max: number): number {
    return Math.max(0, Math.min(100, Math.floor(tradingPercent(action, stock, max))));
}

/** Compute the per-unit price the port quotes for a commodity given its
 *  current physical stock, max, MCIC, and class-direction. Returns a
 *  non-negative integer (floored). Below the floor trading %, the price
 *  clamps to the commodity base. */
export function computeUnitPrice(
    commodity: PriceCommodity,
    stock: number,
    max: number,
    mcic: number,
    action: PortAction,
): number {
    const { base, floorTp } = COMMODITY_PRICING[commodity];
    if (max <= 0) return Math.floor(base);
    const tp = tradingPercent(action, stock, max);
    if (tp <= floorTp) return Math.floor(base);
    const priceAt100 = priceAt100FromMcic(commodity, mcic);
    const price = base + ((priceAt100 - base) * (tp - floorTp)) / (100 - floorTp);
    return Math.max(0, Math.floor(price));
}

/**
 * Experience modulation. legacy: at ~0 xp the sell-port asking price is at
 * its quoted maximum; by 1000 xp it drops ~28% (player buys cheap). The
 * buy-port offered price grows ~7% over the same range. Above 1000 xp the
 * effect plateaus (and the player crosses the fed-safe threshold).
 *
 * `action` is the *port*'s side, not the player's: 'S' = port sells = player
 * buys, 'B' = port buys = player sells.
 */
export const XP_EFFECT = {
    plateauXp: 1000,
    sellSideMaxDiscount: 0.28,
    buySideMaxBonus: 0.07,
} as const;

export function xpPriceMultiplier(xp: number, portAction: PortAction): number {
    const { plateauXp, sellSideMaxDiscount, buySideMaxBonus } = XP_EFFECT;
    const t = Math.min(1, Math.max(0, xp / plateauXp));
    if (portAction === 'S') return 1 - sellSideMaxDiscount * t;
    return 1 + buySideMaxBonus * t;
}

/** Final per-unit price after the experience modifier (floored). */
export function computeUnitPriceWithXp(
    commodity: PriceCommodity,
    stock: number,
    max: number,
    mcic: number,
    xp: number,
    portAction: PortAction,
): number {
    const raw = computeUnitPrice(commodity, stock, max, mcic, portAction);
    return Math.max(0, Math.floor(raw * xpPriceMultiplier(xp, portAction)));
}

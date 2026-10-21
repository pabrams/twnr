/** An S commodity's stock is inventory for sale; a B commodity's stock is what it has bought, regenerating toward zero. */

import type { PortAction } from './port-classes.js';

export type PriceCommodity = 'fuel' | 'organics' | 'equipment';

export type CommodityPricing = {
    base: number;
    floorTp: number;
    slope: number;
};

export const COMMODITY_PRICING: Record<PriceCommodity, CommodityPricing> = {
    fuel: { base: 25, floorTp: 10, slope: 0.2 },
    organics: { base: 50, floorTp: 11, slope: 0.4 },
    equipment: { base: 90, floorTp: 12, slope: 0.7 },
};

/** Magnitudes only; MCIC sign comes from the class action (B negative, S positive). */
export const MCIC_BIGBANG_RANGE: Record<PriceCommodity, { min: number; max: number }> = {
    fuel: { min: 40, max: 90 },
    organics: { min: 30, max: 75 },
    equipment: { min: 20, max: 65 },
};

/** Max stock per commodity = prod × 10. */
export const PRODUCTIVITY_BIGBANG_RANGE = { min: 60, max: 280 } as const;

export function upgradeUnitCost(commodity: PriceCommodity): number {
    return COMMODITY_PRICING[commodity].base * 10;
}

export function priceAt100FromMcic(commodity: PriceCommodity, mcic: number): number {
    const { base, slope } = COMMODITY_PRICING[commodity];
    return base + slope * Math.abs(mcic);
}

export function tradingPercent(action: PortAction, stock: number, max: number): number {
    if (max <= 0) return 0;
    const capacity = action === 'S' ? stock : max - stock;
    return (capacity / max) * 100;
}

export function tradingDisplayed(action: PortAction, stock: number, max: number): number {
    const value = action === 'S' ? stock : max - stock;
    return Math.max(0, Math.floor(value));
}

export function tradingPercentDisplay(action: PortAction, stock: number, max: number): number {
    return Math.max(0, Math.min(100, Math.floor(tradingPercent(action, stock, max))));
}

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

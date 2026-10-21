import type { PriceCommodity, PortAction } from './index.js';

export type PortClass = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type ConstructionCost = {
    credits: number;
    ore: number;
    org: number;
    equ: number;
    /** Real-time days. */
    days: number;
};

export const PORT_CONSTRUCTION_COSTS: Record<PortClass, ConstructionCost> = {
    1: { credits: 39250, ore: 120, org: 120, equ: 60, days: 6 },
    2: { credits: 41500, ore: 140, org: 70, equ: 140, days: 7 },
    3: { credits: 48000, ore: 80, org: 160, equ: 160, days: 8 },
    4: { credits: 37500, ore: 50, org: 50, equ: 100, days: 5 },
    5: { credits: 34000, ore: 40, org: 80, equ: 40, days: 4 },
    6: { credits: 32500, ore: 60, org: 30, equ: 30, days: 3 },
    7: { credits: 30000, ore: 20, org: 20, equ: 20, days: 2 },
    8: { credits: 50000, ore: 200, org: 200, equ: 200, days: 10 },
};

/** Every table total divides cleanly by its days. */
export function dailyDrainFor(portClass: PortClass): {
    ore: number;
    org: number;
    equ: number;
} {
    const c = PORT_CONSTRUCTION_COSTS[portClass];
    return {
        ore: c.ore / c.days,
        org: c.org / c.days,
        equ: c.equ / c.days,
    };
}

/** Stronger than typical NPC-port rolls by design. */
export const PLAYER_BUILT_PORT_MCIC: Record<PriceCommodity, { B: number; S: number }> = {
    fuel: { B: -80, S: 70 },
    organics: { B: -70, S: 60 },
    equipment: { B: -60, S: 50 },
};

export function playerBuiltMcicFor(commodity: PriceCommodity, action: PortAction): number {
    return PLAYER_BUILT_PORT_MCIC[commodity][action];
}

/** Per commodity. */
export const INITIAL_PLAYER_PORT_PRODUCTIVITY = 100;

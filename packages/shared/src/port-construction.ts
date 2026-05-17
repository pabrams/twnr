/**
 * Port construction + upgrade — legacy-derived constants.
 *
 * The "O" command from sector menu, overloaded: if a port already exists, the player
 * upgrades it; if not (and a planet is present), the player can construct a
 * new port. Construction is real-time gated: one advance attempt every 24
 * hours. Each attempt drains daily commodity quantities from a planet in the
 * sector; if no planet has enough, construction does not advance (checks again in another 24h).
 */

import type { PriceCommodity, PortAction } from './index.js';

export type PortClass = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type ConstructionCost = {
    /** Up-front credits to begin construction (one-time deduction). */
    credits: number;
    /** Total Fuel Ore consumed over the whole construction (sum across all days). */
    ore: number;
    /** Total Organics consumed. */
    org: number;
    /** Total Equipment consumed. */
    equ: number;
    /** Real-time days the construction takes. One advance attempt per day. */
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

/** Daily commodity drain per class (each total divided by days). All entries
 *  divide cleanly in the TW2002 table so there are no fractional days. */
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

/** Player-built ports use fixed MCIC magnitudes regardless of bigbang roll
 *  — they're stronger than typical NPC ports, making them profitable to
 *  trade with. Sign is set by the class action: B → negative, S → positive. */
export const PLAYER_BUILT_PORT_MCIC: Record<PriceCommodity, { B: number; S: number }> = {
    fuel: { B: -80, S: 70 },
    organics: { B: -70, S: 60 },
    equipment: { B: -60, S: 50 },
};

export function playerBuiltMcicFor(commodity: PriceCommodity, action: PortAction): number {
    return PLAYER_BUILT_PORT_MCIC[commodity][action];
}

/** All player-built ports start with productivity 100 per commodity
 *  (max = 1000). Upgrades grow this. */
export const INITIAL_PLAYER_PORT_PRODUCTIVITY = 100;

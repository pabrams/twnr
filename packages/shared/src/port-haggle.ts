/**
 * Port haggle AI (legacy-derived). Trades settle at the agreed total credits,
 * not the formula-computed unit price; a rejection costs the player a turn.
 * "playerFavorable" ratio = how much better than the initial offer the counter
 * is for the player: buying from an S port, initial/counter; selling to a
 * B port, counter/initial. Above the per-commodity/MCIC ceiling, reject.
 */

import type { PriceCommodity, PortAction } from './index.js';

/** Ceiling-ratio reference points: linear in |MCIC|, clamped outside the
 *  range. Numbers from the gap-analysis §1.7. */
export const HAGGLE_HEADROOM_REF: Record<
    PriceCommodity,
    { mcicLow: number; pctLow: number; mcicHigh: number; pctHigh: number }
> = {
    fuel: { mcicLow: 20, pctLow: 1.15, mcicHigh: 90, pctHigh: 1.494 },
    organics: { mcicLow: 30, pctLow: 1.15, mcicHigh: 75, pctHigh: 1.405 },
    equipment: { mcicLow: 20, pctLow: 1.102, mcicHigh: 65, pctHigh: 1.347 },
};

export function maxAcceptablePlayerFavorablePct(commodity: PriceCommodity, mcic: number): number {
    const ref = HAGGLE_HEADROOM_REF[commodity];
    const m = Math.abs(mcic);
    if (m <= ref.mcicLow) return ref.pctLow;
    if (m >= ref.mcicHigh) return ref.pctHigh;
    const t = (m - ref.mcicLow) / (ref.mcicHigh - ref.mcicLow);
    return ref.pctLow + t * (ref.pctHigh - ref.pctLow);
}

/** Fraction of the remaining gap conceded per mid round; bigger |MCIC| concedes less. */
export function midHaggleConcessionFraction(mcic: number): number {
    const m = Math.abs(mcic);
    if (m >= 56) return 0.6;
    if (m >= 36) return 0.65;
    return 0.75;
}

/** Final-offer concession = previous concession × this factor. */
export const FINAL_OFFER_FACTOR: Record<PriceCommodity, number> = {
    fuel: 3.0,
    organics: 2.7,
    equipment: 2.5,
};

/** Legacy: 0..3 mid rounds before the port goes final; rolled once per haggle session. */
export function rollMidHaggleRounds(rng: () => number = Math.random): number {
    return Math.floor(rng() * 4);
}

/** Counters within this many credits of the port's offer are accepted — absorbs floor/round noise. */
export const HAGGLE_ACCEPT_TOLERANCE_CREDITS = 10;

export type HaggleStep =
    | { outcome: 'accept'; finalTotal: number }
    | { outcome: 'counter'; newPortOffer: number; midRoundsLeft: number }
    | { outcome: 'final'; newPortOffer: number }
    | { outcome: 'reject'; reason: 'too_aggressive' };

/** One haggle round; stateless. All offers and `playerCounter` are total credits, not per-unit. */
export function processHaggleCounter(args: {
    action: PortAction;
    commodity: PriceCommodity;
    mcic: number;
    initialOffer: number;
    portCurrent: number;
    playerCounter: number;
    midRoundsLeft: number;
}): HaggleStep {
    const { action, commodity, mcic, initialOffer, portCurrent, playerCounter, midRoundsLeft } =
        args;

    if (playerCounter <= 0 || !Number.isFinite(playerCounter)) {
        return { outcome: 'reject', reason: 'too_aggressive' };
    }

    const favPct = action === 'B' ? playerCounter / initialOffer : initialOffer / playerCounter;
    const maxPct = maxAcceptablePlayerFavorablePct(commodity, mcic);
    if (favPct > maxPct) {
        return { outcome: 'reject', reason: 'too_aggressive' };
    }

    const gap = action === 'B' ? playerCounter - portCurrent : portCurrent - playerCounter;
    if (gap <= 0) {
        // Player offered something worse than the port's last counter — take it.
        return { outcome: 'accept', finalTotal: playerCounter };
    }
    if (gap <= HAGGLE_ACCEPT_TOLERANCE_CREDITS) {
        return { outcome: 'accept', finalTotal: playerCounter };
    }

    // Final offer. If the port hasn't moved yet (0 mid rounds rolled),
    // the mid-fraction of the gap stands in for the previous concession.
    if (midRoundsLeft <= 0) {
        const factor = FINAL_OFFER_FACTOR[commodity];
        const previousConcession =
            action === 'B' ? portCurrent - initialOffer : initialOffer - portCurrent;
        const baseline =
            previousConcession > 0 ? previousConcession : gap * midHaggleConcessionFraction(mcic);
        const concession = baseline * factor;
        if (concession >= gap) {
            return { outcome: 'accept', finalTotal: playerCounter };
        }
        const newPortOffer = action === 'B' ? portCurrent + concession : portCurrent - concession;
        return { outcome: 'final', newPortOffer: Math.floor(newPortOffer) };
    }

    const fraction = midHaggleConcessionFraction(mcic);
    const concession = gap * fraction;
    const newPortOffer = action === 'B' ? portCurrent + concession : portCurrent - concession;
    return {
        outcome: 'counter',
        newPortOffer: Math.floor(newPortOffer),
        midRoundsLeft: midRoundsLeft - 1,
    };
}

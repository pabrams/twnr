/**
 * Port haggle protocol — legacy-derived behavior.
 *
 * The trade flow becomes a multi-round negotiation: port opens with an
 * initial offer (computed from dynamic pricing), player counters, port
 * accepts / counters back / issues a final offer / rejects ("This conversation
 * is terminated!" = 1 turn lost). Eventually the trade settles at the
 * agreed total credits, *not* the formula-computed unit price.
 *
 * "playerFavorable" ratio = how much better-than-initial the counter is for
 * the player:
 *   - Buying from a Sell port: ratio = initial / counter (lower counter = better)
 *   - Selling to a Buy port:   ratio = counter / initial (higher counter = better)
 * The port rejects when this exceeds the per-commodity, per-MCIC ceiling.
 */

import type { PriceCommodity, PortAction } from './index.js';

/** Per-commodity reference points for the "max acceptable player-favorable
 *  ratio" line. Linear interpolation in |MCIC|; clamps outside the range.
 *  All numbers from the gap-analysis section 1.7. */
export const HAGGLE_HEADROOM_REF: Record<
    PriceCommodity,
    { mcicLow: number; pctLow: number; mcicHigh: number; pctHigh: number }
> = {
    fuel: { mcicLow: 20, pctLow: 1.15, mcicHigh: 90, pctHigh: 1.494 },
    organics: { mcicLow: 30, pctLow: 1.15, mcicHigh: 75, pctHigh: 1.405 },
    equipment: { mcicLow: 20, pctLow: 1.102, mcicHigh: 65, pctHigh: 1.347 },
};

/** Maximum acceptable player-favorable ratio of counter:initial for a given
 *  commodity + |MCIC|. Above this, the port "terminates" the conversation. */
export function maxAcceptablePlayerFavorablePct(
    commodity: PriceCommodity,
    mcic: number,
): number {
    const ref = HAGGLE_HEADROOM_REF[commodity];
    const m = Math.abs(mcic);
    if (m <= ref.mcicLow) return ref.pctLow;
    if (m >= ref.mcicHigh) return ref.pctHigh;
    const t = (m - ref.mcicLow) / (ref.mcicHigh - ref.mcicLow);
    return ref.pctLow + t * (ref.pctHigh - ref.pctLow);
}

/** Port's mid-round concession fraction (of the remaining gap) by MCIC band.
 *  Bigger |MCIC| → smaller fraction (richer ports concede less). */
export function midHaggleConcessionFraction(mcic: number): number {
    const m = Math.abs(mcic);
    if (m >= 56) return 0.6;
    if (m >= 36) return 0.65;
    return 0.75;
}

/** Final-offer multiplier per commodity, applied to the port's previous
 *  concession when computing how much further the port will move on its
 *  final offer. */
export const FINAL_OFFER_FACTOR: Record<PriceCommodity, number> = {
    fuel: 3.0,
    organics: 2.7,
    equipment: 2.5,
};

/** Legacy lets the player slip in roughly 0..3 mid rounds before the port
 *  goes final. Roll once at session start. */
export function rollMidHaggleRounds(rng: () => number = Math.random): number {
    return Math.floor(rng() * 4);
}

/** Within this many credits of the port's current offer, the port treats it
 *  as good enough and accepts. Absorbs floor/round noise. */
export const HAGGLE_ACCEPT_TOLERANCE_CREDITS = 10;

export type HaggleStep =
    | { outcome: 'accept'; finalTotal: number }
    | { outcome: 'counter'; newPortOffer: number; midRoundsLeft: number }
    | { outcome: 'final'; newPortOffer: number }
    | { outcome: 'reject'; reason: 'too_aggressive' };

/** Pure-function port AI for one round. Caller maintains session state and
 *  applies the returned outcome. `playerCounter` is the player's offer in
 *  total credits (not per-unit). */
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

    // Reject if player asks for more than the per-commodity / MCIC ceiling.
    const favPct =
        action === 'B' ? playerCounter / initialOffer : initialOffer / playerCounter;
    const maxPct = maxAcceptablePlayerFavorablePct(commodity, mcic);
    if (favPct > maxPct) {
        return { outcome: 'reject', reason: 'too_aggressive' };
    }

    // Gap remaining (in player-favorable direction) between port's current
    // offer and the player's counter.
    const gap = action === 'B' ? playerCounter - portCurrent : portCurrent - playerCounter;
    if (gap <= 0) {
        // Player offered something WORSE than port's last counter — take it.
        return { outcome: 'accept', finalTotal: playerCounter };
    }
    if (gap <= HAGGLE_ACCEPT_TOLERANCE_CREDITS) {
        return { outcome: 'accept', finalTotal: playerCounter };
    }

    // Out of mid rounds → issue final offer. The final concession is the
    // port's previous concession × FINAL_OFFER_FACTOR. If the port hasn't
    // moved yet (this is the first counter and we already rolled 0 mid
    // rounds), use the mid-fraction baseline.
    if (midRoundsLeft <= 0) {
        const factor = FINAL_OFFER_FACTOR[commodity];
        const previousConcession =
            action === 'B' ? portCurrent - initialOffer : initialOffer - portCurrent;
        const baseline =
            previousConcession > 0
                ? previousConcession
                : gap * midHaggleConcessionFraction(mcic);
        const concession = baseline * factor;
        // If the port would meet or exceed the player's counter, just accept
        if (concession >= gap) {
            return { outcome: 'accept', finalTotal: playerCounter };
        }
        const newPortOffer =
            action === 'B' ? portCurrent + concession : portCurrent - concession;
        return { outcome: 'final', newPortOffer: Math.floor(newPortOffer) };
    }

    // Mid round.
    const fraction = midHaggleConcessionFraction(mcic);
    const concession = gap * fraction;
    const newPortOffer =
        action === 'B' ? portCurrent + concession : portCurrent - concession;
    return {
        outcome: 'counter',
        newPortOffer: Math.floor(newPortOffer),
        midRoundsLeft: midRoundsLeft - 1,
    };
}

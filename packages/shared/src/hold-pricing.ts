/**
 * Cargo-hold pricing — legacy formula.
 *
 *   Cost(H_from→H_to) = Σ_{k=H_from}^{H_to-1} (B + k·I)
 *                     = B·(H_to − H_from) + I·(H_to·(H_to−1) − H_from·(H_from−1))/2
 *
 *   B = daily base cost (cycles between `min` and `max` over `periodDays`)
 *   I = increment per hold (`HOLD_COST_INCREMENT`, 20)
 *
 * The daily base cost is a deterministic triangular wave keyed off the UTC
 * day, so all players see the same B on a given day. With min=151, max=249,
 * periodDays=18: day 0 = 151, day 9 = 249, day 18 = 151, …
 */

export const HOLD_COST_INCREMENT = 20;

/** Days since the Unix epoch (UTC). Used as the seed for the daily base
 *  cost cycle so every player on a given calendar day sees the same B. */
export function utcDaysSinceEpoch(now: Date = new Date()): number {
    return Math.floor(now.getTime() / 86_400_000);
}

/** Today's base cost B given the min/max/period. Triangular wave: rises
 *  from `min` to `max` over `floor(periodDays/2)` days, then falls back
 *  over the remaining `periodDays - floor(periodDays/2)` days. */
export function holdBaseCostForDay(
    daysSinceEpoch: number,
    min: number,
    max: number,
    periodDays: number,
): number {
    if (periodDays <= 1 || max === min) return min;
    const half = Math.floor(periodDays / 2);
    const phase = ((daysSinceEpoch % periodDays) + periodDays) % periodDays;
    const range = max - min;
    if (phase <= half) {
        return min + Math.round((range * phase) / half);
    }
    return max - Math.round((range * (phase - half)) / (periodDays - half));
}

export function holdBaseCostNow(
    min: number,
    max: number,
    periodDays: number,
    now: Date = new Date(),
): number {
    return holdBaseCostForDay(utcDaysSinceEpoch(now), min, max, periodDays);
}

/** Total cost to buy `H` holds from 0 at base B. */
export function holdCostFromZero(
    H: number,
    B: number,
    increment: number = HOLD_COST_INCREMENT,
): number {
    if (H <= 0) return 0;
    return B * H + (increment * H * (H - 1)) / 2;
}

/** Total cost to go from currentHolds → targetHolds. */
export function holdCostRange(
    currentHolds: number,
    targetHolds: number,
    B: number,
    increment: number = HOLD_COST_INCREMENT,
): number {
    return (
        holdCostFromZero(targetHolds, B, increment) -
        holdCostFromZero(currentHolds, B, increment)
    );
}

/** Cost of the next single hold (the one that takes you from
 *  `currentHolds` to `currentHolds + 1`). Equivalent to holdCostRange
 *  with qty=1 but cheaper. */
export function nextHoldCost(
    currentHolds: number,
    B: number,
    increment: number = HOLD_COST_INCREMENT,
): number {
    return B + currentHolds * increment;
}

/** Maximum number of additional holds affordable at base B with the given
 *  credit budget. Closed-form via the quadratic, no iteration. */
export function maxAffordableHolds(
    currentHolds: number,
    credits: number,
    B: number,
    increment: number = HOLD_COST_INCREMENT,
): number {
    if (credits <= 0) return 0;
    // Solve increment/2 · N² + (B + increment·(2c−1)/2) · N − credits ≤ 0
    const a = increment / 2;
    const b = B + (increment * (2 * currentHolds - 1)) / 2;
    const c = -credits;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return 0;
    const N = Math.floor((-b + Math.sqrt(disc)) / (2 * a));
    return Math.max(0, N);
}

/**
 * Cargo-hold pricing — legacy formula.
 *   Cost(H_from→H_to) = Σ_{k=H_from}^{H_to-1} (B + k·I)
 *                     = B·(H_to − H_from) + I·(H_to·(H_to−1) − H_from·(H_from−1))/2
 * B = daily base cost, a deterministic triangular wave between `min` and `max`
 * over `periodDays`, keyed off the UTC day so every player sees the same B.
 * I = increment per hold (HOLD_COST_INCREMENT).
 */

export const HOLD_COST_INCREMENT = 20;

export function utcDaysSinceEpoch(now: Date = new Date()): number {
    return Math.floor(now.getTime() / 86_400_000);
}

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

export function holdCostFromZero(
    H: number,
    B: number,
    increment: number = HOLD_COST_INCREMENT,
): number {
    if (H <= 0) return 0;
    return B * H + (increment * H * (H - 1)) / 2;
}

export function holdCostRange(
    currentHolds: number,
    targetHolds: number,
    B: number,
    increment: number = HOLD_COST_INCREMENT,
): number {
    return (
        holdCostFromZero(targetHolds, B, increment) - holdCostFromZero(currentHolds, B, increment)
    );
}

export function nextHoldCost(
    currentHolds: number,
    B: number,
    increment: number = HOLD_COST_INCREMENT,
): number {
    return B + currentHolds * increment;
}

/** Max additional holds affordable with `credits`; closed-form, no iteration. */
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

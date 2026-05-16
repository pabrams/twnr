import { universeConfig } from '@twnr/shared';
import type { BigBangOptions } from './types.js';

/**
 * Default diameter cap as a function of N. `ceil(sqrt(0.8 * N))` gives 20 at
 * N=500 and 40 at N=2000 — a "voyage" feel where bigger universes feel
 * proportionally bigger, in contrast to a log-shaped curve that would
 * flatten out. `universeConfig.maxPathLength` is no longer consulted for the
 * generation path; it remains the schema-default fallback for stored rows.
 */
export function defaultMaxPathLength(sectors: number): number {
    return Math.max(5, Math.ceil(Math.sqrt(Math.max(1, sectors) * 0.8)));
}

/**
 * Build a fully-populated BigBangOptions from universeConfig plus any
 * caller-supplied overrides. Generates a random seed when one isn't passed.
 * warpDist is stored with a leading 0 so warpDist[degree] indexes directly.
 */
export function defaultBigBangOptions(
    overrides: Partial<BigBangOptions> & { sectors: number },
): BigBangOptions {
    return {
        seed: Math.floor(Math.random() * 2147483647),
        portDensity: universeConfig.portSpawnDensity,
        planetDensity: 0,
        twoWayPct: universeConfig.twoWayPct,
        warpDist: [0, ...universeConfig.warpDist],
        topology: universeConfig.topology,
        fillDensity: universeConfig.fillDensity,
        maxPathLength: defaultMaxPathLength(overrides.sectors),
        additionalClassZeroPorts: 2,
        ...overrides,
    };
}

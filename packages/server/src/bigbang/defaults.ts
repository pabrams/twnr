import { universeConfig } from '@twnr/shared';
import type { BigBangOptions } from './types.js';

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
        maxPathLength: universeConfig.maxPathLength,
        ...overrides,
    };
}

import { universeConfig } from '@twnr/shared';
import type { BigBangOptions } from './types.js';

/** warpDist carries a leading 0 so warpDist[degree] indexes directly; seed is random unless overridden. */
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
        additionalClassZeroPorts: 2,
        maxShortestPath: universeConfig.maxShortestPath,
        wormholesAlwaysTwoWay: universeConfig.wormholesAlwaysTwoWay,
        ...overrides,
    };
}

import { universeConfig } from '@twnr/shared';
import type { BigBangOptions } from './types.js';

export function defaultBigBangOptions(
    overrides: Partial<BigBangOptions> & { sectors: number },
): BigBangOptions {
    return {
        seed: Math.floor(Math.random() * 2147483647),
        portDensity: universeConfig.portSpawnDensity,
        planetDensity: 0,
        twoWayPct: universeConfig.twoWayPct,
        warpDist: [0, ...universeConfig.warpDist], // leading 0 so warpDist[degree] indexes directly
        topology: universeConfig.topology,
        additionalClassZeroPorts: 2,
        maxShortestPath: universeConfig.maxShortestPath,
        wormholesAlwaysTwoWay: universeConfig.wormholesAlwaysTwoWay,
        ...overrides,
    };
}

import { universeConfig } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { getStarbaseSectorNumber } from '../db/queries/sector.js';
import { getUniverseStats, getOutWarpDegreeDistribution } from '../db/queries/universe.js';
import { getStartingShipTypeBySlug } from '../db/queries/ship.js';
import { type CommandResult } from './command.js';

export async function serveStarbaseInfo(playerId: number): Promise<CommandResult<'StarbaseInfo'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const universeId = player.universeId;
    const sector = await getStarbaseSectorNumber(universeId);
    const stats = await getUniverseStats(universeId);
    const degDist = await getOutWarpDegreeDistribution(universeId);

    const outWarpDistribution: number[] = new Array(7).fill(0);
    for (const [deg, count] of degDist) {
        if (deg >= 0 && deg <= 6) outWarpDistribution[deg] = count;
    }

    let startingHolds = 0;
    const startingShipName = stats?.starter_ship_slug;
    if (startingShipName) {
        const shipType = await getStartingShipTypeBySlug(universeId, startingShipName);
        startingHolds = shipType?.starting_holds ?? 0;
    }

    const createdAt = stats?.created_at ?? new Date(0);
    const daysElapsed = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

    const respawnDelaySeconds = stats?.respawn_delay_seconds ?? universeConfig.respawnDelaySeconds;

    return {
        sector,
        universeName: stats?.name ?? '',
        sectorCount: stats?.sector_count ?? 0,
        portCount: stats?.port_count ?? 0,
        createdAt: createdAt.toISOString(),
        daysElapsed,
        outWarpDistribution,
        maxPlanetsPerSector: stats?.max_planets_per_sector ?? 0,
        startingCredits: stats?.starting_credits ?? 0,
        startingTurns: stats?.starting_turns ?? 0,
        startingDrones: stats?.starting_drones ?? 0,
        startingHolds,
        respawnDelaySeconds,
    };
}

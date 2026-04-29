import { ServerMsgType } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope } from '../state/messaging.js';
import { getStarbaseSectorNumber } from '../db/queries/sector.js';
import { getUniverseStats, getOutWarpDegreeDistribution } from '../db/queries/universe.js';
import { getStartingShipTypeByName } from '../db/queries/ship.js';
import { universeConfig } from '../universe-config.js';

export async function handleStarbaseInfo(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const universeId = player.universeId;
    const sector = await getStarbaseSectorNumber(universeId);
    const stats = await getUniverseStats(universeId);
    const degDist = await getOutWarpDegreeDistribution(universeId);

    // Build degree distribution array indexed 0..6.
    const outWarpDistribution: number[] = new Array(7).fill(0);
    for (const [deg, count] of degDist) {
        if (deg >= 0 && deg <= 6) outWarpDistribution[deg] = count;
    }

    // Starting holds comes from the universe's starting ship type.
    let startingHolds = 0;
    const startingShipName = stats?.starting_ship;
    if (startingShipName) {
        const shipType = await getStartingShipTypeByName(startingShipName);
        startingHolds = shipType?.starting_holds ?? 0;
    }

    const createdAt = stats?.created_at ?? new Date(0);
    const daysElapsed = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

    const respawnDelaySeconds = parseInt(
        process.env.SHIP_DESTROYED_LOGIN_DELAY_SECONDS ||
            String(universeConfig.respawnDelaySeconds),
        10,
    );

    sendEnvelope(playerId, {
        type: ServerMsgType.StarbaseInfoResult,
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
    });
}

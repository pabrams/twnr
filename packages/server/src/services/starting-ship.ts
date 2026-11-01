import { universeConfig, MAX_SHIP_NAME_LENGTH } from '@twnr/shared';
import { getStartingShipTypeBySlug, insertStartingShip } from '../db/queries/ship.js';
import { setPlayerShipId } from '../db/queries/player.js';
import { getUniverseTemplateDefaults } from '../db/queries/universe.js';
import { withTransaction } from '../db/index.js';
import { recordGameEvent } from './game-events.js';

const DEFAULT_NAME_SUFFIX = "'s ship";

export function defaultShipName(playerName: string): string {
    const stem = playerName
        .trim()
        .slice(0, MAX_SHIP_NAME_LENGTH - DEFAULT_NAME_SUFFIX.length)
        .trim();
    return stem === '' ? 'Unnamed ship' : `${stem}${DEFAULT_NAME_SUFFIX}`;
}

export async function grantStartingShip(
    playerId: number,
    universeId: number,
    sectorId: number,
    playerName: string,
): Promise<number | null> {
    const templateDefaults = await getUniverseTemplateDefaults(universeId);
    if (!templateDefaults?.starter_ship_slug) return null;

    const startShipType = await getStartingShipTypeBySlug(
        universeId,
        templateDefaults.starter_ship_slug,
    );
    if (!startShipType) return null;

    const startingDrones = templateDefaults.starting_drones ?? universeConfig.startingDrones;
    return withTransaction(async (client) => {
        const shipId = await insertStartingShip(
            playerId,
            universeId,
            startShipType.slug,
            sectorId,
            startingDrones,
            universeConfig.startingShields,
            startShipType.starting_holds,
            startShipType.turns_per_warp,
            defaultShipName(playerName),
            client,
        );
        await setPlayerShipId(playerId, shipId, client);
        await recordGameEvent(
            universeId,
            {
                kind: 'player_issued_ship',
                player: { playerId, name: playerName },
                shipId,
                shipType: { slug: startShipType.slug, displayName: startShipType.display_name },
            },
            client,
        );
        return shipId;
    });
}

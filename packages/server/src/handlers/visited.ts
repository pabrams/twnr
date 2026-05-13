import { ServerTag } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope } from '../state/messaging.js';
import { getVisitedSectors } from '../services/sector-lookup.js';
import { countSectorsInUniverse } from '../db/queries/sector.js';

/** Computer → Known Universe: return every sector the player has visited,
 *  plus the total sector count of their universe so the client can render
 *  the explored/unexplored toggle. */
export async function serveVisitedSectors(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const sectors = await getVisitedSectors(playerId);
    const totalSectors = await countSectorsInUniverse(player.universeId);
    sendEnvelope(playerId, {
        type: ServerTag.VisitedSectorsResult,
        sectors,
        totalSectors,
    });
}

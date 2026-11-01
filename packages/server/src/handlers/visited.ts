import { requireOnlinePlayer } from '../state/players.js';
import { getVisitedSectors } from '../services/sector-lookup.js';
import { countSectorsInUniverse } from '../db/queries/sector.js';
import { type CommandResult } from './command.js';

export async function serveVisitedSectors(
    playerId: number,
): Promise<CommandResult<'VisitedSectors'>> {
    const player = requireOnlinePlayer(playerId);
    const sectors = await getVisitedSectors(playerId);
    const totalSectors = await countSectorsInUniverse(player.universeId);
    return { outcome: 'ok', sectors, totalSectors };
}

import { onlinePlayers } from '../state/players.js';
import { listPlayersInUniverse } from '../db/queries/player.js';
import { type CommandResult } from './command.js';

export function servePlayersOnline(playerId: number): CommandResult<'PlayersOnline'> {
    const callerUniverse = onlinePlayers[playerId]?.universeId;
    const online = Object.entries(onlinePlayers)
        .filter(([, p]) => p.universeId === callerUniverse)
        .map(([id, p]) => ({ id: Number(id), name: p.name }));
    return { players: online };
}

export async function serveTraderList(playerId: number): Promise<CommandResult<'TraderList'>> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const rows = await listPlayersInUniverse(player.universeId);
    return {
        traders: rows.map((r) => ({
            name: r.name,
            shipTypeName: r.ship_type_name,
            coloredShipName: r.ship_display_name,
            clanNumber: r.clan_number,
            clanName: r.clan_name,
            reputation: r.reputation,
            experience: r.experience,
        })),
    };
}

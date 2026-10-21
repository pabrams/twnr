import { ServerTag } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { sendEnvelope } from '../state/messaging.js';
import { listPlayersInUniverse } from '../db/queries/player.js';

export function servePlayersOnline(playerId: number): void {
    const callerUniverse = onlinePlayers[playerId]?.universeId;
    const online = Object.entries(onlinePlayers)
        .filter(([, p]) => p.universeId === callerUniverse)
        .map(([id, p]) => ({ id: Number(id), name: p.name }));
    sendEnvelope(playerId, { type: ServerTag.PlayersOnlineResult, players: online });
}

/** Includes offline players, ranked by experience. */
export async function serveTraderList(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;

    const rows = await listPlayersInUniverse(player.universeId);
    sendEnvelope(playerId, {
        type: ServerTag.TraderListResult,
        traders: rows.map((r) => ({
            name: r.name,
            shipName: r.ship_name,
            coloredShipName: r.ship_display_name,
            clanNumber: r.clan_number,
            clanName: r.clan_name,
            reputation: r.reputation,
            experience: r.experience,
        })),
    });
}

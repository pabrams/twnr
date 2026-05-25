import { ServerTag } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { sendEnvelope } from '../state/messaging.js';

/** Snapshot of the in-memory player registry filtered to the caller's
 *  universe. Used by the Players-Online command. */
export function servePlayersOnline(playerId: number): void {
    const callerUniverse = onlinePlayers[playerId]?.universeId;
    const online = Object.entries(onlinePlayers)
        .filter(([, p]) => p.universeId === callerUniverse)
        .map(([id, p]) => ({ id: Number(id), name: p.name }));
    sendEnvelope(playerId, { type: ServerTag.PlayersOnlineResult, players: online });
}

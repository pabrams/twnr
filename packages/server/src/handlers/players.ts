import { ServerMsgType } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendEnvelope } from '../state/messaging.js';

/** Snapshot of the in-memory player registry filtered to the caller's
 *  universe. Used by the Players-Online command. */
export function handlePlayersOnline(playerId: number): void {
    const callerUniverse = players[playerId]?.universeId;
    const online = Object.entries(players)
        .filter(([, p]) => p.universeId === callerUniverse)
        .map(([id, p]) => ({ id: Number(id), name: p.name }));
    sendEnvelope(playerId, { type: ServerMsgType.PlayersOnlineResult, players: online });
}

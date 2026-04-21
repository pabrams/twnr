import { ServerMsgType } from '@twnr/shared';
import { players, sendEnvelope } from '../game-state.js';
import { getStarbaseSectorNumber } from '../db/queries/sector.js';

export async function handleStarbaseInfo(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const sector = await getStarbaseSectorNumber(player.universeId);
    sendEnvelope(playerId, { type: ServerMsgType.StarbaseInfoResult, sector });
}

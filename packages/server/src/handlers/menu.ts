import { ServerMsgType } from '@twnr/shared';
import { players, sendEnvelope, setPlayerMenu } from '../game-state.js';
import { canTransitionToMenu } from '../db/queries/menu.js';

/**
 * Handle a client request to change menu. Validates that the target menu
 * is reachable from the player's current menu via menu_command.target_menu_id.
 */
export async function handleChangeMenu(playerId: number, targetMenu: string): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!targetMenu || typeof targetMenu !== 'string') {
        sendEnvelope(playerId, { type: ServerMsgType.Error, message: 'Invalid menu' });
        return;
    }

    const allowed = await canTransitionToMenu(player.currentMenu, targetMenu);
    if (!allowed) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: `Cannot navigate to ${targetMenu} from ${player.currentMenu}`,
        });
        return;
    }

    await setPlayerMenu(playerId, targetMenu);
    sendEnvelope(playerId, { type: ServerMsgType.MenuChanged });
}

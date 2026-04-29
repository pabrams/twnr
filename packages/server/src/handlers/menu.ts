import { players, setPlayerMenu } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import { canTransitionToMenu } from '../db/queries/menu.js';

/**
 * Handle a client request to change menu. Validates that the target menu
 * is reachable from the player's current menu via menu_command.target_menu_id.
 */
export async function handleChangeMenu(playerId: number, targetMenu: string): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!targetMenu || typeof targetMenu !== 'string') {
        sendError(playerId, 'Invalid menu');
        return;
    }

    const allowed = await canTransitionToMenu(player.currentMenu, targetMenu);
    if (!allowed) {
        sendError(playerId, `Cannot navigate to ${targetMenu} from ${player.currentMenu}`);
        return;
    }

    await setPlayerMenu(playerId, targetMenu);
    // Pure menu transition — no payload. The envelope's `menu` field is
    // the only content; the client mirrors it into ctx.mode and renders
    // the new menu's prompt.
    sendEnvelope(playerId);
}

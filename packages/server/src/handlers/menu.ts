import { ServerMsgType } from '@twnr/shared';
import { players, sendEnvelope, setPlayerMenu } from '../game-state.js';
import { pool } from '../db/index.js';

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

    // Validate: target menu must be reachable from current menu
    const result = await pool.query(
        `SELECT t.name as target_name
         FROM menu_command mc
         JOIN menu src ON mc.menu_id = src.id
         JOIN menu t ON mc.target_menu_id = t.id
         WHERE src.name = $1 AND t.name = $2`,
        [player.currentMenu, targetMenu],
    );

    if (result.rows.length === 0) {
        sendEnvelope(playerId, {
            type: ServerMsgType.Error,
            message: `Cannot navigate to ${targetMenu} from ${player.currentMenu}`,
        });
        return;
    }

    await setPlayerMenu(playerId, targetMenu);
    sendEnvelope(playerId, { type: ServerMsgType.MenuChanged });
}

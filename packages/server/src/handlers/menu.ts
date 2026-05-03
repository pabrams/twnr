import type { MenuName } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendTransition, sendError } from '../state/messaging.js';
import { canTransitionToMenu, getParentMenuName } from '../db/queries/menu.js';
import { handleLeaveStarbase } from './port.js';

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

    // Pure menu transition — no payload. The client mirrors the `menu`
    // field into ctx.world.mode and the framework renders the new menu's
    // prompt. `sendTransition` updates server state too.
    await sendTransition(playerId, targetMenu as MenuName);
}

/**
 * Per-menu cleanup hooks fired by `handleBack`. Add an entry here when a
 * menu's "go back to parent" needs to do more than just transition (e.g.
 * leaving starbase flips at_starbase and re-renders the sector). For menus
 * not in this table, Back is a plain parent-menu transition.
 *
 * Each hook is responsible for sending its own envelope (with the parent
 * menu name); the dispatcher does not call `sendTransition` afterwards.
 */
const BACK_HOOKS: Record<string, (playerId: number) => Promise<void>> = {
    starbase: handleLeaveStarbase,
};

/**
 * Handle a generic Back ({type:'back'}) request. The client never says where
 * to go; the server reads the player's current menu, resolves its parent via
 * `menu.parent_menu_id`, and either runs a per-menu cleanup hook or just
 * transitions to the parent.
 */
export async function handleBack(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const current = player.currentMenu;
    const parent = await getParentMenuName(current);
    if (!parent) {
        sendError(playerId, `No parent menu for ${current}`);
        return;
    }

    const hook = BACK_HOOKS[current];
    if (hook) {
        await hook(playerId);
        return;
    }
    await sendTransition(playerId, parent as MenuName);
}

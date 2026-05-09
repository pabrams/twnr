import type { MenuName } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendTransition, sendError } from '../state/messaging.js';
import { handleLeaveStarbase } from './port.js';

/** Static parent map — replaces the dropped menu.parent_menu_id column.
 *  Only the server-tracked menus have entries; client-only sub-modes
 *  (computer, attack, droneEncounter, port pre-dock) handle their own
 *  back navigation locally and never reach handleBack. */
const MENU_PARENTS: Record<string, MenuName> = {
    port: 'sector',
    class0: 'port',
    planet: 'sector',
    planetEarth: 'sector',
    starbase: 'sector',
    starbaseHardware: 'starbase',
    shipyards: 'starbase',
    shipyardsClass0: 'shipyards',
};

const VALID_MENUS = new Set<string>([
    'sector',
    ...Object.keys(MENU_PARENTS),
]);

/**
 * Handle a client request to change menu. Validates the target is a
 * known menu name; trusts the client's choice of source/destination.
 * (Previously validated against menu_command.target_menu_id rows; that
 * table is gone.)
 */
export async function handleChangeMenu(playerId: number, targetMenu: string): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!targetMenu || typeof targetMenu !== 'string' || !VALID_MENUS.has(targetMenu)) {
        sendError(playerId, 'Invalid menu');
        return;
    }

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
 * to go; the server reads the player's current menu, resolves its parent
 * via the static MENU_PARENTS map, and either runs a per-menu cleanup hook
 * or just transitions to the parent.
 */
export async function handleBack(playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    const current = player.currentMenu;
    const parent = MENU_PARENTS[current];
    if (!parent) {
        sendError(playerId, `No parent menu for ${current}`);
        return;
    }

    const hook = BACK_HOOKS[current];
    if (hook) {
        await hook(playerId);
        return;
    }
    await sendTransition(playerId, parent);
}

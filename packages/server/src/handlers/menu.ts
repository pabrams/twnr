import type { MenuName } from '@twnr/shared';
import { players } from '../state/players.js';
import { sendTransition, sendError } from '../state/messaging.js';

/** The menu names a client may target via ChangeMenu. Real server-tracked
 *  locations only. UI sub-modes (computer, attack, droneEncounter, port
 *  pre-dock, shipyards, shipyardsClass0, starbaseHardware) live entirely
 *  client-side and are never on the wire. */
const VALID_MENUS = new Set<string>([
    'sector',
    'port',
    'class0',
    'planet',
    'planetEarth',
    'starbase',
]);

/**
 * Handle a client request to change menu. Validates the target is a
 * known menu name; trusts the client's choice. The client always knows
 * where it's going — there is no generic "back" mechanism on the wire.
 * Transitions with cleanup hooks (e.g. leaving starbase) use their own
 * specific message types (LeaveStarbase, LeavePlanet, Undock).
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

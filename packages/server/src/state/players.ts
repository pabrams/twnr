import { WebSocket } from 'ws';

export interface Player {
    ws: WebSocket;
    sector: number;
    sectorId: number;
    shipId: number | null;
    name: string;
    universeId: number;
    docked: boolean;
    isAdmin: boolean;
    at_starbase?: boolean;
    currentMenu: string;
}

/** Online-player registry. Populated on WebSocket connect, deleted on close. */
export const players: Record<number, Player> = {};

export function getPlayerUniverseId(playerId: number): number | undefined {
    return players[playerId]?.universeId;
}

/**
 * Visible-in-sector predicate. Hidden if on a planet, or online-and-docked.
 * Disconnected docked players are visible — port shelter applies only while
 * the player is actually present.
 */
export function isVisibleInSector(
    playerId: number,
    docked: boolean,
    onPlanetId: number | null,
): boolean {
    if (onPlanetId !== null) return false;
    const online = players[playerId] !== undefined;
    return !(online && docked);
}

/**
 * Update a player's current menu in the runtime registry. No longer
 * persisted — current menu doesn't survive reconnect (markPlayerLoggedIn
 * always resets to 'sector'). Async signature retained so callers can
 * keep `await setPlayerMenu(...)` without churn.
 */
export async function setPlayerMenu(playerId: number, menuName: string): Promise<void> {
    const player = players[playerId];
    if (player) player.currentMenu = menuName;
}

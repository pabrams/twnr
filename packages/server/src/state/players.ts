import { WebSocket } from 'ws';
import { setPlayerCurrentMenu } from '../db/queries/player.js';

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
 * Update a player's current menu in both the runtime registry and the DB
 * (so the menu survives reconnect). The DB write is awaited so callers
 * don't get stale state if they immediately query right after.
 */
export async function setPlayerMenu(playerId: number, menuName: string): Promise<void> {
    const player = players[playerId];
    if (player) player.currentMenu = menuName;
    await setPlayerCurrentMenu(playerId, menuName);
}

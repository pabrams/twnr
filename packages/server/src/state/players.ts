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
}

/** Online-player registry. Populated on WebSocket connect, deleted on close. */
export const onlinePlayers: Record<number, Player> = {};

export function getPlayerUniverseId(playerId: number): number | undefined {
    return onlinePlayers[playerId]?.universeId;
}

/**
 * Visible-in-sector predicate. Hidden if on a planet, or online-and-docked.
 */
export function isVisibleInSector(
    playerId: number,
    docked: boolean,
    onPlanetId: number | null,
): boolean {
    if (onPlanetId !== null) return false;
    const online = onlinePlayers[playerId] !== undefined;
    return !(online && docked);
}

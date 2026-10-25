import { WebSocket } from 'ws';

export interface Player {
    ws: WebSocket;
    sector: number;
    sectorId: number;
    shipId: number | null;
    shipName: string | null;
    name: string;
    universeId: number;
    docked: boolean;
    onPlanetId: number | null;
    isAdmin: boolean;
    at_starbase?: boolean;
}

export const onlinePlayers: Record<number, Player> = {};

export function getPlayerUniverseId(playerId: number): number | undefined {
    return onlinePlayers[playerId]?.universeId;
}

export function isVisibleInSector(
    playerId: number,
    docked: boolean,
    onPlanetId: number | null,
): boolean {
    if (onPlanetId !== null) return false;
    const online = onlinePlayers[playerId] !== undefined;
    return !(online && docked);
}

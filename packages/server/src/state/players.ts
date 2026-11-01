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
    /** Facing hostile drones after a warp; only AttackSectorDrones and RetreatFromDrones are allowed. */
    inEncounter: boolean;
    isAdmin: boolean;
    at_starbase?: boolean;
}

export const onlinePlayers: Record<number, Player> = {};

/** The player's socket closed while a command of theirs was still being handled; there is nobody to answer. */
export class PlayerOffline extends Error {
    constructor(readonly playerId: number) {
        super(`Player ${playerId} is no longer online`);
        this.name = 'PlayerOffline';
    }
}

export function requireOnlinePlayer(playerId: number): Player {
    const player = onlinePlayers[playerId];
    if (!player) throw new PlayerOffline(playerId);
    return player;
}

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

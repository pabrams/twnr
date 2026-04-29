import { WebSocket } from 'ws';
import { setPlayerCurrentMenu } from '../db/queries/player.js';

export interface TradeStep {
    commodity: 'fuel' | 'organics' | 'equipment';
    commodityLabel: string;
    action: 'buy' | 'sell';
    price: number;
}

export interface TradeState {
    steps: TradeStep[];
    stepIndex: number;
    prompted: Set<'fuel' | 'organics' | 'equipment'>;
    pendingQty?: number;
}

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
    pendingEncounter?: { retreatSector: number };
    currentMenu: string;
    tradeState?: TradeState;
}

/** Online-player registry. Populated on WebSocket connect, deleted on close. */
export const players: Record<number, Player> = {};

export function getPlayerUniverseId(playerId: number): number | undefined {
    return players[playerId]?.universeId;
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

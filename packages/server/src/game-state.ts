import { WebSocket } from 'ws';
import type { ServerResult } from '@twnr/shared';
import { ServerMsgType } from '@twnr/shared';
import { getPlanetsInSector, getCollisionsInSector } from './db/queries/sector.js';
import {
    listSectorNumbers,
    listWarpEdges,
    getWarpRefsForPlayer,
    getSectorDbId,
} from './db/queries/sector.js';
import { getPlayerShipFull, getAbandonedShipsInSector } from './db/queries/ship.js';
import { getShipHardwareQuantities, getShipTypeHardwareMax } from './db/queries/hardware.js';
import { getSectorDroneDisplayInfo } from './db/queries/drones.js';
import { getPortForSectorDisplay } from './db/queries/port.js';
import { setPlayerCurrentMenu, getVisitedSectorNumbers } from './db/queries/player.js';

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
    at_starbase?: boolean;
    pendingEncounter?: { retreatSector: number };
    currentMenu: string;
    tradeState?: TradeState;
}

/** Get the player's current ship with its type info + hardware maps. Returns null if no ship. */
export async function getPlayerShip(playerId: number) {
    const ship = await getPlayerShipFull(playerId);
    if (!ship) return null;

    const hwRows = await getShipHardwareQuantities(ship.id as number);
    (ship as Record<string, unknown>).hardware = Object.fromEntries(
        hwRows.map((r) => [r.name, r.quantity]),
    );

    const hwMaxRows = await getShipTypeHardwareMax(ship.ship_type_id as number);
    (ship as Record<string, unknown>).hardware_max = Object.fromEntries(
        hwMaxRows.map((r) => [r.name, r.max_quantity]),
    );

    return ship;
}

export const players: Record<number, Player> = {};

export type PortAction = 'B' | 'S';
export type PortClassActions = Record<'fuel' | 'organics' | 'equipment', PortAction>;

export const PORT_CLASS_ACTIONS: Record<number, PortClassActions> = {
    1: { fuel: 'B', organics: 'B', equipment: 'S' },
    2: { fuel: 'B', organics: 'S', equipment: 'B' },
    3: { fuel: 'S', organics: 'B', equipment: 'B' },
    4: { fuel: 'S', organics: 'S', equipment: 'B' },
    5: { fuel: 'B', organics: 'S', equipment: 'S' },
    6: { fuel: 'S', organics: 'B', equipment: 'S' },
    7: { fuel: 'S', organics: 'S', equipment: 'S' },
    8: { fuel: 'B', organics: 'B', equipment: 'B' },
};

export function portName(sectorId: number): string {
    return `Port ${sectorId}`;
}

export async function getVisitedSectors(playerId: number): Promise<number[]> {
    return getVisitedSectorNumbers(playerId);
}

export async function getWarpRefs(
    playerId: number,
    sectorNumber: number,
    universeId: number,
): Promise<{ sector: number; visited: boolean }[]> {
    return getWarpRefsForPlayer(playerId, sectorNumber, universeId);
}

export async function getPortForSector(
    sectorNumber: number,
    universeId: number,
): Promise<{ class: number; name: string } | null> {
    const row = await getPortForSectorDisplay(sectorNumber, universeId);
    if (!row) return null;
    return { class: row.class, name: portName(sectorNumber) };
}

/**
 * Builds the sector warp adjacency list for a specific universe.
 * Cached in memory — warps only change on universe create/delete (admin).
 */
const graphCache = new Map<number, number[][]>();

export async function getGraph(universeId: number): Promise<number[][]> {
    const cached = graphCache.get(universeId);
    if (cached) return cached;

    const [sectorNumbers, edges] = await Promise.all([
        listSectorNumbers(universeId),
        listWarpEdges(universeId),
    ]);
    if (sectorNumbers.length === 0) return [];

    const maxId = sectorNumbers[sectorNumbers.length - 1];
    const adjacencyList: number[][] = [];
    for (let i = 0; i <= maxId; i++) adjacencyList[i] = [];

    for (const e of edges) {
        if (adjacencyList[e.from]) adjacencyList[e.from].push(e.to);
    }

    graphCache.set(universeId, adjacencyList);
    return adjacencyList;
}

export function invalidateGraphCache(universeId: number): void {
    graphCache.delete(universeId);
}

export function broadcastTo(data: ServerResult, targetClients: Set<WebSocket> | WebSocket[]) {
    for (const client of targetClients) {
        if (client.readyState === 1) {
            const entry = Object.values(players).find((p) => p.ws === client);
            const menu = entry?.currentMenu ?? 'sector';
            client.send(JSON.stringify({ menu, payload: data }));
        }
    }
}

export function sendEnvelope(playerId: number, data: ServerResult) {
    const player = players[playerId];
    if (!player || player.ws.readyState !== 1) return;
    player.ws.send(JSON.stringify({ menu: player.currentMenu, payload: data }));
}

export function sendError(playerId: number, message: string): void {
    sendEnvelope(playerId, { type: ServerMsgType.Error, message });
}

export function broadcastEnvelope(data: ServerResult, targetPlayerIds: number[]) {
    for (const pid of targetPlayerIds) {
        const player = players[pid];
        if (player && player.ws.readyState === 1) {
            player.ws.send(JSON.stringify({ menu: player.currentMenu, payload: data }));
        }
    }
}

export async function setPlayerMenu(playerId: number, menuName: string): Promise<void> {
    const player = players[playerId];
    if (player) player.currentMenu = menuName;
    await setPlayerCurrentMenu(playerId, menuName);
}

export function getPlayerUniverseId(playerId: number): number | undefined {
    return players[playerId]?.universeId;
}

export async function resolveSectorId(sectorNumber: number, universeId: number): Promise<number> {
    const id = await getSectorDbId(sectorNumber, universeId);
    return id as number;
}

export async function buildSectorDisplayData(playerId: number, sectorNumber?: number) {
    const player = players[playerId];
    if (!player) return null;
    const sector = sectorNumber ?? player.sector;
    const universeId = player.universeId;

    const [port, warps, sectorDrones, planets, collisions, emptyShips] = await Promise.all([
        getPortForSector(sector, universeId),
        getWarpRefs(playerId, sector, universeId),
        getSectorDrones(sector, universeId),
        getPlanetsInSector(sector, universeId),
        getCollisionsInSector(sector, universeId),
        getEmptyShipsInSector(sector, universeId),
    ]);

    const playersInSector = Object.entries(players)
        .filter(
            ([id, p]) =>
                p.sector === sector &&
                p.universeId === universeId &&
                !p.docked &&
                Number(id) !== playerId,
        )
        .map(([id, p]) => ({ id: Number(id), name: p.name }));

    return {
        sector,
        warps,
        players: playersInSector,
        port,
        sectorDrones,
        planets,
        ships: emptyShips.length > 0 ? emptyShips : undefined,
        collisions,
    };
}

export async function getSectorDrones(
    sectorNumber: number,
    universeId: number,
): Promise<{ quantity: number; ownerId: number | null; ownerName: string } | null> {
    return getSectorDroneDisplayInfo(sectorNumber, universeId);
}

export async function getEmptyShipsInSector(
    sectorNumber: number,
    universeId: number,
): Promise<{ id: number; name: string; typeName: string; ownerName: string }[]> {
    const rows = await getAbandonedShipsInSector(sectorNumber, universeId);
    return rows.map((r) => ({
        id: r.id,
        name: r.typeName,
        typeName: r.typeName,
        ownerName: r.ownerName,
    }));
}

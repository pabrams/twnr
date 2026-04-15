import { WebSocket } from 'ws';
import type { ServerResult } from '@twnr/shared';
import { pool } from './db/index.js';
import type {
    HardwareRow,
    HardwareMaxRow,
    SectorNumberRow,
    WarpRow,
    SectorShipRow,
} from './db/types.js';
import { getPlanetsInSector, getCollisionsInSector } from './db/queries/sector.js';

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
}

/** Get the player's current ship with its type info. Returns null if no ship. */
export async function getPlayerShip(playerId: number) {
    const res = await pool.query(
        `SELECT s.id, s.drones, s.shields, s.holds,
                s.turns_per_warp, s.has_density_scanner,
                s.fuel, s.organics, s.equipment, s.colonists,
                s.sector_id, s.ship_type_id,
                st.name as ship_name, st.max_drones, st.max_shields, st.max_holds,
                st.starting_holds, st.turns_per_warp as type_turns_per_warp,
                st.cost_drive, st.cost_computer, st.cost_hull, st.hold_cost,
                st.odds_offensive, st.odds_defensive, st.speed,
                st.max_drone_attack, st.transporter_range,
                st.has_tractor, st.has_pod, st.can_land, st.has_interdictor,
                st.sort_order
         FROM ships s
         JOIN ship_types st ON s.ship_type_id = st.id
         WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)`,
        [playerId],
    );
    if (!res.rows[0]) return null;
    const ship = res.rows[0];

    // Attach hardware quantities as a map
    const hwRes = await pool.query<HardwareRow>(
        `SELECT hi.name, COALESCE(sh.quantity, 0) as quantity
         FROM hardware_item hi
         LEFT JOIN ship_hardware sh ON sh.hardware_item_id = hi.id AND sh.ship_id = $1`,
        [ship.id],
    );
    ship.hardware = Object.fromEntries(hwRes.rows.map((r) => [r.name, r.quantity]));

    // Attach hardware max quantities as a map
    const hwMaxRes = await pool.query<HardwareMaxRow>(
        `SELECT hi.name, COALESCE(sth.max_quantity, 0) as max_quantity
         FROM hardware_item hi
         LEFT JOIN ship_type_hardware sth ON sth.hardware_item_id = hi.id AND sth.ship_type_id = $1`,
        [ship.ship_type_id],
    );
    ship.hardware_max = Object.fromEntries(hwMaxRes.rows.map((r) => [r.name, r.max_quantity]));

    return ship;
}

export const players: Record<number, Player> = {};

export const PORT_CLASS_ACTIONS: Record<number, Record<string, 'B' | 'S'>> = {
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

/** Returns all sector_numbers the player has ever visited. */
export async function getVisitedSectors(playerId: number): Promise<number[]> {
    const res = await pool.query<SectorNumberRow>(
        `SELECT s.sector_number FROM visited_sectors vs
         JOIN sectors s ON vs.sector_id = s.id
         WHERE vs.player_id = $1`,
        [playerId],
    );
    return res.rows.map((r) => r.sector_number);
}

/**
 * Returns the warp destinations from `sectorNumber` as SectorRef[],
 * each with a `visited` flag for this player.
 */
export async function getWarpRefs(
    playerId: number,
    sectorNumber: number,
    universeId: number,
): Promise<{ sector: number; visited: boolean }[]> {
    const res = await pool.query<WarpRow>(
        `SELECT DISTINCT s_to.sector_number,
                (vs.player_id IS NOT NULL) AS visited
         FROM warps w
         JOIN sectors s_from ON w.from_sector_id = s_from.id
         JOIN sectors s_to   ON w.to_sector_id   = s_to.id
         LEFT JOIN visited_sectors vs ON vs.sector_id = s_to.id AND vs.player_id = $1
         WHERE s_from.sector_number = $2 AND s_from.universe_id = $3
         ORDER BY s_to.sector_number`,
        [playerId, sectorNumber, universeId],
    );
    return res.rows.map((r) => ({ sector: r.sector_number, visited: r.visited }));
}

export async function getPortForSector(
    sectorNumber: number,
    universeId: number,
): Promise<{ class: number; name: string } | null> {
    const res = await pool.query(
        `SELECT p.class FROM ports p
         JOIN sectors s ON p.sector_id = s.id
         WHERE s.sector_number = $1 AND s.universe_id = $2`,
        [sectorNumber, universeId],
    );
    if (res.rows.length === 0) return null;
    return { class: res.rows[0].class, name: portName(sectorNumber) };
}

/**
 * Builds the sector warp adjacency list for a specific universe.
 */
export async function getGraph(universeId: number): Promise<number[][]> {
    const sectorsRes = await pool.query(
        'SELECT sector_number FROM sectors WHERE universe_id = $1 ORDER BY sector_number ASC',
        [universeId],
    );
    const size = sectorsRes.rows.length;

    if (size === 0) {
        return [];
    }

    const maxId = sectorsRes.rows[size - 1].sector_number;
    let adjacencyList: number[][] = [];
    for (let i = 0; i <= maxId; i++) {
        adjacencyList[i] = [];
    }

    const warpsRes = await pool.query(
        `SELECT s_from.sector_number as sector_from, s_to.sector_number as sector_to
         FROM warps w
         JOIN sectors s_from ON w.from_sector_id = s_from.id
         JOIN sectors s_to ON w.to_sector_id = s_to.id
         WHERE s_from.universe_id = $1`,
        [universeId],
    );
    for (const row of warpsRes.rows) {
        if (adjacencyList[row.sector_from]) {
            adjacencyList[row.sector_from].push(row.sector_to);
        }
    }

    return adjacencyList;
}

export function broadcastTo(data: ServerResult, targetClients: Set<WebSocket> | WebSocket[]) {
    for (const client of targetClients) {
        if (client.readyState === 1) {
            // Find the player's current menu for the envelope
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
    await pool.query(
        `UPDATE players SET current_menu_id = (SELECT id FROM menu WHERE name = $1) WHERE id = $2`,
        [menuName, playerId],
    );
}

export function getPlayerUniverseId(playerId: number): number | undefined {
    return players[playerId]?.universeId;
}

export async function resolveSectorId(sectorNumber: number, universeId: number): Promise<number> {
    const res = await pool.query(
        'SELECT id FROM sectors WHERE sector_number = $1 AND universe_id = $2',
        [sectorNumber, universeId],
    );
    return res.rows[0]?.id;
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
    const res = await pool.query(
        `SELECT sf.quantity, sf.owner_id, COALESCE(p.name, 'Rogue') as owner_name
         FROM sector_drones sf
         JOIN sectors s ON sf.sector_id = s.id
         LEFT JOIN players p ON sf.owner_id = p.id
         WHERE s.sector_number = $1 AND s.universe_id = $2 AND sf.quantity > 0`,
        [sectorNumber, universeId],
    );
    if (res.rows.length === 0) return null;
    return {
        quantity: res.rows[0].quantity,
        ownerId: res.rows[0].owner_id,
        ownerName: res.rows[0].owner_name,
    };
}

export async function getEmptyShipsInSector(
    sectorNumber: number,
    universeId: number,
): Promise<{ id: number; name: string; typeName: string; ownerName: string }[]> {
    const res = await pool.query<SectorShipRow>(
        `SELECT sh.id, st.name AS type_name, COALESCE(p.name, 'Abandoned') AS owner_name
         FROM ships sh
         JOIN ship_types st ON sh.ship_type_id = st.id
         JOIN sectors s ON sh.sector_id = s.id
         LEFT JOIN players p ON sh.owner_id = p.id
         WHERE s.sector_number = $1 AND s.universe_id = $2
           AND NOT EXISTS (SELECT 1 FROM players p2 WHERE p2.ship_id = sh.id)`,
        [sectorNumber, universeId],
    );
    return res.rows.map((r) => ({
        id: r.id,
        name: r.type_name,
        typeName: r.type_name,
        ownerName: r.owner_name,
    }));
}

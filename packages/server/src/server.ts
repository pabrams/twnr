import express from 'express';
import fs from 'fs';
import path from 'path';
import { Socket } from 'net';
import helmet from 'helmet';
import { createServer, Server, IncomingMessage } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { connectDB, pool } from './db.js';
import { createRoutes } from './routes.js';
import * as auth from './ws-auth.js';
import { ServerMsgType, ClientMsgType } from '@twnr/shared';
import type { AuthTokenPayload, ServerMessage } from '@twnr/shared';

const shipConfigs: Record<string, any> = {};
try {
    const shipsDir = path.join(process.cwd(), 'config', 'ships');
    const files = fs.readdirSync(shipsDir);
    for (const file of files) {
        if (file.endsWith('.json')) {
            const data = JSON.parse(fs.readFileSync(path.join(shipsDir, file), 'utf-8'));
            shipConfigs[data.name] = data;
        }
    }
} catch (e) {
    console.error('Could not load ship configs', e);
}

const app: ReturnType<typeof express> = express();
app.use(helmet());
app.use(express.json());
const server: Server = createServer(app);
const wss = new WebSocketServer({ server });

server.prependListener('upgrade', (req: IncomingMessage, socket: Socket) => {
    if (req.url !== '/ws') {
        auth.rejectWebSocketUpgrade(socket);
        return;
    }
    if (!auth.isAllowedWebSocketOrigin(req)) {
        auth.rejectWebSocketUpgrade(socket);
        return;
    }
    const cookies = auth.parseCookies(req.headers.cookie);
    const jwtToken = cookies[auth.AUTH_COOKIE_NAME];
    if (!jwtToken) {
        auth.rejectWebSocketUpgrade(socket);
        return;
    }
    try {
        auth.verifyToken(jwtToken);
    } catch {
        auth.rejectWebSocketUpgrade(socket);
    }
});

interface Player {
    ws: WebSocket;
    sector: number;
    name: string;
}
const players: Record<number, Player> = {};

app.use(
    createRoutes({
        hashPassword: auth.hashPassword,
        verifyPassword: auth.verifyPassword,
        signPlayerToken: auth.signPlayerToken,
        verifyToken: auth.verifyToken,
        setAuthCookie: auth.setAuthCookie,
        getJwtToken: auth.getJwtToken,
        getAuthenticatedPlayer: auth.getAuthenticatedPlayer,
        shipConfigs,
        players,
        AUTH_COOKIE_NAME: auth.AUTH_COOKIE_NAME,
        ADMIN_API_KEY: auth.ADMIN_API_KEY,
    }),
);

const PORT_CLASS_ACTIONS: Record<number, Record<string, 'B' | 'S'>> = {
    1: { fuel: 'B', organics: 'B', equipment: 'S' },
    2: { fuel: 'B', organics: 'S', equipment: 'B' },
    3: { fuel: 'S', organics: 'B', equipment: 'B' },
    4: { fuel: 'S', organics: 'S', equipment: 'B' },
    5: { fuel: 'B', organics: 'S', equipment: 'S' },
    6: { fuel: 'S', organics: 'B', equipment: 'S' },
    7: { fuel: 'S', organics: 'S', equipment: 'S' },
    8: { fuel: 'B', organics: 'B', equipment: 'B' },
};

/**
 * Builds the sector warp adjacency list from the database.
 * Index `i` contains an array of sector IDs reachable from sector `i`.
 * @returns A sparse adjacency list indexed by sector ID
 * @throws {Error} If no sectors exist in the database
 */
export async function getGraph(): Promise<number[][]> {
    const sectorsRes = await pool.query('SELECT id FROM sectors ORDER BY id ASC');
    const size = sectorsRes.rows.length;

    if (size === 0) {
        throw new Error(
            'No sectors found in database. Load universe data before starting the server.',
        );
    }

    let adjacencyList: number[][] = [];
    for (let i = 0; i <= size; i++) {
        adjacencyList[i] = [];
    }

    const warpsRes = await pool.query('SELECT sector_from, sector_to FROM warps');
    for (const row of warpsRes.rows) {
        if (adjacencyList[row.sector_from]) {
            adjacencyList[row.sector_from].push(row.sector_to);
        }
    }

    return adjacencyList;
}

/**
 * Sends a JSON-serialized message to all open WebSocket clients in the given set.
 * Silently skips clients that are not in the OPEN ready state.
 * @param data - The server message to broadcast
 * @param targetClients - The set or array of WebSocket clients to send to
 */
function broadcastTo(data: ServerMessage, targetClients: Set<WebSocket> | WebSocket[]) {
    for (const client of targetClients) {
        if (client.readyState === 1) {
            client.send(JSON.stringify(data));
        }
    }
}

/**
 * Sends a typed server message to a single WebSocket client as JSON.
 * @param ws - The WebSocket client to send to
 * @param data - The server message to send
 */
function send(ws: WebSocket, data: ServerMessage) {
    ws.send(JSON.stringify(data));
}

wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    console.log('New WebSocket client connected');
    const cookies = auth.parseCookies(req.headers.cookie);
    let authPayload: AuthTokenPayload;
    try {
        authPayload = auth.verifyToken(cookies[auth.AUTH_COOKIE_NAME] || '');
    } catch {
        ws.close(1008, 'Authentication required');
        return;
    }

    const playerId = authPayload.playerId;

    try {
        const playerRes = await pool.query(
            'SELECT id, name, current_sector, token_version FROM players WHERE id = $1',
            [playerId],
        );
        if (playerRes.rows.length === 0) {
            ws.close(1008, 'Player not found');
            return;
        }
        const playerRow = playerRes.rows[0];
        if (playerRow.token_version !== authPayload.tokenVersion) {
            ws.close(1008, 'Token has been revoked');
            return;
        }
        const sector: number = playerRow.current_sector;

        players[playerId] = { ws, sector, name: playerRow.name };
        const welcomeMsg: ServerMessage = {
            type: ServerMsgType.Welcome,
            playerId,
            name: playerRow.name,
            sector,
            token: auth.signPlayerToken({
                playerId,
                name: playerRow.name,
                role: authPayload.role,
                tokenVersion: playerRow.token_version,
            }),
        };
        ws.send(JSON.stringify(welcomeMsg));
        console.log(`${playerId} connected.`);

        let tokens = 50;
        const refillInterval = setInterval(() => {
            tokens = Math.min(50, tokens + 20);
        }, 1000);

        ws.on('message', async (message) => {
            if (tokens <= 0) {
                send(ws, { type: ServerMsgType.RateLimited });
                return;
            }
            tokens--;

            let data: any;
            try {
                data = JSON.parse(message.toString());
            } catch {
                send(ws, { type: ServerMsgType.Error, message: 'Invalid JSON' });
                return;
            }

            try {
                await handleMessage(ws, playerId, data);
            } catch (err) {
                console.error('Message handler error:', err);
                send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
            }
        });

        ws.on('close', () => {
            clearInterval(refillInterval);
            console.log(`${playerId} disconnected.`);
            const lastSector = players[playerId]?.sector;
            delete players[playerId];

            if (lastSector) {
                const clientsToNotify = new Set<WebSocket>();
                for (const p of Object.values(players)) {
                    if (p.sector === lastSector) {
                        clientsToNotify.add(p.ws);
                    }
                }
                broadcastTo({ type: ServerMsgType.PlayerLeft, playerId }, clientsToNotify);
            }
        });
    } catch (error) {
        console.error('Connection error:', error);
        ws.close();
    }
});

/**
 * Routes an incoming WebSocket message to the appropriate handler based on its `type` field.
 * @param ws - The client's WebSocket connection
 * @param playerId - The authenticated player's ID
 * @param data - The parsed message object from the client
 */
export async function handleMessage(ws: WebSocket, playerId: number, data: any): Promise<void> {
    switch (data.type) {
        case ClientMsgType.Move:
            return handleMove(ws, playerId, data.sector);
        case ClientMsgType.SectorDisplay:
            return handleSectorDisplay(ws, playerId);
        case ClientMsgType.Who:
            return handleWho(ws);
        case ClientMsgType.SectorWarps:
            return handleSectorWarps(ws, data.id);
        case ClientMsgType.Path:
            return handlePath(ws, data.from, data.to);
        case ClientMsgType.PortInfo:
            return handlePortInfo(ws, data.sectorId);
        case ClientMsgType.ShipInfo:
            return handleShipInfo(ws, playerId);
        case ClientMsgType.CargoInfo:
            return handleCargoInfo(ws, playerId);
        case ClientMsgType.PortTransaction:
            return handlePortTransaction(ws, playerId, data.good, data.quantity, data.action);
        case ClientMsgType.BuyFighters:
            return handleBuyFighters(ws, playerId, data.quantity);
        case ClientMsgType.BuyShields:
            return handleBuyShields(ws, playerId, data.quantity);
        case ClientMsgType.BuyHolds:
            return handleBuyHolds(ws, playerId, data.quantity);
        case ClientMsgType.ShipExchange:
            return handleShipExchange(ws, playerId, data.targetShipName);
        case ClientMsgType.Attack:
            return handleAttack(ws, playerId, data.targetPlayerId, data.fighters);
        default:
            send(ws, { type: ServerMsgType.Error, message: 'Unknown message type' });
    }
}

/**
 * Sends a list of all currently connected player IDs.
 */
function handleWho(ws: WebSocket): void {
    const playersKeys = Object.keys(players).map(Number);
    send(ws, { type: ServerMsgType.PlayersOnline, players: playersKeys });
}

/**
 * Handles a player movement request to an adjacent sector.
 * Validates the player has a ship and the target sector is adjacent,
 * then broadcasts movement events to players in both sectors.
 */
export async function handleMove(
    ws: WebSocket,
    playerId: number,
    targetSector: number,
): Promise<void> {
    if (!Number.isInteger(targetSector) || targetSector <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid sector' });
        return;
    }

    const shipRes = await pool.query('SELECT player_id FROM player_ships WHERE player_id = $1', [
        playerId,
    ]);
    if (shipRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.NoShip });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    const warps = await getGraph();
    const currentSector = player.sector;

    if (!warps[currentSector]?.includes(targetSector)) {
        send(ws, { type: ServerMsgType.NonAdjacentMoveRequested, playerId, sector: targetSector });
        return;
    }

    player.sector = targetSector;
    await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [
        targetSector,
        playerId,
    ]);

    const oldSectorClients = new Set<WebSocket>();
    const newSectorClients = new Set<WebSocket>();
    for (const [idStr, p] of Object.entries(players)) {
        if (Number(idStr) === playerId) continue;
        if (p.sector === currentSector) oldSectorClients.add(p.ws);
        else if (p.sector === targetSector) newSectorClients.add(p.ws);
    }
    broadcastTo(
        { type: ServerMsgType.PlayerMoved, playerId, sector: targetSector, direction: 'out' },
        oldSectorClients,
    );
    broadcastTo(
        { type: ServerMsgType.PlayerMoved, playerId, sector: targetSector, direction: 'in' },
        newSectorClients,
    );

    const displayWarps = warps[targetSector] || [];
    const playersInSector = Object.entries(players)
        .filter(([, p]) => p.sector === targetSector)
        .map(([id]) => Number(id));
    send(ws, {
        type: ServerMsgType.SectorDisplay,
        sector: targetSector,
        warps: displayWarps,
        players: playersInSector,
    });
}

/**
 * Sends the player their current sector's display info (warps and players present).
 */
export async function handleSectorDisplay(ws: WebSocket, playerId: number): Promise<void> {
    const currentSector = players[playerId]?.sector;
    if (currentSector === undefined) return;

    const warps = await getGraph();
    const displayWarps = warps[currentSector] || [];
    const playersInSector = Object.entries(players)
        .filter(([, p]) => p.sector === currentSector)
        .map(([id]) => Number(id));
    send(ws, {
        type: ServerMsgType.SectorDisplay,
        sector: currentSector,
        warps: displayWarps,
        players: playersInSector,
    });
}

/**
 * Returns a sector's outbound warp connections.
 * @param id - The sector ID to look up
 */
export async function handleSectorWarps(ws: WebSocket, id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const sectorRes = await pool.query('SELECT id FROM sectors WHERE id = $1', [id]);
    if (sectorRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Sector not found' });
        return;
    }

    const warpsRes = await pool.query('SELECT sector_to FROM warps WHERE sector_from = $1', [id]);
    const warps = warpsRes.rows.map((r) => r.sector_to);
    send(ws, { type: ServerMsgType.SectorWarps, id, warps });
}

/**
 * Finds the shortest path between two sectors using BFS.
 * @param from - Origin sector ID
 * @param to - Destination sector ID
 */
export async function handlePath(ws: WebSocket, from: number, to: number): Promise<void> {
    if (!Number.isInteger(from) || from <= 0 || !Number.isInteger(to) || to <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const sectorRes = await pool.query('SELECT id FROM sectors WHERE id IN ($1, $2)', [from, to]);
    if (sectorRes.rows.length !== (from === to ? 1 : 2)) {
        const foundIds = new Set(sectorRes.rows.map((r: any) => r.id));
        if (!foundIds.has(from) || !foundIds.has(to)) {
            send(ws, { type: ServerMsgType.Error, message: 'Sector not found' });
            return;
        }
    }

    if (from === to) {
        send(ws, { type: ServerMsgType.PathResult, path: [from], hops: 0 });
        return;
    }

    const warps = await getGraph();
    const queue: { sector: number; path: number[] }[] = [{ sector: from, path: [from] }];
    const visited = new Set<number>();
    visited.add(from);

    while (queue.length > 0) {
        const { sector, path } = queue.shift()!;
        const neighbors = warps[sector] || [];
        for (const neighbor of neighbors) {
            if (neighbor === to) {
                const finalPath = [...path, neighbor];
                send(ws, {
                    type: ServerMsgType.PathResult,
                    path: finalPath,
                    hops: finalPath.length - 1,
                });
                return;
            }
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push({ sector: neighbor, path: [...path, neighbor] });
            }
        }
    }

    send(ws, { type: ServerMsgType.Error, message: 'No path found' });
}

/**
 * Returns port details for a sector, including class, inventory, and prices.
 * @param sectorId - The sector ID to look up
 */
export async function handlePortInfo(ws: WebSocket, sectorId: number): Promise<void> {
    if (!Number.isInteger(sectorId) || sectorId <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const portRes = await pool.query(
        'SELECT sector_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1',
        [sectorId],
    );
    if (portRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'No port in this sector' });
        return;
    }

    const p = portRes.rows[0];
    send(ws, {
        type: ServerMsgType.PortInfo,
        sectorId: p.sector_id,
        class: p.class,
        fuel: p.fuel,
        fuelPrice: p.fuel_price,
        organics: p.organics,
        orgPrice: p.org_price,
        equipment: p.equipment,
        equPrice: p.equ_price,
    });
}

/**
 * Returns ship status for the authenticated player, including armament, cargo, and config limits.
 */
export async function handleShipInfo(ws: WebSocket, playerId: number): Promise<void> {
    const query = `
        SELECT ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit,
               sc.fuel, sc.organics, sc.equipment
        FROM player_ships ps
        JOIN ship_cargo sc ON ps.player_id = sc.player_id
        WHERE ps.player_id = $1
    `;
    const result = await pool.query(query, [playerId]);
    if (result.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Ship not found' });
        return;
    }

    const row = result.rows[0];
    const config = shipConfigs[row.ship_name];
    if (!config) {
        send(ws, { type: ServerMsgType.Error, message: 'Ship config missing' });
        return;
    }

    const holdsAvailable = row.cargo_limit - (row.fuel + row.organics + row.equipment);
    send(ws, {
        type: ServerMsgType.ShipInfo,
        playerId,
        shipName: row.ship_name,
        fighters: row.fighters,
        shields: row.shields,
        maxFighters: config.maxFighters,
        maxShields: config.maxShields,
        cargoLimit: row.cargo_limit,
        maxHolds: config.maxHolds,
        cargoFuel: row.fuel,
        cargoOrganics: row.organics,
        cargoEquipment: row.equipment,
        holdsAvailable,
    });
}

/**
 * Returns the player's cargo hold contents and credit balance.
 */
export async function handleCargoInfo(ws: WebSocket, playerId: number): Promise<void> {
    const cargoRes = await pool.query(
        'SELECT player_id, fuel, organics, equipment, credits FROM ship_cargo WHERE player_id = $1',
        [playerId],
    );
    if (cargoRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
        return;
    }

    const c = cargoRes.rows[0];
    send(ws, {
        type: ServerMsgType.CargoInfo,
        playerId: c.player_id,
        fuel: c.fuel,
        organics: c.organics,
        equipment: c.equipment,
        credits: c.credits,
    });
}

/**
 * Buys or sells a commodity at the port in the player's current sector.
 * Validates port class compatibility, inventory, cargo capacity, and credits.
 * Executed as a database transaction.
 * @param good - The commodity to trade (`fuel`, `organics`, or `equipment`)
 * @param quantity - Number of units to trade
 * @param action - `buy` (from port) or `sell` (to port)
 */
export async function handlePortTransaction(
    ws: WebSocket,
    playerId: number,
    good: string,
    quantity: number,
    action: string,
): Promise<void> {
    const VALID_GOODS: Record<string, string> = {
        fuel: 'fuel',
        organics: 'organics',
        equipment: 'equipment',
    };
    const col = VALID_GOODS[good];
    if (!col) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid good' });
        return;
    }

    if (!['buy', 'sell'].includes(action)) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid action' });
        return;
    }

    const qty = Number.isInteger(quantity) ? quantity : parseInt(String(quantity), 10);
    if (isNaN(qty) || qty <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [
            playerId,
        ]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query(
            'SELECT class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1 FOR UPDATE',
            [currentSector],
        );
        if (portRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'No port in this sector' });
            return;
        }

        const port = portRes.rows[0];

        const priceColMap: Record<string, string> = {
            fuel: 'fuel_price',
            organics: 'org_price',
            equipment: 'equ_price',
        };
        const portActions = PORT_CLASS_ACTIONS[port.class];
        if (
            !portActions ||
            (action === 'buy' && portActions[good] !== 'S') ||
            (action === 'sell' && portActions[good] !== 'B')
        ) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Port does not trade this commodity' });
            return;
        }

        const price: number = port[priceColMap[good]];

        const cargoRes = await client.query(
            `
            SELECT sc.fuel, sc.organics, sc.equipment, sc.credits, ps.cargo_limit
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `,
            [playerId],
        );
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const cargo = cargoRes.rows[0];

        if (action === 'buy') {
            const cost = qty * price;
            if (cargo.credits < cost) {
                await client.query('ROLLBACK');
                send(ws, { type: ServerMsgType.Error, message: 'Insufficient credits' });
                return;
            }
            if (port[good] < qty) {
                await client.query('ROLLBACK');
                send(ws, { type: ServerMsgType.Error, message: 'Insufficient port inventory' });
                return;
            }
            if (cargo.fuel + cargo.organics + cargo.equipment + qty > cargo.cargo_limit) {
                await client.query('ROLLBACK');
                send(ws, { type: ServerMsgType.Error, message: 'Insufficient cargo holds' });
                return;
            }

            await client.query(`UPDATE ports SET ${col} = ${col} - $1 WHERE sector_id = $2`, [
                qty,
                currentSector,
            ]);
            await client.query(
                `UPDATE ship_cargo SET ${col} = ${col} + $1, credits = credits - $2 WHERE player_id = $3`,
                [qty, cost, playerId],
            );
            await client.query('COMMIT');

            cargo[good] += qty;
            cargo.credits -= cost;
            send(ws, {
                type: ServerMsgType.PortTransactionResult,
                credits: cargo.credits,
                cargo: { fuel: cargo.fuel, organics: cargo.organics, equipment: cargo.equipment },
            });
        } else {
            const revenue = qty * price;
            if (cargo[good] < qty) {
                await client.query('ROLLBACK');
                send(ws, { type: ServerMsgType.Error, message: 'Insufficient cargo' });
                return;
            }

            await client.query(`UPDATE ports SET ${col} = ${col} + $1 WHERE sector_id = $2`, [
                qty,
                currentSector,
            ]);
            await client.query(
                `UPDATE ship_cargo SET ${col} = ${col} - $1, credits = credits + $2 WHERE player_id = $3`,
                [qty, revenue, playerId],
            );
            await client.query('COMMIT');

            cargo[good] -= qty;
            cargo.credits += revenue;
            send(ws, {
                type: ServerMsgType.PortTransactionResult,
                credits: cargo.credits,
                cargo: { fuel: cargo.fuel, organics: cargo.organics, equipment: cargo.equipment },
            });
        }
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Trade error', err);
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

/**
 * Purchases fighters at a class 0 port. Cost: 20 credits each.
 * @param quantity - Number of fighters to buy
 */
export async function handleBuyFighters(
    ws: WebSocket,
    playerId: number,
    quantity: number,
): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [
            playerId,
        ]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query('SELECT class FROM ports WHERE sector_id = $1', [
            currentSector,
        ]);
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Not at a class 0 port' });
            return;
        }

        const cargoRes = await client.query(
            `
            SELECT sc.credits, ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `,
            [playerId],
        );
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.fighters + qty > config.maxFighters) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Exceeds maximum' });
            return;
        }

        const cost = qty * 20;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        await client.query(
            'UPDATE player_ships SET fighters = fighters + $1 WHERE player_id = $2',
            [qty, playerId],
        );
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [
            cost,
            playerId,
        ]);
        await client.query('COMMIT');

        send(ws, {
            type: ServerMsgType.BuyResult,
            credits: data.credits - cost,
            fighters: data.fighters + qty,
            shields: data.shields,
            cargoLimit: data.cargo_limit,
        });
    } catch {
        await client.query('ROLLBACK');
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

/**
 * Purchases shields at a class 0 port. Cost: 10 credits each.
 * @param quantity - Number of shields to buy
 */
export async function handleBuyShields(
    ws: WebSocket,
    playerId: number,
    quantity: number,
): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [
            playerId,
        ]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query('SELECT class FROM ports WHERE sector_id = $1', [
            currentSector,
        ]);
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Not at a class 0 port' });
            return;
        }

        const cargoRes = await client.query(
            `
            SELECT sc.credits, ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `,
            [playerId],
        );
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.shields + qty > config.maxShields) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Exceeds maximum' });
            return;
        }

        const cost = qty * 10;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        await client.query('UPDATE player_ships SET shields = shields + $1 WHERE player_id = $2', [
            qty,
            playerId,
        ]);
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [
            cost,
            playerId,
        ]);
        await client.query('COMMIT');

        send(ws, {
            type: ServerMsgType.BuyResult,
            credits: data.credits - cost,
            fighters: data.fighters,
            shields: data.shields + qty,
            cargoLimit: data.cargo_limit,
        });
    } catch {
        await client.query('ROLLBACK');
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

/**
 * Purchases additional cargo holds at a class 0 port. Cost: 50 credits each.
 * @param quantity - Number of cargo holds to buy
 */
export async function handleBuyHolds(
    ws: WebSocket,
    playerId: number,
    quantity: number,
): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid quantity' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [
            playerId,
        ]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query('SELECT class FROM ports WHERE sector_id = $1', [
            currentSector,
        ]);
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Not at a class 0 port' });
            return;
        }

        const cargoRes = await client.query(
            `
            SELECT sc.credits, ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `,
            [playerId],
        );
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.cargo_limit + qty > config.maxHolds) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Exceeds maximum' });
            return;
        }

        const cost = qty * 50;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        await client.query(
            'UPDATE player_ships SET cargo_limit = cargo_limit + $1 WHERE player_id = $2',
            [qty, playerId],
        );
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [
            cost,
            playerId,
        ]);
        await client.query('COMMIT');

        send(ws, {
            type: ServerMsgType.BuyResult,
            credits: data.credits - cost,
            fighters: data.fighters,
            shields: data.shields,
            cargoLimit: data.cargo_limit + qty,
        });
    } catch {
        await client.query('ROLLBACK');
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

/**
 * Exchanges the player's current ship for a different one at Stardock.
 * The price difference is charged (or refunded). Fighters and shields reset to 0.
 * Fails if the new ship can't hold current cargo.
 * @param targetShipName - Name of the ship to switch to
 */
export async function handleShipExchange(
    ws: WebSocket,
    playerId: number,
    targetShipName: string,
): Promise<void> {
    const targetConfig = shipConfigs[targetShipName];
    if (!targetConfig) {
        send(ws, { type: ServerMsgType.Error, message: 'Unknown ship' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query(
            `
            SELECT p.current_sector, s.name as sector_name
            FROM players p
            JOIN sectors s ON p.current_sector = s.id
            WHERE p.id = $1
        `,
            [playerId],
        );

        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }
        if (pRes.rows[0].sector_name !== 'Stardock') {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Not at Stardock' });
            return;
        }

        const cargoRes = await client.query(
            `
            SELECT sc.credits, sc.fuel, sc.organics, sc.equipment, ps.ship_name
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `,
            [playerId],
        );

        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Player not found' });
            return;
        }

        const data = cargoRes.rows[0];
        if (data.ship_name === targetShipName) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Already on that ship' });
            return;
        }

        const currentConfig = shipConfigs[data.ship_name];
        const cost = targetConfig.price - currentConfig.price;
        if (cost > 0 && data.credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Insufficient credits' });
            return;
        }

        const newCargoLimit = targetConfig.startingHolds;
        const currentCargo = data.fuel + data.organics + data.equipment;
        if (newCargoLimit < currentCargo) {
            await client.query('ROLLBACK');
            send(ws, {
                type: ServerMsgType.Error,
                message: 'New ship has insufficient holds for current cargo',
            });
            return;
        }

        await client.query(
            `
            UPDATE player_ships
            SET ship_name = $1, fighters = 0, shields = 0, cargo_limit = $2
            WHERE player_id = $3
        `,
            [targetShipName, newCargoLimit, playerId],
        );

        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [
            cost,
            playerId,
        ]);
        await client.query('COMMIT');

        send(ws, {
            type: ServerMsgType.ShipExchangeResult,
            shipName: targetShipName,
            credits: data.credits - cost,
            maxFighters: targetConfig.maxFighters,
            maxShields: targetConfig.maxShields,
            cargoLimit: newCargoLimit,
        });
    } catch {
        await client.query('ROLLBACK');
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

/**
 * Connects to the database, validates the universe data, and starts the HTTP/WebSocket server on port 3000.
 * @throws Exits the process with code 1 if startup fails
 */
async function handleAttack(
    ws: WebSocket,
    attackerId: number,
    targetPlayerId: number,
    fighters: number,
): Promise<void> {
    if (!Number.isInteger(fighters) || fighters <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid number of fighters' });
        return;
    }

    if (attackerId === targetPlayerId) {
        send(ws, { type: ServerMsgType.Error, message: 'You cannot attack yourself' });
        return;
    }

    const attacker = players[attackerId];
    const target = players[targetPlayerId];

    if (!attacker || !target || attacker.sector !== target.sector) {
        send(ws, { type: ServerMsgType.Error, message: 'Target is not in this sector' });
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const attackerShipRes = await client.query(
            'SELECT fighters FROM player_ships WHERE player_id = $1 FOR UPDATE',
            [attackerId],
        );
        const targetShipRes = await client.query(
            'SELECT fighters, shields FROM player_ships WHERE player_id = $1 FOR UPDATE',
            [targetPlayerId],
        );

        if (attackerShipRes.rows.length === 0 || targetShipRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Ship not found' });
            return;
        }

        const attackerFighters = attackerShipRes.rows[0].fighters;
        let targetShields = targetShipRes.rows[0].shields;
        let targetFighters = targetShipRes.rows[0].fighters;

        if (fighters > attackerFighters) {
            await client.query('ROLLBACK');
            send(ws, { type: ServerMsgType.Error, message: 'Not enough fighters' });
            return;
        }

        let remainingAttack = fighters;
        let shieldsLost = 0;
        let defenderFightersLost = 0;

        // Shields absorb first at 1:1
        const shieldAbsorb = Math.min(targetShields, remainingAttack);
        shieldsLost = shieldAbsorb;
        targetShields -= shieldAbsorb;
        remainingAttack -= shieldAbsorb;

        // Then fighters at 1:1 (mutual destruction)
        if (remainingAttack > 0) {
            const fighterAbsorb = Math.min(targetFighters, remainingAttack);
            defenderFightersLost = fighterAbsorb;
            targetFighters -= fighterAbsorb;
            remainingAttack -= fighterAbsorb;
        }

        const destroyed = remainingAttack > 0;
        const attackerFightersLost = shieldsLost + defenderFightersLost;
        const newAttackerFighters = attackerFighters - attackerFightersLost;

        await client.query('UPDATE player_ships SET fighters = $1 WHERE player_id = $2', [
            newAttackerFighters,
            attackerId,
        ]);

        if (destroyed) {
            await client.query('UPDATE players SET ship_destroyed_date = NOW() WHERE id = $1', [
                targetPlayerId,
            ]);
            await client.query('DELETE FROM player_ships WHERE player_id = $1', [targetPlayerId]);
            await client.query('DELETE FROM ship_cargo WHERE player_id = $1', [targetPlayerId]);
        } else {
            await client.query(
                'UPDATE player_ships SET fighters = $1, shields = $2 WHERE player_id = $3',
                [targetFighters, targetShields, targetPlayerId],
            );
        }

        await client.query('COMMIT');

        const resultMsg: ServerMessage = {
            type: ServerMsgType.AttackResult,
            destroyed,
            attackerFightersLost,
            defenderFightersLost,
            defenderShieldsLost: shieldsLost,
            message: destroyed ? 'Target destroyed!' : 'Attack completed.',
        };
        send(ws, resultMsg);

        if (target.ws && target.ws.readyState === 1) {
            send(target.ws, {
                type: ServerMsgType.AttackResult,
                destroyed,
                attackerFightersLost,
                defenderFightersLost,
                defenderShieldsLost: shieldsLost,
                message: destroyed ? 'Your ship was destroyed!' : 'You were attacked!',
            });
            if (destroyed) {
                target.ws.close(1008, 'Ship destroyed');
            }
        }
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('Attack error', e);
        send(ws, { type: ServerMsgType.Error, message: 'Internal server error' });
    } finally {
        client.release();
    }
}

export async function startServer() {
    try {
        await connectDB();
        await getGraph();

        server.listen(3000, () => {
            console.log('Server listening on port 3000');
        });
    } catch (error) {
        console.error('Error during server startup:', error);
        process.exit(1);
    }
}

// Only start the server if this file is run directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
    startServer();
}

export { app, server, wss };

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
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname !== '/ws') {
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

        // Require universe parameter
        const universeParam = url.searchParams.get('universe');
        if (!universeParam) {
            auth.rejectWebSocketUpgrade(socket);
            return;
        }
    } catch {
        auth.rejectWebSocketUpgrade(socket);
    }
});

interface Player {
    ws: WebSocket;
    sector: number;
    name: string;
    universeId: number;
    docked: boolean;
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

function portClassName(portClass: number): string {
    const actions = PORT_CLASS_ACTIONS[portClass];
    if (!actions) {
        if (portClass === 0) return 'Special';
        if (portClass === 9) return 'Special';
        return 'Unknown';
    }
    return Object.values(actions).map(a => a === 'B' ? 'B' : 'S').join('');
}

function portName(sectorId: number): string {
    return `Port ${sectorId}`;
}

async function getVisitedSectors(playerId: number): Promise<number[]> {
    const res = await pool.query('SELECT sector_id FROM visited_sectors WHERE player_id = $1', [playerId]);
    return res.rows.map((r: any) => r.sector_id);
}

async function getPortForSector(sectorId: number, universeId: number): Promise<{ class: number; name: string } | null> {
    const res = await pool.query(
        'SELECT class FROM ports WHERE sector_id = $1 AND universe_id = $2',
        [sectorId, universeId],
    );
    if (res.rows.length === 0) return null;
    return { class: res.rows[0].class, name: portName(sectorId) };
}

/**
 * Builds the sector warp adjacency list for a specific universe.
 */
export async function getGraph(universeId: number): Promise<number[][]> {
    const sectorsRes = await pool.query(
        'SELECT id FROM sectors WHERE universe_id = $1 ORDER BY id ASC',
        [universeId],
    );
    const size = sectorsRes.rows.length;

    if (size === 0) {
        return [];
    }

    const maxId = sectorsRes.rows[size - 1].id;
    let adjacencyList: number[][] = [];
    for (let i = 0; i <= maxId; i++) {
        adjacencyList[i] = [];
    }

    const warpsRes = await pool.query(
        'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1',
        [universeId],
    );
    for (const row of warpsRes.rows) {
        if (adjacencyList[row.sector_from]) {
            adjacencyList[row.sector_from].push(row.sector_to);
        }
    }

    return adjacencyList;
}

function broadcastTo(data: ServerMessage, targetClients: Set<WebSocket> | WebSocket[]) {
    for (const client of targetClients) {
        if (client.readyState === 1) {
            client.send(JSON.stringify(data));
        }
    }
}

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

    const userId = authPayload.userId;

    // Parse universe from query string
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const universeParam = url.searchParams.get('universe');
    if (!universeParam) {
        ws.close(1008, 'Universe parameter required');
        return;
    }
    const universeId = parseInt(universeParam, 10);
    if (isNaN(universeId)) {
        ws.close(1008, 'Invalid universe parameter');
        return;
    }

    try {
        // Look up user's token version
        const userRes = await pool.query('SELECT token_version FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
            ws.close(1008, 'User not found');
            return;
        }
        if (userRes.rows[0].token_version !== authPayload.tokenVersion) {
            ws.close(1008, 'Token has been revoked');
            return;
        }

        // Look up player for this user in this universe
        const playerRes = await pool.query(
            'SELECT id, name, current_sector FROM players WHERE user_id = $1 AND universe_id = $2',
            [userId, universeId],
        );
        if (playerRes.rows.length === 0) {
            ws.close(1008, 'No player in this universe');
            return;
        }
        const playerRow = playerRes.rows[0];
        const playerId = playerRow.id;
        const sector: number = playerRow.current_sector;

        // Undock on connect (in case of prior disconnect while docked)
        await pool.query('UPDATE players SET docked = FALSE WHERE id = $1', [playerId]);
        // Mark current sector as visited
        await pool.query(
            'INSERT INTO visited_sectors (player_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [playerId, sector],
        );
        players[playerId] = { ws, sector, name: playerRow.name, universeId, docked: false };
        const welcomeMsg: ServerMessage = {
            type: ServerMsgType.Welcome,
            playerId,
            name: playerRow.name,
            sector,
            token: auth.signPlayerToken({
                userId,
                name: playerRow.name,
                role: authPayload.role,
                tokenVersion: userRes.rows[0].token_version,
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
            const lastUniverse = players[playerId]?.universeId;
            delete players[playerId];

            if (lastSector && lastUniverse) {
                const clientsToNotify = new Set<WebSocket>();
                for (const p of Object.values(players)) {
                    if (p.sector === lastSector && p.universeId === lastUniverse) {
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

export async function handleMessage(ws: WebSocket, playerId: number, data: any): Promise<void> {
    switch (data.type) {
        case ClientMsgType.Move:
            return handleMove(ws, playerId, data.sector);
        case ClientMsgType.SectorDisplay:
            return handleSectorDisplay(ws, playerId);
        case ClientMsgType.Who:
            return handleWho(ws);
        case ClientMsgType.SectorWarps:
            return handleSectorWarps(ws, playerId, data.id);
        case ClientMsgType.Path:
            return handlePath(ws, playerId, data.from, data.to);
        case ClientMsgType.PortInfo:
            return handlePortInfo(ws, playerId, data.sectorId);
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
        case ClientMsgType.Dock:
            return handleDock(ws, playerId);
        case ClientMsgType.Undock:
            return handleUndock(ws, playerId);
        default:
            send(ws, { type: ServerMsgType.Error, message: 'Unknown message type' });
    }
}

function getPlayerUniverseId(playerId: number): number | undefined {
    return players[playerId]?.universeId;
}

function handleWho(ws: WebSocket): void {
    const playersKeys = Object.keys(players).map(Number);
    send(ws, { type: ServerMsgType.PlayersOnline, players: playersKeys });
}

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

    const universeId = player.universeId;
    const warps = await getGraph(universeId);
    const currentSector = player.sector;

    if (!warps[currentSector]?.includes(targetSector)) {
        send(ws, { type: ServerMsgType.NonAdjacentMoveRequested, playerId, sector: targetSector });
        return;
    }

    // Undock if docked
    if (player.docked) {
        player.docked = false;
        await pool.query('UPDATE players SET docked = FALSE WHERE id = $1', [playerId]);
    }

    player.sector = targetSector;
    await Promise.all([
        pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [targetSector, playerId]),
        pool.query('INSERT INTO visited_sectors (player_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [playerId, targetSector]),
    ]);

    const oldSectorClients = new Set<WebSocket>();
    const newSectorClients = new Set<WebSocket>();
    for (const [idStr, p] of Object.entries(players)) {
        if (Number(idStr) === playerId) continue;
        if (p.universeId !== universeId) continue;
        if (p.docked) continue;
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

    const [port, visitedSectors] = await Promise.all([
        getPortForSector(targetSector, universeId),
        getVisitedSectors(playerId),
    ]);
    const displayWarps = warps[targetSector] || [];
    const playersInSector = Object.entries(players)
        .filter(([id, p]) => p.sector === targetSector && p.universeId === universeId && !p.docked && Number(id) !== playerId)
        .map(([id, p]) => ({ id: Number(id), name: p.name }));
    send(ws, {
        type: ServerMsgType.SectorDisplay,
        sector: targetSector,
        warps: displayWarps,
        players: playersInSector,
        port,
        visitedSectors,
    });
}

export async function handleSectorDisplay(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const currentSector = player.sector;
    const universeId = player.universeId;

    const [warps, port, visitedSectors] = await Promise.all([
        getGraph(universeId),
        getPortForSector(currentSector, universeId),
        getVisitedSectors(playerId),
    ]);
    const displayWarps = warps[currentSector] || [];
    const playersInSector = Object.entries(players)
        .filter(([id, p]) => p.sector === currentSector && p.universeId === universeId && !p.docked && Number(id) !== playerId)
        .map(([id, p]) => ({ id: Number(id), name: p.name }));
    send(ws, {
        type: ServerMsgType.SectorDisplay,
        sector: currentSector,
        warps: displayWarps,
        players: playersInSector,
        port,
        visitedSectors,
    });
}

export async function handleSectorWarps(
    ws: WebSocket,
    playerId: number,
    id: number,
): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const sectorRes = await pool.query(
        'SELECT id FROM sectors WHERE id = $1 AND universe_id = $2',
        [id, universeId],
    );
    if (sectorRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Sector not found' });
        return;
    }

    const warpsRes = await pool.query(
        'SELECT sector_to FROM warps WHERE sector_from = $1 AND universe_id = $2',
        [id, universeId],
    );
    const warps = warpsRes.rows.map((r) => r.sector_to);
    send(ws, { type: ServerMsgType.SectorWarps, id, warps });
}

export async function handlePath(
    ws: WebSocket,
    playerId: number,
    from: number,
    to: number,
): Promise<void> {
    if (!Number.isInteger(from) || from <= 0 || !Number.isInteger(to) || to <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const sectorRes = await pool.query(
        'SELECT id FROM sectors WHERE id IN ($1, $2) AND universe_id = $3',
        [from, to, universeId],
    );
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

    const warps = await getGraph(universeId);
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

export async function handlePortInfo(
    ws: WebSocket,
    playerId: number,
    sectorId: number,
): Promise<void> {
    if (!Number.isInteger(sectorId) || sectorId <= 0) {
        send(ws, { type: ServerMsgType.Error, message: 'Invalid sector ID' });
        return;
    }

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const portRes = await pool.query(
        'SELECT sector_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1 AND universe_id = $2',
        [sectorId, universeId],
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
    const universeId = player.universeId;

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
            'SELECT class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1 AND universe_id = $2 FOR UPDATE',
            [currentSector, universeId],
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

            await client.query(
                `UPDATE ports SET ${col} = ${col} - $1 WHERE sector_id = $2 AND universe_id = $3`,
                [qty, currentSector, universeId],
            );
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

            await client.query(
                `UPDATE ports SET ${col} = ${col} + $1 WHERE sector_id = $2 AND universe_id = $3`,
                [qty, currentSector, universeId],
            );
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

export async function handleDock(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (player.docked) {
        send(ws, { type: ServerMsgType.Error, message: 'Already docked' });
        return;
    }

    const portRes = await pool.query(
        'SELECT class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1 AND universe_id = $2',
        [player.sector, player.universeId],
    );
    if (portRes.rows.length === 0) {
        send(ws, { type: ServerMsgType.Error, message: 'No port in this sector' });
        return;
    }

    player.docked = true;
    await pool.query('UPDATE players SET docked = TRUE WHERE id = $1', [playerId]);

    const p = portRes.rows[0];
    send(ws, {
        type: ServerMsgType.DockResult,
        docked: true,
        port: {
            type: ServerMsgType.PortInfo,
            sectorId: player.sector,
            class: p.class,
            fuel: p.fuel,
            fuelPrice: p.fuel_price,
            organics: p.organics,
            orgPrice: p.org_price,
            equipment: p.equipment,
            equPrice: p.equ_price,
        },
    });
}

export async function handleUndock(ws: WebSocket, playerId: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;

    if (!player.docked) {
        send(ws, { type: ServerMsgType.Error, message: 'Not docked' });
        return;
    }

    player.docked = false;
    await pool.query('UPDATE players SET docked = FALSE WHERE id = $1', [playerId]);

    send(ws, { type: ServerMsgType.DockResult, docked: false });
}

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

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

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
            'SELECT class FROM ports WHERE sector_id = $1 AND universe_id = $2',
            [currentSector, universeId],
        );
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

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

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
            'SELECT class FROM ports WHERE sector_id = $1 AND universe_id = $2',
            [currentSector, universeId],
        );
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

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

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
            'SELECT class FROM ports WHERE sector_id = $1 AND universe_id = $2',
            [currentSector, universeId],
        );
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

    const universeId = getPlayerUniverseId(playerId);
    if (universeId === undefined) return;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query(
            `
            SELECT p.current_sector, s.name as sector_name
            FROM players p
            JOIN sectors s ON p.current_sector = s.id AND p.universe_id = s.universe_id
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

    if (
        !attacker ||
        !target ||
        attacker.sector !== target.sector ||
        attacker.universeId !== target.universeId
    ) {
        send(ws, { type: ServerMsgType.Error, message: 'Target is not in this sector' });
        return;
    }

    if (target.docked) {
        send(ws, { type: ServerMsgType.Error, message: 'Target is docked at a port' });
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

        const shieldAbsorb = Math.min(targetShields, remainingAttack);
        shieldsLost = shieldAbsorb;
        targetShields -= shieldAbsorb;
        remainingAttack -= shieldAbsorb;

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

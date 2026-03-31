import { WebSocket, WebSocketServer } from 'ws';
import { connectDB, pool } from './db.js';
import express, { Request, Response } from 'express';
import { createServer, Server, IncomingMessage } from 'http';
import { Socket } from 'net';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import { createRoutes } from './routes.js';
import type { AuthTokenPayload, ServerMessage } from '@twnr/shared';

/**
 * Retrieves a required environment variable or throws if missing.
 * @param name - The environment variable name
 * @returns The environment variable value
 * @throws {Error} If the variable is not set
 */
function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} environment variable is required`);
    }

    return value;
}

const JWT_SECRET = requireEnv('JWT_SECRET');
const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
const AUTH_COOKIE_NAME = 'twnr_auth';
const CONFIGURED_WS_ALLOWED_ORIGINS = (process.env.WS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

/**
 * Hashes a password using scrypt with a random 16-byte salt.
 * Output format: `scrypt$<base64url-salt>$<base64url-derived-key>`
 * @param password - The plaintext password to hash
 * @returns The formatted hash string
 */
function hashPassword(password: string): string {
    const salt = crypto.randomBytes(16);
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

/**
 * Verifies a plaintext password against a stored scrypt hash using constant-time comparison.
 * @param password - The plaintext password to verify
 * @param storedHash - The stored hash in `scrypt$salt$key` format, or null
 * @returns `true` if the password matches
 */
function verifyPassword(password: string, storedHash: string | null): boolean {
    if (!storedHash || !storedHash.startsWith('scrypt$')) {
        return false;
    }

    const parts = storedHash.split('$');
    if (parts.length !== 3) {
        return false;
    }

    const salt = Buffer.from(parts[1], 'base64url');
    const expected = Buffer.from(parts[2], 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length);

    return crypto.timingSafeEqual(actual, expected);
}

/**
 * Signs a JWT for a player with HS256 and a 7-day expiry.
 * @param payload - The token payload containing player identity and role
 * @returns The signed JWT string
 */
function signPlayerToken(payload: AuthTokenPayload): string {
    return jwt.sign(payload, JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: '7d',
    });
}

/**
 * Verifies and decodes a JWT, validating its structure and payload fields.
 * @param token - The JWT string to verify
 * @returns The decoded auth payload
 * @throws {Error} If the token is invalid, expired, or has malformed payload
 */
function verifyToken(token: string): AuthTokenPayload {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });

    if (!payload || typeof payload !== 'object') {
        throw new Error('Invalid token payload');
    }

    const playerId = Number((payload as jwt.JwtPayload).playerId);
    if (!Number.isInteger(playerId) || playerId <= 0) {
        throw new Error('Invalid token payload');
    }

    const tokenVersion = (payload as jwt.JwtPayload).tokenVersion;
    if (typeof tokenVersion !== 'number') {
        throw new Error('Invalid token payload');
    }

    return {
        playerId,
        name:
            typeof (payload as jwt.JwtPayload).name === 'string'
                ? (payload as jwt.JwtPayload).name
                : undefined,
        role:
            typeof (payload as jwt.JwtPayload).role === 'string'
                ? (payload as jwt.JwtPayload).role
                : undefined,
        tokenVersion,
    };
}

/**
 * Parses a raw `Cookie` header string into a key-value map.
 * @param cookieHeader - The raw cookie header value
 * @returns An object mapping cookie names to their decoded values
 */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
    if (!cookieHeader) {
        return {};
    }

    const cookies: Record<string, string> = {};
    for (const part of cookieHeader.split(';')) {
        const [rawName, ...rawValue] = part.trim().split('=');
        if (!rawName || rawValue.length === 0) {
            continue;
        }

        try {
            cookies[rawName] = decodeURIComponent(rawValue.join('='));
        } catch {
            cookies[rawName] = rawValue.join('=');
        }
    }

    return cookies;
}

/**
 * Retrieves a single cookie value from a request.
 * @param req - The HTTP request (Express or raw Node)
 * @param name - The cookie name to look up
 * @returns The cookie value, or `null` if not present
 */
function getCookie(req: Request | IncomingMessage, name: string): string | null {
    const cookieHeader = req.headers.cookie;
    if (typeof cookieHeader !== 'string') {
        return null;
    }

    return parseCookies(cookieHeader)[name] || null;
}

/**
 * Sets the authentication JWT as an HttpOnly cookie on the response.
 * Secure flag is enabled in production. Cookie expires in 7 days.
 * @param res - The Express response object
 * @param token - The signed JWT to store
 */
function setAuthCookie(res: Response, token: string): void {
    res.cookie(AUTH_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production',
    });
}

/**
 * Returns the list of allowed WebSocket origins. Uses `WS_ALLOWED_ORIGINS` env var
 * if configured, otherwise derives allowed origins from the request's `Host` header.
 * @param req - The incoming HTTP upgrade request
 * @returns Array of allowed origin strings
 */
function getAllowedWebSocketOrigins(req: IncomingMessage): string[] {
    if (CONFIGURED_WS_ALLOWED_ORIGINS.length > 0) {
        return CONFIGURED_WS_ALLOWED_ORIGINS;
    }

    if (typeof req.headers.host !== 'string' || !req.headers.host) {
        return [];
    }

    return [`http://${req.headers.host}`, `https://${req.headers.host}`];
}

/**
 * Checks whether the WebSocket upgrade request's `Origin` header is allowed.
 * Requests with no origin header are permitted (non-browser clients).
 * @param req - The incoming HTTP upgrade request
 * @returns `true` if the origin is allowed or absent
 */
function isAllowedWebSocketOrigin(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || !origin) {
        return true;
    }

    return getAllowedWebSocketOrigins(req).includes(origin);
}

/**
 * Rejects a WebSocket upgrade by sending a 403 response and destroying the socket.
 * @param socket - The raw TCP socket from the upgrade request
 */
function rejectWebSocketUpgrade(socket: Socket): void {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
}

/**
 * Extracts a Bearer token from the `Authorization` header.
 * @param req - The Express request
 * @returns The token string, or `null` if not present or malformed
 */
function getBearerToken(req: Request): string | null {
    const auth = req.headers['authorization'];
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
        return null;
    }

    return auth.slice(7);
}

/**
 * Retrieves the JWT from either the `Authorization: Bearer` header or the auth cookie.
 * Bearer token takes precedence over the cookie.
 * @param req - The Express request
 * @returns The JWT string, or `null` if neither source has a token
 */
function getJwtToken(req: Request): string | null {
    return getBearerToken(req) || getCookie(req, AUTH_COOKIE_NAME);
}

/**
 * Retrieves the authenticated player payload attached by the authenticateToken middleware.
 * @param req - The Express request (with `.player` set by middleware)
 * @returns The authenticated player's token payload
 */
function getAuthenticatedPlayer(req: Request): AuthTokenPayload {
    return (req as any).player as AuthTokenPayload;
}

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
        rejectWebSocketUpgrade(socket);
        return;
    }
    if (!isAllowedWebSocketOrigin(req)) {
        rejectWebSocketUpgrade(socket);
        return;
    }
    const cookies = parseCookies(req.headers.cookie);
    const jwtToken = cookies[AUTH_COOKIE_NAME];
    if (!jwtToken) {
        rejectWebSocketUpgrade(socket);
        return;
    }
    try {
        verifyToken(jwtToken);
    } catch {
        rejectWebSocketUpgrade(socket);
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
        hashPassword,
        verifyPassword,
        signPlayerToken,
        verifyToken,
        setAuthCookie,
        getJwtToken,
        getAuthenticatedPlayer,
        shipConfigs,
        players,
        AUTH_COOKIE_NAME,
        ADMIN_API_KEY,
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
    const cookies = parseCookies(req.headers.cookie);
    let authPayload: AuthTokenPayload;
    try {
        authPayload = verifyToken(cookies[AUTH_COOKIE_NAME] || '');
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
            type: 'welcome',
            playerId,
            name: playerRow.name,
            sector,
            token: signPlayerToken({
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
                send(ws, { type: 'rateLimited' });
                return;
            }
            tokens--;

            let data: any;
            try {
                data = JSON.parse(message.toString());
            } catch {
                send(ws, { type: 'error', message: 'Invalid JSON' });
                return;
            }

            try {
                await handleMessage(ws, playerId, data);
            } catch (err) {
                console.error('Message handler error:', err);
                send(ws, { type: 'error', message: 'Internal server error' });
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
                broadcastTo({ type: 'playerLeft', playerId }, clientsToNotify);
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
async function handleMessage(ws: WebSocket, playerId: number, data: any): Promise<void> {
    switch (data.type) {
        case 'move':
            return handleMove(ws, playerId, data.sector);
        case 'display':
            return handleDisplay(ws, playerId);
        case 'who':
            return handleWho(ws);
        case 'sector':
            return handleSector(ws, data.id);
        case 'route':
            return handleRoute(ws, data.from, data.to);
        case 'port':
            return handlePort(ws, data.sectorId);
        case 'ship':
            return handleShip(ws, playerId);
        case 'cargo':
            return handleCargo(ws, playerId);
        case 'trade':
            return handleTrade(ws, playerId, data.good, data.quantity, data.action);
        case 'buyFighters':
            return handleBuyFighters(ws, playerId, data.quantity);
        case 'buyShields':
            return handleBuyShields(ws, playerId, data.quantity);
        case 'buyHolds':
            return handleBuyHolds(ws, playerId, data.quantity);
        case 'shipExchange':
            return handleShipExchange(ws, playerId, data.targetShipName);
        default:
            send(ws, { type: 'error', message: 'Unknown message type' });
    }
}

/**
 * Handles a player movement request to an adjacent sector.
 * Validates the player has a ship and the target sector is adjacent,
 * then broadcasts movement events to players in both sectors.
 */
async function handleMove(ws: WebSocket, playerId: number, targetSector: number): Promise<void> {
    if (!Number.isInteger(targetSector) || targetSector <= 0) {
        send(ws, { type: 'error', message: 'Invalid sector' });
        return;
    }

    const shipRes = await pool.query('SELECT player_id FROM player_ships WHERE player_id = $1', [
        playerId,
    ]);
    if (shipRes.rows.length === 0) {
        send(ws, { type: 'noShip' });
        return;
    }

    const player = players[playerId];
    if (!player) return;

    const warps = await getGraph();
    const currentSector = player.sector;

    if (!warps[currentSector] || !warps[currentSector].includes(targetSector)) {
        send(ws, { type: 'nonAdjacentMoveRequested', playerId, sector: targetSector });
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
        { type: 'playerMoved', playerId, sector: targetSector, direction: 'out' },
        oldSectorClients,
    );
    broadcastTo(
        { type: 'playerMoved', playerId, sector: targetSector, direction: 'in' },
        newSectorClients,
    );

    const displayWarps = warps[targetSector] || [];
    const playersInSector = Object.entries(players)
        .filter(([, p]) => p.sector === targetSector)
        .map(([id]) => Number(id));
    send(ws, {
        type: 'sectorDisplay',
        sector: targetSector,
        warps: displayWarps,
        players: playersInSector,
    });
}

/**
 * Sends the player their current sector's display info (warps and players present).
 */
async function handleDisplay(ws: WebSocket, playerId: number): Promise<void> {
    const currentSector = players[playerId]?.sector;
    if (currentSector === undefined) return;

    const warps = await getGraph();
    const displayWarps = warps[currentSector] || [];
    const playersInSector = Object.entries(players)
        .filter(([, p]) => p.sector === currentSector)
        .map(([id]) => Number(id));
    send(ws, {
        type: 'sectorDisplay',
        sector: currentSector,
        warps: displayWarps,
        players: playersInSector,
    });
}

/**
 * Sends a list of all currently connected player IDs.
 */
function handleWho(ws: WebSocket): void {
    const playersKeys = Object.keys(players).map(Number);
    send(ws, { type: 'playersOnline', players: playersKeys });
}

/**
 * Returns a sector's outbound warp connections.
 * @param id - The sector ID to look up
 */
async function handleSector(ws: WebSocket, id: number): Promise<void> {
    if (!Number.isInteger(id) || id <= 0) {
        send(ws, { type: 'error', message: 'Invalid sector ID' });
        return;
    }

    const sectorRes = await pool.query('SELECT id FROM sectors WHERE id = $1', [id]);
    if (sectorRes.rows.length === 0) {
        send(ws, { type: 'error', message: 'Sector not found' });
        return;
    }

    const warpsRes = await pool.query('SELECT sector_to FROM warps WHERE sector_from = $1', [id]);
    const warps = warpsRes.rows.map((r) => r.sector_to);
    send(ws, { type: 'sectorInfo', id, warps });
}

/**
 * Finds the shortest path between two sectors using BFS.
 * @param from - Origin sector ID
 * @param to - Destination sector ID
 */
async function handleRoute(ws: WebSocket, from: number, to: number): Promise<void> {
    if (!Number.isInteger(from) || from <= 0 || !Number.isInteger(to) || to <= 0) {
        send(ws, { type: 'error', message: 'Invalid sector ID' });
        return;
    }

    const sectorRes = await pool.query('SELECT id FROM sectors WHERE id IN ($1, $2)', [from, to]);
    if (sectorRes.rows.length !== (from === to ? 1 : 2)) {
        const foundIds = new Set(sectorRes.rows.map((r: any) => r.id));
        if (!foundIds.has(from) || !foundIds.has(to)) {
            send(ws, { type: 'error', message: 'Sector not found' });
            return;
        }
    }

    if (from === to) {
        send(ws, { type: 'routeResult', path: [from], hops: 0 });
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
                send(ws, { type: 'routeResult', path: finalPath, hops: finalPath.length - 1 });
                return;
            }
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push({ sector: neighbor, path: [...path, neighbor] });
            }
        }
    }

    send(ws, { type: 'error', message: 'No route found' });
}

/**
 * Returns port details for a sector, including class, inventory, and prices.
 * @param sectorId - The sector ID to look up
 */
async function handlePort(ws: WebSocket, sectorId: number): Promise<void> {
    if (!Number.isInteger(sectorId) || sectorId <= 0) {
        send(ws, { type: 'error', message: 'Invalid sector ID' });
        return;
    }

    const portRes = await pool.query(
        'SELECT sector_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1',
        [sectorId],
    );
    if (portRes.rows.length === 0) {
        send(ws, { type: 'error', message: 'No port in this sector' });
        return;
    }

    const p = portRes.rows[0];
    send(ws, {
        type: 'portInfo',
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
async function handleShip(ws: WebSocket, playerId: number): Promise<void> {
    const query = `
        SELECT ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit,
               sc.fuel, sc.organics, sc.equipment
        FROM player_ships ps
        JOIN ship_cargo sc ON ps.player_id = sc.player_id
        WHERE ps.player_id = $1
    `;
    const result = await pool.query(query, [playerId]);
    if (result.rows.length === 0) {
        send(ws, { type: 'error', message: 'Ship not found' });
        return;
    }

    const row = result.rows[0];
    const config = shipConfigs[row.ship_name];
    if (!config) {
        send(ws, { type: 'error', message: 'Ship config missing' });
        return;
    }

    const holdsAvailable = row.cargo_limit - (row.fuel + row.organics + row.equipment);
    send(ws, {
        type: 'shipInfo',
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
async function handleCargo(ws: WebSocket, playerId: number): Promise<void> {
    const cargoRes = await pool.query(
        'SELECT player_id, fuel, organics, equipment, credits FROM ship_cargo WHERE player_id = $1',
        [playerId],
    );
    if (cargoRes.rows.length === 0) {
        send(ws, { type: 'error', message: 'Player not found' });
        return;
    }

    const c = cargoRes.rows[0];
    send(ws, {
        type: 'cargoInfo',
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
async function handleTrade(
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
        send(ws, { type: 'error', message: 'Invalid good' });
        return;
    }

    if (!['buy', 'sell'].includes(action)) {
        send(ws, { type: 'error', message: 'Invalid action' });
        return;
    }

    const qty = Number.isInteger(quantity) ? quantity : parseInt(String(quantity), 10);
    if (isNaN(qty) || qty <= 0) {
        send(ws, { type: 'error', message: 'Invalid quantity' });
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
            send(ws, { type: 'error', message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query(
            'SELECT class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1 FOR UPDATE',
            [currentSector],
        );
        if (portRes.rows.length === 0) {
            await client.query('ROLLBACK');
            send(ws, { type: 'error', message: 'No port in this sector' });
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
            send(ws, { type: 'error', message: 'Port does not trade this commodity' });
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
            send(ws, { type: 'error', message: 'Player not found' });
            return;
        }

        const cargo = cargoRes.rows[0];

        if (action === 'buy') {
            const cost = qty * price;
            if (cargo.credits < cost) {
                await client.query('ROLLBACK');
                send(ws, { type: 'error', message: 'Insufficient credits' });
                return;
            }
            if (port[good] < qty) {
                await client.query('ROLLBACK');
                send(ws, { type: 'error', message: 'Insufficient port inventory' });
                return;
            }
            if (cargo.fuel + cargo.organics + cargo.equipment + qty > cargo.cargo_limit) {
                await client.query('ROLLBACK');
                send(ws, { type: 'error', message: 'Insufficient cargo holds' });
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
                type: 'tradeResult',
                credits: cargo.credits,
                cargo: { fuel: cargo.fuel, organics: cargo.organics, equipment: cargo.equipment },
            });
        } else {
            const revenue = qty * price;
            if (cargo[good] < qty) {
                await client.query('ROLLBACK');
                send(ws, { type: 'error', message: 'Insufficient cargo' });
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
                type: 'tradeResult',
                credits: cargo.credits,
                cargo: { fuel: cargo.fuel, organics: cargo.organics, equipment: cargo.equipment },
            });
        }
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Trade error', err);
        send(ws, { type: 'error', message: 'Internal server error' });
    } finally {
        client.release();
    }
}

/**
 * Purchases fighters at a class 0 port. Cost: 20 credits each.
 * @param quantity - Number of fighters to buy
 */
async function handleBuyFighters(ws: WebSocket, playerId: number, quantity: number): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        send(ws, { type: 'error', message: 'Invalid quantity' });
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
            send(ws, { type: 'error', message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query('SELECT class FROM ports WHERE sector_id = $1', [
            currentSector,
        ]);
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            send(ws, { type: 'error', message: 'Not at a class 0 port' });
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
            send(ws, { type: 'error', message: 'Player not found' });
            return;
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.fighters + qty > config.maxFighters) {
            await client.query('ROLLBACK');
            send(ws, { type: 'error', message: 'Exceeds maximum' });
            return;
        }

        const cost = qty * 20;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: 'error', message: 'Insufficient credits' });
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
            type: 'buyResult',
            credits: data.credits - cost,
            fighters: data.fighters + qty,
            shields: data.shields,
            cargoLimit: data.cargo_limit,
        });
    } catch {
        await client.query('ROLLBACK');
        send(ws, { type: 'error', message: 'Internal server error' });
    } finally {
        client.release();
    }
}

/**
 * Purchases shields at a class 0 port. Cost: 10 credits each.
 * @param quantity - Number of shields to buy
 */
async function handleBuyShields(ws: WebSocket, playerId: number, quantity: number): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        send(ws, { type: 'error', message: 'Invalid quantity' });
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
            send(ws, { type: 'error', message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query('SELECT class FROM ports WHERE sector_id = $1', [
            currentSector,
        ]);
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            send(ws, { type: 'error', message: 'Not at a class 0 port' });
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
            send(ws, { type: 'error', message: 'Player not found' });
            return;
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.shields + qty > config.maxShields) {
            await client.query('ROLLBACK');
            send(ws, { type: 'error', message: 'Exceeds maximum' });
            return;
        }

        const cost = qty * 10;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: 'error', message: 'Insufficient credits' });
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
            type: 'buyResult',
            credits: data.credits - cost,
            fighters: data.fighters,
            shields: data.shields + qty,
            cargoLimit: data.cargo_limit,
        });
    } catch {
        await client.query('ROLLBACK');
        send(ws, { type: 'error', message: 'Internal server error' });
    } finally {
        client.release();
    }
}

/**
 * Purchases additional cargo holds at a class 0 port. Cost: 50 credits each.
 * @param quantity - Number of cargo holds to buy
 */
async function handleBuyHolds(ws: WebSocket, playerId: number, quantity: number): Promise<void> {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
        send(ws, { type: 'error', message: 'Invalid quantity' });
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
            send(ws, { type: 'error', message: 'Player not found' });
            return;
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query('SELECT class FROM ports WHERE sector_id = $1', [
            currentSector,
        ]);
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            send(ws, { type: 'error', message: 'Not at a class 0 port' });
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
            send(ws, { type: 'error', message: 'Player not found' });
            return;
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.cargo_limit + qty > config.maxHolds) {
            await client.query('ROLLBACK');
            send(ws, { type: 'error', message: 'Exceeds maximum' });
            return;
        }

        const cost = qty * 50;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: 'error', message: 'Insufficient credits' });
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
            type: 'buyResult',
            credits: data.credits - cost,
            fighters: data.fighters,
            shields: data.shields,
            cargoLimit: data.cargo_limit + qty,
        });
    } catch {
        await client.query('ROLLBACK');
        send(ws, { type: 'error', message: 'Internal server error' });
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
async function handleShipExchange(
    ws: WebSocket,
    playerId: number,
    targetShipName: string,
): Promise<void> {
    const targetConfig = shipConfigs[targetShipName];
    if (!targetConfig) {
        send(ws, { type: 'error', message: 'Unknown ship' });
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
            send(ws, { type: 'error', message: 'Player not found' });
            return;
        }
        if (pRes.rows[0].sector_name !== 'Stardock') {
            await client.query('ROLLBACK');
            send(ws, { type: 'error', message: 'Not at Stardock' });
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
            send(ws, { type: 'error', message: 'Player not found' });
            return;
        }

        const data = cargoRes.rows[0];
        if (data.ship_name === targetShipName) {
            await client.query('ROLLBACK');
            send(ws, { type: 'error', message: 'Already on that ship' });
            return;
        }

        const currentConfig = shipConfigs[data.ship_name];
        const cost = targetConfig.price - currentConfig.price;
        if (cost > 0 && data.credits < cost) {
            await client.query('ROLLBACK');
            send(ws, { type: 'error', message: 'Insufficient credits' });
            return;
        }

        const newCargoLimit = targetConfig.startingHolds;
        const currentCargo = data.fuel + data.organics + data.equipment;
        if (newCargoLimit < currentCargo) {
            await client.query('ROLLBACK');
            send(ws, {
                type: 'error',
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
            type: 'shipExchangeResult',
            shipName: targetShipName,
            credits: data.credits - cost,
            maxFighters: targetConfig.maxFighters,
            maxShields: targetConfig.maxShields,
            cargoLimit: newCargoLimit,
        });
    } catch {
        await client.query('ROLLBACK');
        send(ws, { type: 'error', message: 'Internal server error' });
    } finally {
        client.release();
    }
}

/**
 * Connects to the database, validates the universe data, and starts the HTTP/WebSocket server on port 3000.
 * @throws Exits the process with code 1 if startup fails
 */
async function startServer() {
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

export { app, server, wss, startServer };

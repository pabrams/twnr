import { WebSocket, WebSocketServer } from 'ws';
import { connectDB, pool } from './db.js';
import express, { Request, Response, NextFunction } from 'express';
import { createServer, Server, IncomingMessage } from 'http';
import { Socket } from 'net';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type {
  AuthTokenPayload,
  SectorResponse,
  PlayersOnlineResponse,
  RouteResponse,
  PortResponse,
  ShipResponse,
  CargoResponse,
  TradeResponse,
  BuyResponse,
  MoveResponse,
  ShipExchangeResponse,
  AuthResponse,
  LogoutResponse,
  ServerStatsResponse,
  ServerMessage,
} from '@twnr/shared';

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
const WS_SESSION_COOKIE_NAME = 'twnr_session';
const CONFIGURED_WS_ALLOWED_ORIGINS = (process.env.WS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const wsHandshakeSessions = new WeakMap<IncomingMessage, string>();
const wsSessionPlayers = new Map<string, number>();

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${derivedKey.toString('base64url')}`;
}

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

function signPlayerToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '7d',
  });
}

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
    name: typeof (payload as jwt.JwtPayload).name === 'string' ? (payload as jwt.JwtPayload).name : undefined,
    role: typeof (payload as jwt.JwtPayload).role === 'string' ? (payload as jwt.JwtPayload).role : undefined,
    tokenVersion,
  };
}

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

function getCookie(req: Request | IncomingMessage, name: string): string | null {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== 'string') {
    return null;
  }

  return parseCookies(cookieHeader)[name] || null;
}

function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
  });
}

function getAllowedWebSocketOrigins(req: IncomingMessage): string[] {
  if (CONFIGURED_WS_ALLOWED_ORIGINS.length > 0) {
    return CONFIGURED_WS_ALLOWED_ORIGINS;
  }

  if (typeof req.headers.host !== 'string' || !req.headers.host) {
    return [];
  }

  return [`http://${req.headers.host}`, `https://${req.headers.host}`];
}

function isAllowedWebSocketOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !origin) {
    return true;
  }

  return getAllowedWebSocketOrigins(req).includes(origin);
}

function rejectWebSocketUpgrade(socket: Socket): void {
  socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  socket.destroy();
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
    return null;
  }

  return auth.slice(7);
}

function getJwtToken(req: Request): string | null {
  return getBearerToken(req) || getCookie(req, AUTH_COOKIE_NAME);
}

function getWsSessionPayload(req: Request): AuthTokenPayload | null {
  const sessionToken = getCookie(req, WS_SESSION_COOKIE_NAME);
  if (!sessionToken) {
    return null;
  }

  const playerId = wsSessionPlayers.get(sessionToken);
  if (!playerId) {
    throw new Error('Invalid session');
  }

  return { playerId, role: 'player', tokenVersion: 0 };
}

function getRequestAuthPayload(req: Request): { payload: AuthTokenPayload | null; hadCredentials: boolean } {
  const jwtToken = getJwtToken(req);
  if (jwtToken) {
    try {
      return { payload: verifyToken(jwtToken), hadCredentials: true };
    } catch {
      return { payload: null, hadCredentials: true };
    }
  }

  const sessionPayload = getWsSessionPayload(req);
  if (sessionPayload) {
    return { payload: sessionPayload, hadCredentials: true };
  }

  return { payload: null, hadCredentials: false };
}

function getAuthenticatedPlayer(req: Request): AuthTokenPayload {
  return (req as any).player as AuthTokenPayload;
}

function resolveAuthorizedPlayerId(req: Request, res: Response, rawPlayerId: unknown): number | null {
  const authPlayer = getAuthenticatedPlayer(req);

  if (rawPlayerId === undefined || rawPlayerId === null || rawPlayerId === '') {
    return authPlayer.playerId;
  }

  const playerId = Number.parseInt(String(rawPlayerId), 10);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    res.status(400).json({ error: 'Invalid player ID' });
    return null;
  }

  if (authPlayer.role !== 'admin' && authPlayer.playerId !== playerId) {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return playerId;
}

async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { payload, hadCredentials } = getRequestAuthPayload(req);
  if (!payload) {
    res.status(hadCredentials ? 403 : 401).json({ error: hadCredentials ? 'Invalid token' : 'Authentication required' });
    return;
  }

  // For JWT tokens, verify the version in the DB hasn't been incremented (e.g. by logout)
  if (getJwtToken(req)) {
    try {
      const result = await pool.query('SELECT token_version FROM players WHERE id = $1', [payload.playerId]);
      if (result.rows.length === 0 || result.rows[0].token_version !== payload.tokenVersion) {
        res.status(401).json({ error: 'Token has been revoked' });
        return;
      }
    } catch {
      res.status(500).json({ error: 'Internal server error' });
      return;
    }
  }

  (req as any).player = payload;
  next();
}

function authenticateAdmin(req: Request, res: Response, next: NextFunction): void {
  if (ADMIN_API_KEY && req.headers['x-admin-key'] === ADMIN_API_KEY) {
    next();
    return;
  }

  const token = getJwtToken(req);
  if (!token) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  try {
    const payload = verifyToken(token);
    if (payload.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    (req as any).player = payload;
    next();
  } catch {
    res.status(403).json({ error: 'Forbidden' });
  }
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
  console.error("Could not load ship configs", e);
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

wss.on('headers', (headers, req) => {
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  wsHandshakeSessions.set(req, sessionToken);
  const secureFlag = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  headers.push(`Set-Cookie: ${WS_SESSION_COOKIE_NAME}=${sessionToken}; HttpOnly; Path=/; SameSite=Lax${secureFlag}`);
});

interface Player {
  ws: WebSocket;
  sector: number;
  name: string;
}
const players: Record<number, Player> = {};

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

export async function getGraph(): Promise<number[][]> {
    const sectorsRes = await pool.query('SELECT id FROM sectors ORDER BY id ASC');
    const size = sectorsRes.rows.length;

    if (size === 0) {
        throw new Error('No sectors found in database. Load universe data before starting the server.');
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

function broadcastTo(data: ServerMessage, targetClients: Set<WebSocket> | WebSocket[]) {
    for (const client of targetClients) {
        if (client.readyState === 1) {
            client.send(JSON.stringify(data));
        }
    }
}

wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
  console.log('New WebSocket client connected');
  const sessionToken = wsHandshakeSessions.get(req) || crypto.randomBytes(32).toString('base64url');

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
      wsSessionPlayers.set(sessionToken, playerId);
      const welcomeMsg: ServerMessage = {
        type: 'welcome',
        playerId,
        name: playerRow.name,
        sector,
        token: signPlayerToken({ playerId, name: playerRow.name, role: authPayload.role, tokenVersion: playerRow.token_version }),
      };
      ws.send(JSON.stringify(welcomeMsg));
      console.log(`${playerId} connected.`);

      let tokens = 50;
      const refillInterval = setInterval(() => {
        tokens = Math.min(50, tokens + 20);
      }, 1000);

      ws.on('message', async (message) => {
        if (tokens <= 0) {
          const msg: ServerMessage = { type: 'rateLimited' };
          ws.send(JSON.stringify(msg));
          return;
        }
        tokens--;

        const warps = await getGraph();
        const data = JSON.parse(message.toString());
        
        if (data.type === 'move') {
            const shipRes = await pool.query('SELECT player_id FROM player_ships WHERE player_id = $1', [playerId]);
            if (shipRes.rows.length === 0) {
                const msg: ServerMessage = { type: 'noShip' };
                ws.send(JSON.stringify(msg));
                return;
            }

            if (players[playerId]) {
                const currentSector = players[playerId].sector;
                const targetSector = data.sector;
                
                if (warps[currentSector] && warps[currentSector].includes(targetSector)) {
                    players[playerId].sector = targetSector;
                    await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [targetSector, playerId]);
                    
                    const oldSectorClients = new Set<WebSocket>();
                    const newSectorClients = new Set<WebSocket>();
                    for (const [idStr, p] of Object.entries(players)) {
                        if (Number(idStr) === playerId) continue;
                        if (p.sector === currentSector) oldSectorClients.add(p.ws);
                        else if (p.sector === targetSector) newSectorClients.add(p.ws);
                    }
                    broadcastTo({ type: 'playerMoved', playerId, sector: targetSector, direction: 'out' }, oldSectorClients);
                    broadcastTo({ type: 'playerMoved', playerId, sector: targetSector, direction: 'in' }, newSectorClients);
                    const displayWarps = warps[targetSector] || [];
                    const playersInSector = Object.entries(players).filter(([, p]) => p.sector === targetSector).map(([id]) => Number(id));
                    const sectorMsg: ServerMessage = { type: 'sectorDisplay', sector: targetSector, warps: displayWarps, players: playersInSector };
                    ws.send(JSON.stringify(sectorMsg));
                } else {
                    const nonAdjMsg: ServerMessage = { type: 'nonAdjacentMoveRequested', playerId, sector: targetSector };
                    ws.send(JSON.stringify(nonAdjMsg));
                }
            }
        } else if (data.type === 'who') {
            const playersKeys = Object.keys(players).map(Number);
            const whoMsg: ServerMessage = { type: 'playersOnline', players: playersKeys };
            ws.send(JSON.stringify(whoMsg));
        } else if (data.type === 'display') {
            const currentSector = players[playerId].sector;
            const displayWarps = warps[currentSector] || [];
            const playersInSector = Object.entries(players).filter(([, p]) => p.sector === currentSector).map(([id]) => Number(id));
            const displayMsg: ServerMessage = { type: 'sectorDisplay', sector: currentSector, warps: displayWarps, players: playersInSector };
            ws.send(JSON.stringify(displayMsg));
        }
      });

      ws.on('close', () => {
        clearInterval(refillInterval);
        console.log(`${playerId} disconnected.`);
        const lastSector = players[playerId]?.sector;
        delete players[playerId];
        wsSessionPlayers.delete(sessionToken);

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
      wsSessionPlayers.delete(sessionToken);
      console.error('Connection error:', error);
      ws.close();
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

// REST Endpoints
app.get('/api/sector/:id', async (req, res): Promise<any> => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
        return res.status(400).json({ error: "Invalid sector ID" });
    }
    
    try {
        const sectorRes = await pool.query('SELECT id FROM sectors WHERE id = $1', [id]);
        if (sectorRes.rows.length === 0) {
            return res.status(404).json({ error: "Sector not found" });
        }
        
        const warpsRes = await pool.query('SELECT sector_to FROM warps WHERE sector_from = $1', [id]);
        const warps = warpsRes.rows.map(r => r.sector_to);
        
        const body: SectorResponse = { id, warps };
        res.json(body);
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/players/online', (_req, res) => {
    const online = Object.entries(players).map(([idStr, p]) => ({
        playerId: parseInt(idStr, 10),
        name: p.name,
    }));
    const body: PlayersOnlineResponse = { players: online };
    res.json(body);
});

app.post('/api/move', authenticateToken, async (req, res): Promise<any> => {
    const { targetSector } = req.body;

    if (targetSector === undefined) {
        return res.status(400).json({ error: "Invalid request" });
    }

    const pId = getAuthenticatedPlayer(req).playerId;

    const ts = parseInt(targetSector, 10);
    
    const player = players[pId];
    if (!player) {
        return res.status(404).json({ error: "Player not found" });
    }
    
    const currentSector = player.sector;
    const warps = await getGraph();
    
    const shipRes = await pool.query('SELECT player_id FROM player_ships WHERE player_id = $1', [pId]);
    if (shipRes.rows.length === 0) {
        return res.status(400).json({ error: "No ship" });
    }

    if (!warps[currentSector] || !warps[currentSector].includes(ts)) {
        return res.status(400).json({ error: "Not adjacent" });
    }
    
    player.sector = ts;
    try {
        await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [ts, pId]);
    } catch (e) {
        console.error("DB update error", e);
    }
    
    const oldSectorClients = new Set<WebSocket>();
    const newSectorClients = new Set<WebSocket>();
    for (const [idStr, p] of Object.entries(players)) {
        if (Number(idStr) === pId) continue;
        if (p.sector === currentSector) oldSectorClients.add(p.ws);
        else if (p.sector === ts) newSectorClients.add(p.ws);
    }
    broadcastTo({ type: 'playerMoved', playerId: pId, sector: ts, direction: 'out' }, oldSectorClients);
    broadcastTo({ type: 'playerMoved', playerId: pId, sector: ts, direction: 'in' }, newSectorClients);
    if (player.ws) {
        const displayWarps = warps[ts] || [];
        const playersInSector = Object.entries(players).filter(([, p]) => p.sector === ts).map(([id]) => Number(id));
        const sectorMsg: ServerMessage = { type: 'sectorDisplay', sector: ts, warps: displayWarps, players: playersInSector };
        player.ws.send(JSON.stringify(sectorMsg));
    }

    const body: MoveResponse = { success: true, sector: ts, warps: warps[ts] || [] };
    res.json(body);
});

app.get('/api/route/:from/:to', async (req, res): Promise<any> => {
    const from = parseInt(req.params.from, 10);
    const to = parseInt(req.params.to, 10);
    
    if (isNaN(from) || from <= 0 || isNaN(to) || to <= 0) {
        return res.status(400).json({ error: "Invalid sector ID" });
    }
    
    try {
        const sectorRes = await pool.query('SELECT id FROM sectors WHERE id IN ($1, $2)', [from, to]);
        if (sectorRes.rows.length !== (from === to ? 1 : 2)) {
            const foundIds = new Set(sectorRes.rows.map(r => r.id));
            if (!foundIds.has(from) || !foundIds.has(to)) {
                return res.status(404).json({ error: "Sector not found" });
            }
        }
        
        if (from === to) {
            const body: RouteResponse = { path: [from], hops: 0 };
            return res.json(body);
        }
        
        const warps = await getGraph();
        
        // BFS
        const queue: { sector: number, path: number[] }[] = [{ sector: from, path: [from] }];
        const visited = new Set<number>();
        visited.add(from);
        
        while (queue.length > 0) {
            const { sector, path } = queue.shift()!;
            
            const neighbors = warps[sector] || [];
            for (const neighbor of neighbors) {
                if (neighbor === to) {
                    const finalPath = [...path, neighbor];
                    const body: RouteResponse = { path: finalPath, hops: finalPath.length - 1 };
                    return res.json(body);
                }
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push({ sector: neighbor, path: [...path, neighbor] });
                }
            }
        }
        
        res.status(404).json({ error: "No route found" });
        
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/port/:sectorId', async (req, res): Promise<any> => {
    const sectorId = parseInt(req.params.sectorId, 10);
    if (isNaN(sectorId) || sectorId <= 0) {
        return res.status(400).json({ error: "Invalid sector ID" });
    }
    
    try {
        const portRes = await pool.query(
            'SELECT sector_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1',
            [sectorId],
        );
        if (portRes.rows.length === 0) {
            return res.status(404).json({ error: "No port in this sector" });
        }

        const p = portRes.rows[0];
        const body: PortResponse = {
            sectorId: p.sector_id,
            class: p.class,
            fuel: p.fuel, fuelPrice: p.fuel_price,
            organics: p.organics, orgPrice: p.org_price,
            equipment: p.equipment, equPrice: p.equ_price,
        };
        res.json(body);
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/ship/:playerId', authenticateToken, async (req, res): Promise<any> => {
    const playerId = resolveAuthorizedPlayerId(req, res, req.params.playerId);
    if (playerId === null) {
        return;
    }
    
    try {
        const query = `
            SELECT ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit,
                   sc.fuel, sc.organics, sc.equipment
            FROM player_ships ps
            JOIN ship_cargo sc ON ps.player_id = sc.player_id
            WHERE ps.player_id = $1
        `;
        const result = await pool.query(query, [playerId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Player not found" });
        }
        
        const row = result.rows[0];
        const config = shipConfigs[row.ship_name];
        if (!config) {
            return res.status(500).json({ error: "Ship config missing" });
        }

        const holdsAvailable = row.cargo_limit - (row.fuel + row.organics + row.equipment);
        
        const body: ShipResponse = {
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
        };
        res.json(body);
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get('/api/cargo/:playerId', authenticateToken, async (req, res): Promise<any> => {
    const playerId = resolveAuthorizedPlayerId(req, res, req.params.playerId);
    if (playerId === null) {
        return;
    }
    
    try {
        const cargoRes = await pool.query('SELECT player_id, fuel, organics, equipment, credits FROM ship_cargo WHERE player_id = $1', [playerId]);
        if (cargoRes.rows.length === 0) {
            return res.status(404).json({ error: "Player not found" });
        }
        
        const c = cargoRes.rows[0];
        const body: CargoResponse = { playerId: c.player_id, fuel: c.fuel, organics: c.organics, equipment: c.equipment, credits: c.credits };
        res.json(body);
    } catch (error) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post('/api/trade', authenticateToken, async (req, res): Promise<any> => {
    const { good, quantity, action } = req.body;

    if (good === undefined || quantity === undefined || action === undefined) {
        return res.status(400).json({ error: "Invalid request" });
    }

    if (!["fuel", "organics", "equipment"].includes(good)) {
        return res.status(400).json({ error: "Invalid request" });
    }

    if (!["buy", "sell"].includes(action)) {
        return res.status(400).json({ error: "Invalid request" });
    }

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: "Invalid request" });
    }

    const pId = getAuthenticatedPlayer(req).playerId;

    const player = players[pId];
    if (!player) {
        return res.status(404).json({ error: "Player not found" });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [pId]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query(
            'SELECT class, fuel, fuel_price, organics, org_price, equipment, equ_price FROM ports WHERE sector_id = $1 FOR UPDATE',
            [currentSector],
        );
        if (portRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "No port in this sector" });
        }

        const port = portRes.rows[0];

        // Validate that this port's class supports the requested action on this commodity
        const priceColMap: Record<string, string> = { fuel: 'fuel_price', organics: 'org_price', equipment: 'equ_price' };
        const portActions = PORT_CLASS_ACTIONS[port.class];
        if (!portActions || (action === 'buy' && portActions[good] !== 'S') || (action === 'sell' && portActions[good] !== 'B')) {
            await client.query('ROLLBACK');
            console.error("TRADE FAIL REASON:", portActions, action, good); return res.status(400).json({ error: "Port does not trade this commodity" });
        }

        const price: number = port[priceColMap[good]];

        const cargoRes = await client.query(`
            SELECT sc.fuel, sc.organics, sc.equipment, sc.credits, ps.cargo_limit 
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `, [pId]);
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }

        const cargo = cargoRes.rows[0];

        if (action === "buy") {
            const cost = qty * price;
            if (cargo.credits < cost) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "Insufficient credits" });
            }
            if (port[good] < qty) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "Insufficient port inventory" });
            }
            if (cargo.fuel + cargo.organics + cargo.equipment + qty > cargo.cargo_limit) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "Insufficient cargo holds" });
            }

            await client.query(`UPDATE ports SET ${good} = ${good} - $1 WHERE sector_id = $2`, [qty, currentSector]);
            await client.query(`UPDATE ship_cargo SET ${good} = ${good} + $1, credits = credits - $2 WHERE player_id = $3`, [qty, cost, pId]);

            await client.query('COMMIT');

            cargo[good] += qty;
            cargo.credits -= cost;
            const buyBody: TradeResponse = { success: true, credits: cargo.credits, cargo: { fuel: cargo.fuel, organics: cargo.organics, equipment: cargo.equipment } };
            res.json(buyBody);

        } else if (action === "sell") {
            const revenue = qty * price;
            if (cargo[good] < qty) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "Insufficient cargo" });
            }

            await client.query(`UPDATE ports SET ${good} = ${good} + $1 WHERE sector_id = $2`, [qty, currentSector]);
            await client.query(`UPDATE ship_cargo SET ${good} = ${good} - $1, credits = credits + $2 WHERE player_id = $3`, [qty, revenue, pId]);

            await client.query('COMMIT');

            cargo[good] -= qty;
            cargo.credits += revenue;
            const sellBody: TradeResponse = { success: true, credits: cargo.credits, cargo: { fuel: cargo.fuel, organics: cargo.organics, equipment: cargo.equipment } };
            res.json(sellBody);
        }
        
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Trade error", err);
        res.status(500).json({ error: "Internal server error" });
    } finally {
        client.release();
    }
});

app.post('/api/port/buy-fighters', authenticateToken, async (req, res): Promise<any> => {
    const { quantity } = req.body;
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "Invalid quantity" });
    const pId = getAuthenticatedPlayer(req).playerId;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [pId]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query('SELECT class FROM ports WHERE sector_id = $1', [currentSector]);
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Not at a class 0 port" });
        }

        const cargoRes = await client.query(`
            SELECT sc.credits, ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit 
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `, [pId]);
        
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.fighters + qty > config.maxFighters) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Exceeds maximum" });
        }

        const cost = qty * 20;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Insufficient credits" });
        }

        await client.query('UPDATE player_ships SET fighters = fighters + $1 WHERE player_id = $2', [qty, pId]);
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [cost, pId]);
        await client.query('COMMIT');

        const body: BuyResponse = { success: true, credits: data.credits - cost, fighters: data.fighters + qty, shields: data.shields, cargoLimit: data.cargo_limit };
        res.json(body);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: "Internal server error" });
    } finally {
        client.release();
    }
});

app.post('/api/port/buy-shields', authenticateToken, async (req, res): Promise<any> => {
    const { quantity } = req.body;
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "Invalid quantity" });
    const pId = getAuthenticatedPlayer(req).playerId;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [pId]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query('SELECT class FROM ports WHERE sector_id = $1', [currentSector]);
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Not at a class 0 port" });
        }

        const cargoRes = await client.query(`
            SELECT sc.credits, ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit 
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `, [pId]);
        
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.shields + qty > config.maxShields) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Exceeds maximum" });
        }

        const cost = qty * 10;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Insufficient credits" });
        }

        await client.query('UPDATE player_ships SET shields = shields + $1 WHERE player_id = $2', [qty, pId]);
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [cost, pId]);
        await client.query('COMMIT');

        const body: BuyResponse = { success: true, credits: data.credits - cost, fighters: data.fighters, shields: data.shields + qty, cargoLimit: data.cargo_limit };
        res.json(body);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: "Internal server error" });
    } finally {
        client.release();
    }
});

app.post('/api/port/buy-holds', authenticateToken, async (req, res): Promise<any> => {
    const { quantity } = req.body;
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0) return res.status(400).json({ error: "Invalid quantity" });
    const pId = getAuthenticatedPlayer(req).playerId;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query('SELECT current_sector FROM players WHERE id = $1', [pId]);
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }
        const currentSector = pRes.rows[0].current_sector;

        const portRes = await client.query('SELECT class FROM ports WHERE sector_id = $1', [currentSector]);
        if (portRes.rows.length === 0 || portRes.rows[0].class !== 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Not at a class 0 port" });
        }

        const cargoRes = await client.query(`
            SELECT sc.credits, ps.ship_name, ps.fighters, ps.shields, ps.cargo_limit 
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `, [pId]);
        
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }

        const data = cargoRes.rows[0];
        const config = shipConfigs[data.ship_name];
        if (data.cargo_limit + qty > config.maxHolds) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Exceeds maximum" });
        }

        const cost = qty * 50;
        if (data.credits < cost) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Insufficient credits" });
        }

        await client.query('UPDATE player_ships SET cargo_limit = cargo_limit + $1 WHERE player_id = $2', [qty, pId]);
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [cost, pId]);
        await client.query('COMMIT');

        const body: BuyResponse = { success: true, credits: data.credits - cost, fighters: data.fighters, shields: data.shields, cargoLimit: data.cargo_limit + qty };
        res.json(body);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: "Internal server error" });
    } finally {
        client.release();
    }
});

app.post('/api/ship/exchange', authenticateToken, async (req, res): Promise<any> => {
    const { targetShipName } = req.body;
    const pId = getAuthenticatedPlayer(req).playerId;

    const targetConfig = shipConfigs[targetShipName];
    if (!targetConfig) {
        return res.status(400).json({ error: "Unknown ship" });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const pRes = await client.query(`
            SELECT p.current_sector, s.name as sector_name 
            FROM players p 
            JOIN sectors s ON p.current_sector = s.id 
            WHERE p.id = $1
        `, [pId]);
        
        if (pRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }
        if (pRes.rows[0].sector_name !== 'Stardock') {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Not at Stardock" });
        }

        const cargoRes = await client.query(`
            SELECT sc.credits, sc.fuel, sc.organics, sc.equipment, ps.ship_name 
            FROM ship_cargo sc
            JOIN player_ships ps ON sc.player_id = ps.player_id
            WHERE sc.player_id = $1 FOR UPDATE
        `, [pId]);
        
        if (cargoRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: "Player not found" });
        }

        const data = cargoRes.rows[0];
        if (data.ship_name === targetShipName) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Already on that ship" });
        }

        const currentConfig = shipConfigs[data.ship_name];
        const cost = targetConfig.price - currentConfig.price;
        if (cost > 0 && data.credits < cost) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "Insufficient credits" });
        }

        const newCargoLimit = targetConfig.startingHolds;
        const currentCargo = data.fuel + data.organics + data.equipment;
        if (newCargoLimit < currentCargo) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: "New ship has insufficient holds for current cargo" });
        }

        await client.query(`
            UPDATE player_ships 
            SET ship_name = $1, fighters = 0, shields = 0, cargo_limit = $2 
            WHERE player_id = $3
        `, [targetShipName, newCargoLimit, pId]);
        
        await client.query('UPDATE ship_cargo SET credits = credits - $1 WHERE player_id = $2', [cost, pId]);
        await client.query('COMMIT');

        const body: ShipExchangeResponse = {
            success: true,
            shipName: targetShipName,
            credits: data.credits - cost,
            maxFighters: targetConfig.maxFighters,
            maxShields: targetConfig.maxShields,
            cargoLimit: newCargoLimit,
        };
        res.json(body);
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: "Internal server error" });
    } finally {
        client.release();
    }
});

app.post('/api/auth/logout', authenticateToken, async (req, res): Promise<any> => {
  const { playerId } = getAuthenticatedPlayer(req);
  try {
    await pool.query('UPDATE players SET token_version = token_version + 1 WHERE id = $1', [playerId]);
    res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
    const body: LogoutResponse = { success: true };
    res.json(body);
  } catch (err) {
    console.error('Logout error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/register', registerLimiter, async (req, res): Promise<any> => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }

  const hash = hashPassword(password);
  const role = 'player';

  try {
    const result = await pool.query(
      `INSERT INTO players (name, email, password_hash, role, current_sector)
       VALUES ($1, $2, $3, $4, 1) RETURNING id, name, email, role, token_version`,
      [name, email, hash, role],
    );
    const player = result.rows[0];

    await pool.query(
      `INSERT INTO ship_cargo (player_id, fuel, organics, equipment, credits)
       VALUES ($1, 0, 0, 0, 10000) ON CONFLICT (player_id) DO NOTHING`,
      [player.id],
    );
    const merchant = shipConfigs['Merchant Freighter'];
    if (merchant) {
      await pool.query(
        `INSERT INTO player_ships (player_id, ship_name, fighters, shields, cargo_limit)
         VALUES ($1, $2, 0, 0, $3) ON CONFLICT (player_id) DO NOTHING`,
        [player.id, merchant.name, merchant.startingHolds],
      );
    }

    const token = signPlayerToken({ playerId: player.id, name: player.name, role: player.role, tokenVersion: player.token_version });

    setAuthCookie(res, token);
    const body: AuthResponse = { playerId: player.id, name: player.name, role: player.role, token };
    res.status(201).json(body);
  } catch (err: any) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('Register error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res): Promise<any> => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, name, role, password_hash, token_version FROM players WHERE email = $1',
      [email],
    );
    if (result.rows.length === 0 || !verifyPassword(password, result.rows[0].password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const player = result.rows[0];

    const token = signPlayerToken({ playerId: player.id, name: player.name, role: player.role, tokenVersion: player.token_version });

    setAuthCookie(res, token);
    const body: AuthResponse = { playerId: player.id, name: player.name, role: player.role, token };
    res.json(body);
  } catch (err) {
    console.error('Login error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/api/admin/server-stats', authenticateAdmin, async (req, res): Promise<any> => {
  try {
    const playerCount = await pool.query('SELECT COUNT(*) FROM players');
    const sectorCount = await pool.query('SELECT COUNT(*) FROM sectors');
    const body: ServerStatsResponse = {
      uptime: process.uptime(),
      playersOnline: Object.keys(players).length,
      totalPlayers: parseInt(playerCount.rows[0].count, 10),
      totalSectors: parseInt(sectorCount.rows[0].count, 10),
      nodeVersion: process.version,
      platform: process.platform,
    };
    res.json(body);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
if ( (process.argv[1] && process.argv[1].endsWith('server.js'))) {
    startServer();
}

export { app, server, wss, startServer };

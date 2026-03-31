import pg from 'pg';
import { spawn } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');
const merchantCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'merchant.json'), 'utf8'));

export function createPool() {
  return new Pool({
    host:     process.env.PGHOST     || 'localhost',
    database: process.env.PGDATABASE || 'twnr',
    user:     process.env.PGUSER,
    password: process.env.PGPASSWORD,
  });
}

function makeAuthToken(playerId, role = 'player', tokenVersion = 1) {
  return jwt.sign({ playerId, name: 'Test Player', role, tokenVersion }, process.env.JWT_SECRET || 'test-jwt-secret', {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

function getDefaultAuthHeaders(path, authPlayerId) {
  if (
    path === '/api/auth/logout'
  ) {
    const playerId = Number(authPlayerId || 1);
    if (Number.isInteger(playerId) && playerId > 0) {
      return { Authorization: `Bearer ${makeAuthToken(playerId)}` };
    }
  }

  return {};
}

export function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['dist/server.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        JWT_SECRET: process.env.JWT_SECRET || 'test-jwt-secret',
        ADMIN_API_KEY: process.env.ADMIN_API_KEY || 'test-admin-key',
        WS_ALLOWED_ORIGINS: process.env.WS_ALLOWED_ORIGINS || 'http://localhost:3000',
      },
    });

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error('Server start timeout (10s)')); }
    }, 10000);

    proc.stdout.on('data', (d) => {
      const out = d.toString();
      if (!settled && (out.includes('listening') || out.includes('3000'))) {
        settled = true;
        clearTimeout(timeout);
        setTimeout(() => resolve(proc), 5000); // extra time for universe generation
      }
    });

    proc.stderr.on('data', (d) => {
      const text = d.toString().trim();
      if (text) process.stderr.write(`[server stderr] ${text}\n`);
    });

    proc.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(err); }
    });
    proc.on('exit', (code) => {
      if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(`Server exited with code ${code}`)); }
    });
  });
}

export async function connectWS(options = {}) {
  const { default: WebSocket } = await import('ws');
  const { token: providedToken, ...wsOptions } = options;

  let token = providedToken;
  if (!token) {
    // Create a player directly in the DB so we never touch the register rate limit
    const tmpPool = createPool();
    try {
      const ts = Date.now();
      const res = await tmpPool.query(
        `INSERT INTO players (name, email, password_hash, role, current_sector)
         VALUES ($1, $2, 'dummy', 'player', 1) RETURNING id`,
        [`WSTest_${ts}`, `wstest_${ts}@example.com`],
      );
      const playerId = res.rows[0].id;
      await tmpPool.query(
        `INSERT INTO ship_cargo (player_id, fuel, organics, equipment, credits) VALUES ($1, 0, 0, 0, 10000)`,
        [playerId],
      );
      await tmpPool.query(
        `INSERT INTO player_ships (player_id, ship_name, fighters, shields, cargo_limit) VALUES ($1, $2, 0, 0, $3)`,
        [playerId, merchantCfg.name, merchantCfg.startingHolds],
      );
      token = jwt.sign(
        { playerId, name: 'WSTest', role: 'player', tokenVersion: 1 },
        process.env.JWT_SECRET || 'test-jwt-secret',
        { algorithm: 'HS256', expiresIn: '1h' },
      );
    } finally {
      await tmpPool.end();
    }
  }

  const headers = { Cookie: `twnr_auth=${token}`, ...(wsOptions.headers || {}) };

  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:3000/ws', { ...wsOptions, headers });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS connect timeout')); }, 5000);
    let cookies = [];

    ws.on('upgrade', (res) => {
      cookies = res.headers['set-cookie'] || [];
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'welcome') {
        clearTimeout(timer);
        resolve({ ws, welcome: msg, cookies });
      }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

export function waitForMsg(ws, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for message type "${type}"`)), timeout);
    function handler(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg);
      }
    }
    ws.on('message', handler);
  });
}

/**
 * Sends a WS message and waits for a response of the given type.
 * Also accepts 'error' responses and returns them.
 */
export function wsRequest(ws, msg, responseType, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${responseType}"`)), timeout);
    function handler(data) {
      const parsed = JSON.parse(data.toString());
      if (parsed.type === responseType || parsed.type === 'error') {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(parsed);
      }
    }
    ws.on('message', handler);
    ws.send(JSON.stringify(msg));
  });
}

export function expectNoMsg(ws, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      resolve();
    }, timeout);
    function handler(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        reject(new Error(`Unexpectedly received message type "${type}"`));
      }
    }
    ws.on('message', handler);
  });
}

export function closeWS(ws) {
  return new Promise((resolve) => {
    if (!ws || ws.readyState > 1) { resolve(); return; }
    ws.on('close', resolve);
    ws.close();
    setTimeout(resolve, 5000);
  });
}

export async function httpGet(path) {
  const res = await fetch(`http://localhost:3000${path}`, {
    headers: getDefaultAuthHeaders(path),
  });
  return { status: res.status, body: await res.json() };
}

export async function httpPost(path, data, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...getDefaultAuthHeaders(path, options.authPlayerId),
    ...(options.headers || {}),
  };

  const res = await fetch(`http://localhost:3000${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json() };
}

const PORT_CLASS_ACTIONS = {
  1: { fuel: 'B', organics: 'B', equipment: 'S' },
  2: { fuel: 'B', organics: 'S', equipment: 'B' },
  3: { fuel: 'S', organics: 'B', equipment: 'B' },
  4: { fuel: 'S', organics: 'S', equipment: 'B' },
  5: { fuel: 'B', organics: 'S', equipment: 'S' },
  6: { fuel: 'S', organics: 'B', equipment: 'S' },
  7: { fuel: 'S', organics: 'S', equipment: 'S' },
  8: { fuel: 'B', organics: 'B', equipment: 'B' },
};

export async function findPortSector(ws) {
  for (let i = 1; i <= 100; i++) {
    const res = await wsRequest(ws, { type: 'port', sectorId: i }, 'portInfo');
    if (res.type === 'portInfo') return { sectorId: i, port: res };
  }
  return null;
}

export async function findPortSelling(ws, good) {
  for (let i = 1; i <= 100; i++) {
    const res = await wsRequest(ws, { type: 'port', sectorId: i }, 'portInfo');
    if (res.type === 'portInfo') {
      const actions = PORT_CLASS_ACTIONS[res.class];
      if (actions && actions[good] === 'S') return { sectorId: i, port: res };
    }
  }
  return null;
}

export async function findPortBuying(ws, good) {
  for (let i = 1; i <= 100; i++) {
    const res = await wsRequest(ws, { type: 'port', sectorId: i }, 'portInfo');
    if (res.type === 'portInfo') {
      const actions = PORT_CLASS_ACTIONS[res.class];
      if (actions && actions[good] === 'B') return { sectorId: i, port: res };
    }
  }
  return null;
}

export async function movePlayerTo(ws, targetSector) {
  const disp = await wsRequest(ws, { type: 'display' }, 'sectorDisplay');
  if (disp.sector === targetSector) return true;

  const routeRes = await wsRequest(ws, { type: 'route', from: disp.sector, to: targetSector }, 'routeResult');
  if (routeRes.type === 'error') return false;

  for (let i = 1; i < routeRes.path.length; i++) {
    const moveMsg = await wsRequest(ws, { type: 'move', sector: routeRes.path[i] }, 'sectorDisplay');
    if (moveMsg.type === 'error') return false;
  }
  return true;
}

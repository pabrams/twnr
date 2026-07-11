import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { ClientTag, ServerTag, PORT_CLASS_ACTIONS } from '@twnr/shared';
import { BASE as BASE_URL, WS_BASE as WS_URL, createTestUserWithToken } from './global-setup.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');
const merchantCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'templates', 'stock', 'ships', '01-vulpeculan-cruiser.json'), 'utf8'));

export { createPool } from './global-setup.mjs';

/**
 * Creates a test user in the users table and returns { userId, token }.
 */
export async function createTestUser(pool) {
  return createTestUserWithToken(pool);
}

/**
 * Creates a player in a universe for the given user. Returns playerId.
 */
export async function createTestPlayer(pool, userId, universeId, name, sector = 1, drones = 0, shields = 0) {
  const univRes = await pool.query(
    `SELECT COALESCE(us.starting_turns, 500) as starting_turns
     FROM universes u LEFT JOIN universe_settings us ON us.universe_id = u.id WHERE u.id = $1`,
    [universeId],
  );
  const startingTurns = univRes.rows[0]?.starting_turns ?? 500;
  const sectorIdRes = await pool.query('SELECT id FROM sectors WHERE sector_number = $1 AND universe_id = $2', [sector, universeId]);
  const sectorId = sectorIdRes.rows[0]?.id;
  const shipTypeRes = await pool.query(
    'SELECT slug, starting_holds, turns_per_warp FROM universe_ship_types WHERE universe_id = $1 AND slug = $2',
    [universeId, merchantCfg.slug],
  );
  const shipType = shipTypeRes.rows[0];
  const shipTypeSlug = shipType?.slug ?? merchantCfg.slug;
  const startingHolds = shipType?.starting_holds ?? merchantCfg.startingHolds;
  const turnsPerWarp = shipType?.turns_per_warp ?? merchantCfg.turnsPerWarp ?? 2;
  const res = await pool.query(
    `INSERT INTO players (name, user_id, universe_id, current_sector_id, credits, turns)
     VALUES ($1, $2, $3, $4, 10000, $5) RETURNING id`,
    [name, userId, universeId, sectorId, startingTurns],
  );
  const playerId = res.rows[0].id;

  // Mirror production insertStartingShip: ships are keyed by
  // (universe_id, universe_ship_number) and reference a universe ship-type slug.
  const shipRes = await pool.query(
    `INSERT INTO ships (universe_id, universe_ship_number, name, owner_player_id, ship_type_slug, sector_id, drones, shields, holds, turns_per_warp)
     SELECT $1,
            COALESCE((SELECT MAX(universe_ship_number) FROM ships WHERE universe_id = $1), 0) + 1,
            $2, $3, $4, $5, $6, $7, $8, $9
     RETURNING id`,
    [universeId, `${name}'s ship`, playerId, shipTypeSlug, sectorId, drones, shields, startingHolds, turnsPerWarp],
  );
  await pool.query('UPDATE players SET ship_id = $1 WHERE id = $2', [shipRes.rows[0].id, playerId]);

  return playerId;
}

export async function connectWS(options = {}) {
  const { default: WebSocket } = await import('ws');
  const { token: providedToken, universeId: providedUniverseId, pool: optPool, ...wsOptions } = options;

  let token = providedToken;
  let universeId = providedUniverseId;

  // Auto-create a user and player if no token provided
  if (!token && optPool) {
    const { userId, token: newToken } = await createTestUser(optPool);
    token = newToken;
    if (!universeId) universeId = 1;
    await createTestPlayer(optPool, userId, universeId, `WSTest_${Date.now()}`, 1);
  } else if (!token) {
    throw new Error('connectWS requires a token or pool option');
  }

  const headers = { Cookie: `twnr_auth=${token}`, ...(wsOptions.headers || {}) };
  const url = universeId
    ? `${WS_URL}/ws?universe=${universeId}`
    : `${WS_URL}/ws`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { ...wsOptions, headers });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS connect timeout')); }, 2000);
    let cookies = [];

    ws.on('upgrade', (res) => {
      cookies = res.headers['set-cookie'] || [];
    });

    ws.on('message', (data) => {
      const raw = JSON.parse(data.toString());
      const msg = raw.payload ?? raw;
      if (msg.type === 'welcome') {
        clearTimeout(timer);
        resolve({ ws, welcome: msg, cookies });
      }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

export function waitForMsg(ws, type, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for message type "${type}"`)), timeout);
    function handler(data) {
      const raw = JSON.parse(data.toString());
      const msg = raw.payload ?? raw;
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeListener('message', handler);
        resolve(msg);
      }
    }
    ws.on('message', handler);
  });
}

export function wsRequest(ws, msg, responseType, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${responseType}"`)), timeout);
    function handler(data) {
      const raw = JSON.parse(data.toString());
      const parsed = raw.payload ?? raw;
      if (parsed.type === 'rateLimited') {
        // Wait for token bucket to refill, then resend
        setTimeout(() => ws.send(JSON.stringify(msg)), 200);
        return;
      }
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

export function expectNoMsg(ws, type, timeout = 500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      resolve();
    }, timeout);
    function handler(data) {
      const raw = JSON.parse(data.toString());
      const msg = raw.payload ?? raw;
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
    setTimeout(resolve, 1000);
  });
}

export async function httpGet(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  return { status: res.status, body: await res.json() };
}

export async function httpPost(path, data, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  return { status: res.status, body: await res.json() };
}

export async function findPortSector(ws) {
  for (let i = 1; i <= 100; i++) {
    const res = await wsRequest(ws, { type: ClientTag.PortInfo, sectorId: i }, ServerTag.PortInfoResult);
    if (res.type === ServerTag.PortInfoResult) return { sectorId: i, port: res };
  }
  return null;
}

export async function findPortSelling(ws, good) {
  for (let i = 1; i <= 100; i++) {
    const res = await wsRequest(ws, { type: ClientTag.PortInfo, sectorId: i }, ServerTag.PortInfoResult);
    if (res.type === ServerTag.PortInfoResult) {
      const actions = PORT_CLASS_ACTIONS[res.class];
      if (actions && actions[good] === 'S') return { sectorId: i, port: res };
    }
  }
  return null;
}

export async function findPortBuying(ws, good) {
  for (let i = 1; i <= 100; i++) {
    const res = await wsRequest(ws, { type: ClientTag.PortInfo, sectorId: i }, ServerTag.PortInfoResult);
    if (res.type === ServerTag.PortInfoResult) {
      const actions = PORT_CLASS_ACTIONS[res.class];
      if (actions && actions[good] === 'B') return { sectorId: i, port: res };
    }
  }
  return null;
}

export async function movePlayerTo(ws, targetSector) {
  const disp = await wsRequest(ws, { type: ClientTag.SectorDisplay }, ServerTag.SectorDisplayResult);
  if (disp.sector === targetSector) return true;

  const pathRes = await wsRequest(ws, { type: ClientTag.ShortestPath, from: disp.sector, to: targetSector }, ServerTag.ShortestPathResult);
  if (pathRes.type === ServerTag.Error) return false;

  for (let i = 1; i < pathRes.path.length; i++) {
    const moveMsg = await wsRequest(ws, { type: ClientTag.Move, sector: pathRes.path[i].sector }, ServerTag.MoveResult);
    if (moveMsg.type === ServerTag.Error || moveMsg.outcome === 'error') return false;
  }
  return true;
}

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createTestUser, connectWS, closeWS } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');
const STARTER_SLUG = JSON.parse(
  readFileSync(join(PROJECT_ROOT, 'config', 'templates', 'stock', 'ships', '01-vulpeculan-cruiser.json'), 'utf8'),
).slug;

const UNIVERSE_ID = 1;

let pool;

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

async function createShiplessPlayer(name) {
  const { userId, token } = await createTestUser(pool);
  const sectorIdRes = await pool.query(
    'SELECT id FROM sectors WHERE sector_number = 1 AND universe_id = $1',
    [UNIVERSE_ID],
  );
  const res = await pool.query(
    `INSERT INTO players (name, user_id, universe_id, current_sector_id, credits, turns)
     VALUES ($1, $2, $3, $4, 10000, 100) RETURNING id`,
    [name, userId, UNIVERSE_ID, sectorIdRes.rows[0].id],
  );
  return { id: res.rows[0].id, token };
}

describe('Starting ship auto-grant', () => {
  it('assigns a default-named starter ship on connect without prompting', async () => {
    const name = `fresh_${Date.now()}`;
    const player = await createShiplessPlayer(name);
    const { ws, welcome, ready } = await connectWS({ token: player.token, universeId: UNIVERSE_ID });
    await ready;
    try {
      // Welcome already reflects the granted ship; no naming round-trip needed.
      assert.equal(welcome.shipTypeName, STARTER_SLUG);
      assert.equal(welcome.startingShip, undefined);

      const row = await pool.query(
        `SELECT s.name, s.ship_type_slug FROM players p JOIN ships s ON s.id = p.ship_id
         WHERE p.id = $1`,
        [player.id],
      );
      assert.equal(row.rows.length, 1);
      assert.equal(row.rows[0].ship_type_slug, STARTER_SLUG);
      assert.equal(row.rows[0].name, `${name.slice(0, 13).trim()}'s ship`);
    } finally {
      await closeWS(ws);
    }
  });
});

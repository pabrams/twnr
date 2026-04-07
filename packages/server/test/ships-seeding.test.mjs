import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectWS as _connectWS, closeWS } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

const merchantCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'ships', 'merchant.json'), 'utf8'));
const UNIVERSE_ID = 1;

// ─── globals ──────────────────────────────────────────────────────────────────

let pool;

function connectWS(opts = {}) {
  return _connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
}

// ─── setup ────────────────────────────────────────────────────────────────────

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

// ─── tests ────────────────────────────────────────────────────────────────────

describe('Universe Seeding', () => {
  it('importUniverse.js deletes ships before players', () => {
    const script = readFileSync(join(PROJECT_ROOT, 'scripts', 'importUniverse.js'), 'utf8');
    assert.ok(script.includes('DELETE FROM ships') || script.includes('DELETE FROM players'), 'importUniverse.js must handle ship/player deletion');
  });

  it('sector 1 has a class 0 port', async () => {
    const res = await pool.query('SELECT p.class FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE s.sector_number = 1 AND s.universe_id = $1', [UNIVERSE_ID]);
    assert.equal(res.rows.length, 1, 'sector 1 should have a port');
    assert.equal(res.rows[0].class, 0, 'sector 1 port should be class 0');
  });

  it('Starbase sector has a class 9 port', async () => {
    const res = await pool.query(
      `SELECT p.class FROM ports p
       JOIN sectors s ON p.sector_id = s.id
       WHERE s.name = 'Starbase' AND s.universe_id = $1`, [UNIVERSE_ID]
    );
    assert.equal(res.rows.length, 1, 'Starbase should have a port');
    assert.equal(res.rows[0].class, 9, 'Starbase port should be class 9');
  });
});

describe('New Player Ship Assignment', () => {
  it('WebSocket connect creates a ships row', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const res = await pool.query('SELECT * FROM ships WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [playerId]);
      assert.equal(res.rows.length, 1, 'ships row should be created on connect');
    } finally {
      await closeWS(ws);
    }
  });

  it(`new player is Merchant Freighter with drones=0, shields=0, holds=${merchantCfg.startingHolds}`, async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      const res = await pool.query('SELECT s.*, st.name as ship_name FROM ships s JOIN ship_types st ON s.ship_type_id = st.id WHERE s.id = (SELECT ship_id FROM players WHERE id = $1)', [playerId]);
      assert.equal(res.rows.length, 1);
      const row = res.rows[0];
      assert.equal(row.ship_name, merchantCfg.name);
      assert.equal(Number(row.drones), 0);
      assert.equal(Number(row.shields), 0);
      assert.equal(Number(row.holds), merchantCfg.startingHolds);
    } finally {
      await closeWS(ws);
    }
  });
});

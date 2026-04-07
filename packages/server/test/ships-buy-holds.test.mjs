import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectWS as _connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';

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

describe('Buy holds — validation', () => {
  it('returns "Invalid quantity" for quantity 0', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyHolds, quantity: 0 }, ServerMsgType.BuyHoldsResult);
      assert.equal(msg.type, ServerMsgType.Error);
      assert.equal(msg.message, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Invalid quantity" for negative quantity', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyHolds, quantity: -1 }, ServerMsgType.BuyHoldsResult);
      assert.equal(msg.type, ServerMsgType.Error);
      assert.equal(msg.message, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Invalid quantity" for a float quantity', async () => {
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyHolds, quantity: 0.5 }, ServerMsgType.BuyHoldsResult);
      assert.equal(msg.type, ServerMsgType.Error);
      assert.equal(msg.message, 'Invalid quantity');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Not at a class 0 port" when not in a class 0 sector', async () => {
    const res = await pool.query('SELECT s.sector_number AS sector_id FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE p.class != 0 AND s.universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
    assert.ok(res.rows.length > 0, 'Need a non-class-0 sector');
    const otherSector = Number(res.rows[0].sector_id);

    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE players SET current_sector = $1 WHERE id = $2', [otherSector, playerId]);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyHolds, quantity: 1 }, ServerMsgType.BuyHoldsResult);
      assert.equal(msg.type, ServerMsgType.Error);
      assert.equal(msg.message, 'Not at a class 0 port');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns "Insufficient credits" when player cannot afford holds', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE ship_cargo SET credits = 0 WHERE player_id = $1', [playerId]);
      const msg = await wsRequest(ws, { type: ClientMsgType.BuyHolds, quantity: 1 }, ServerMsgType.BuyHoldsResult);
      assert.equal(msg.type, ServerMsgType.Error);
      assert.equal(msg.message, 'Insufficient credits');
    } finally {
      await closeWS(ws);
    }
  });
});

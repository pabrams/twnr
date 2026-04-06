import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectWS as _connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');

const UNIVERSE_ID = 1;

async function navigateTo(ws, targetSector) {
  const disp = await wsRequest(ws, { type: 'sectorDisplay' }, 'sectorDisplayResult');
  if (disp.sector === targetSector) return;
  const path = await wsRequest(ws, { type: 'path', from: disp.sector, to: targetSector }, 'shortestPathResult');
  if (path.type === 'error') throw new Error(`No path to ${targetSector}`);
  for (let i = 1; i < path.path.length; i++) {
    await wsRequest(ws, { type: 'move', sector: path.path[i] }, 'moveResult');
  }
}

// ─── globals ──────────────────────────────────────────────────────────────────

let pool;

function connectWS(opts = {}) {
  return _connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
}

async function findFuelSellerSector() {
  const res = await pool.query('SELECT sector_id FROM ports WHERE class IN (3, 4, 6, 7) AND universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
  return res.rows.length > 0 ? Number(res.rows[0].sector_id) : null;
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

describe('Trade at class 0 port', () => {
  it('returns error when buying a commodity at a class 0 port', async () => {
    // New players start at sector 1, which has a class 0 port
    const { ws } = await connectWS();
    try {
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 1, action: 'buy' }, 'portTransactionResult');
      assert.equal(msg.type, 'error');
    } finally {
      await closeWS(ws);
    }
  });

  it('returns error when selling a commodity at a class 0 port', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE ship_cargo SET fuel = 3 WHERE player_id = $1', [playerId]);
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 1, action: 'sell' }, 'portTransactionResult');
      assert.equal(msg.type, 'error');
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Cargo hold enforcement', () => {
  it('buying cargo exceeding cargo_limit returns "Insufficient cargo holds"', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, fuelSector);
      // cargo_limit is 5; try to buy 6
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 6, action: 'buy' }, 'portTransactionResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });

  it('buying exactly cargo_limit units succeeds', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, fuelSector);
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 5, action: 'buy' }, 'portTransactionResult');
      assert.equal(msg.type, 'portTransactionResult', 'buying exactly cargo_limit should succeed');
    } finally {
      await closeWS(ws);
    }
  });

  it('buying any cargo when holds are full returns error', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, fuelSector);
      await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 5, action: 'buy' }, 'portTransactionResult');
      const msg = await wsRequest(ws, { type: 'portTransaction', good: 'fuel', quantity: 1, action: 'buy' }, 'portTransactionResult');
      assert.equal(msg.type, 'error');
      assert.equal(msg.message, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });
});

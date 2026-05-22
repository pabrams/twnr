import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectWS as _connectWS, closeWS, wsRequest } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { ClientTag, ServerTag } from '@twnr/shared';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');
const merchantCfg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'templates', 'stock', 'ships', '01-vulpeculan-cruiser.json'), 'utf8'));
const STARTING_HOLDS = merchantCfg.startingHolds;


const UNIVERSE_ID = 1;

async function navigateTo(ws, targetSector) {
  const disp = await wsRequest(ws, { type: ClientTag.SectorDisplay }, ServerTag.SectorDisplayResult);
  if (disp.sector === targetSector) return;
  const path = await wsRequest(ws, { type: ClientTag.ShortestPath, from: disp.sector, to: targetSector }, ServerTag.ShortestPathResult);
  if (path.type === ServerTag.Error) throw new Error(`No path to ${targetSector}`);
  for (let i = 1; i < path.path.length; i++) {
    await wsRequest(ws, { type: ClientTag.Move, sector: path.path[i].sector }, 'moveResult');
  }
}

// ─── globals ──────────────────────────────────────────────────────────────────

let pool;

function connectWS(opts = {}) {
  return _connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
}

async function findFuelSellerSector() {
  const res = await pool.query('SELECT s.sector_number AS sector_id FROM ports p JOIN sectors s ON p.sector_id = s.id WHERE p.class IN (3, 4, 6, 7) AND s.universe_id = $1 LIMIT 1', [UNIVERSE_ID]);
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
      const msg = await wsRequest(ws, { type: ClientTag.PortTransaction, good: 'fuel', quantity: 1, action: 'buy' }, ServerTag.PortTransactionResult);
      assert.equal(msg.type, ServerTag.Error);
    } finally {
      await closeWS(ws);
    }
  });

  it('returns error when selling a commodity at a class 0 port', async () => {
    const { ws, welcome } = await connectWS();
    const playerId = welcome.playerId;
    try {
      await pool.query('UPDATE ships SET fuel = 3 WHERE id = (SELECT ship_id FROM players WHERE id = $1)', [playerId]);
      const msg = await wsRequest(ws, { type: ClientTag.PortTransaction, good: 'fuel', quantity: 1, action: 'sell' }, ServerTag.PortTransactionResult);
      assert.equal(msg.type, ServerTag.Error);
    } finally {
      await closeWS(ws);
    }
  });
});

describe('Cargo hold enforcement', () => {
  it('buying cargo exceeding holds returns "Insufficient cargo holds"', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, fuelSector);
      // try to buy 1 more than startingHolds
      const msg = await wsRequest(ws, { type: ClientTag.PortTransaction, good: 'fuel', quantity: STARTING_HOLDS + 1, action: 'buy' }, ServerTag.PortTransactionResult);
      assert.equal(msg.type, ServerTag.Error);
      assert.equal(msg.message, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });

  it('buying exactly holds units succeeds', async () => {
    const fuelSector = await findFuelSellerSector();
    assert.ok(fuelSector, 'Need a fuel-selling port for this test');

    const { ws } = await connectWS();
    try {
      await navigateTo(ws, fuelSector);
      const msg = await wsRequest(ws, { type: ClientTag.PortTransaction, good: 'fuel', quantity: STARTING_HOLDS, action: 'buy' }, ServerTag.PortTransactionResult);
      assert.equal(msg.type, ServerTag.PortTransactionResult, 'buying exactly holds should succeed');
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
      await wsRequest(ws, { type: ClientTag.PortTransaction, good: 'fuel', quantity: STARTING_HOLDS, action: 'buy' }, ServerTag.PortTransactionResult);
      const msg = await wsRequest(ws, { type: ClientTag.PortTransaction, good: 'fuel', quantity: 1, action: 'buy' }, ServerTag.PortTransactionResult);
      assert.equal(msg.type, ServerTag.Error);
      assert.equal(msg.message, 'Insufficient cargo holds');
    } finally {
      await closeWS(ws);
    }
  });
});

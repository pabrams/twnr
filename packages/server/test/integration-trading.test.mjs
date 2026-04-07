import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectWS, closeWS, wsRequest, findPortSector, findPortSelling, findPortBuying, movePlayerTo } from './helpers.mjs';
import { ensureServer, createPool } from './global-setup.mjs';
import { ClientMsgType, ServerMsgType } from '@twnr/shared';

const UNIVERSE_ID = 1;

let pool;

function ws(opts = {}) {
  return connectWS({ pool, universeId: UNIVERSE_ID, ...opts });
}

before(async () => {
  await ensureServer();
  pool = createPool();
});

after(async () => {
  if (pool) await pool.end();
});

describe('Trading System', () => {
  it('ports table exists with correct columns', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ports' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('sector_id'), 'missing sector_id');
    assert.ok(cols.includes('class'), 'missing class');
    assert.ok(cols.includes('fuel'), 'missing fuel');
    assert.ok(cols.includes('fuel_price'), 'missing fuel_price');
    assert.ok(cols.includes('organics'), 'missing organics');
    assert.ok(cols.includes('org_price'), 'missing org_price');
    assert.ok(cols.includes('equipment'), 'missing equipment');
    assert.ok(cols.includes('equ_price'), 'missing equ_price');
  });

  it('ship_cargo table exists with correct columns', async () => {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'ship_cargo' ORDER BY column_name`
    );
    const cols = res.rows.map(r => r.column_name);
    assert.ok(cols.includes('player_id'), 'missing player_id');
    assert.ok(cols.includes('fuel'), 'missing fuel');
    assert.ok(cols.includes('organics'), 'missing organics');
    assert.ok(cols.includes('equipment'), 'missing equipment');
    assert.ok(cols.includes('credits'), 'missing credits');
  });

  it('port query returns port data', async () => {
    const { ws: wsConn } = await ws();
    const portSector = await findPortSector(wsConn);
    assert.ok(portSector, 'No ports found in any sector');
    const msg = portSector.port;
    assert.equal(msg.type, ServerMsgType.PortInfoResult);
    assert.equal(msg.sectorId, portSector.sectorId);
    assert.ok(typeof msg.class === 'number', 'class should be a number');
    assert.ok(msg.class >= 0 && msg.class <= 9, `class ${msg.class} out of range`);
    assert.ok(typeof msg.fuel === 'number');
    assert.ok(typeof msg.fuelPrice === 'number');
    assert.ok(typeof msg.organics === 'number');
    assert.ok(typeof msg.orgPrice === 'number');
    assert.ok(typeof msg.equipment === 'number');
    assert.ok(typeof msg.equPrice === 'number');
    await closeWS(wsConn);
  });

  it('port query returns error for sector without port', async () => {
    const { ws: wsConn } = await ws();
    let noPortSector = null;
    for (let i = 1; i <= 100; i++) {
      const res = await wsRequest(wsConn, { type: ClientMsgType.PortInfo, sectorId: i }, ServerMsgType.PortInfoResult);
      if (res.type === ServerMsgType.Error) { noPortSector = i; break; }
    }
    assert.ok(noPortSector, 'All sectors have ports — cannot test error');
    const msg = await wsRequest(wsConn, { type: ClientMsgType.PortInfo, sectorId: noPortSector }, ServerMsgType.PortInfoResult);
    assert.equal(msg.type, ServerMsgType.Error);
    assert.equal(msg.message, 'No port in this sector');
    await closeWS(wsConn);
  });

  it('port query returns error for invalid sector ID', async () => {
    const { ws: wsConn } = await ws();
    const msg = await wsRequest(wsConn, { type: ClientMsgType.PortInfo, sectorId: -1 }, ServerMsgType.PortInfoResult);
    assert.equal(msg.type, ServerMsgType.Error);
    assert.equal(msg.message, 'Invalid sector ID');
    await closeWS(wsConn);
  });

  it('cargo query returns cargo and credits', async () => {
    const { ws: wsConn, welcome } = await ws();
    const msg = await wsRequest(wsConn, { type: ClientMsgType.CargoInfo }, ServerMsgType.CargoInfoResult);
    assert.equal(msg.type, ServerMsgType.CargoInfoResult);
    assert.equal(msg.playerId, welcome.playerId);
    assert.equal(msg.credits, 10000);
    assert.equal(msg.fuel, 0);
    assert.equal(msg.organics, 0);
    assert.equal(msg.equipment, 0);
    await closeWS(wsConn);
  });

  it('trade buy succeeds and updates cargo and credits', async () => {
    const { ws: wsConn, welcome } = await ws();
    const portSector = await findPortSelling(wsConn, 'fuel');
    assert.ok(portSector, 'No port found selling fuel');

    const reached = await movePlayerTo(wsConn, portSector.sectorId);
    assert.ok(reached, `Could not reach port sector ${portSector.sectorId}`);

    const portBefore = await wsRequest(wsConn, { type: ClientMsgType.PortInfo, sectorId: portSector.sectorId }, ServerMsgType.PortInfoResult);
    const qty = 5;
    const msg = await wsRequest(wsConn, {
      type: ClientMsgType.PortTransaction,
      good: 'fuel',
      quantity: qty,
      action: 'buy',
    }, ServerMsgType.PortTransactionResult);
    assert.equal(msg.type, ServerMsgType.PortTransactionResult);
    assert.equal(msg.credits, 10000 - qty * portBefore.fuelPrice);
    assert.equal(msg.cargo.fuel, qty);

    const portAfter = await wsRequest(wsConn, { type: ClientMsgType.PortInfo, sectorId: portSector.sectorId }, ServerMsgType.PortInfoResult);
    assert.equal(portAfter.fuel, portBefore.fuel - qty);

    await closeWS(wsConn);
  });

  it('trade sell succeeds and updates cargo and credits', async () => {
    const { ws: wsConn, welcome } = await ws();
    const portSector = await findPortBuying(wsConn, 'organics');
    assert.ok(portSector, 'No port found buying organics');

    const reached = await movePlayerTo(wsConn, portSector.sectorId);
    assert.ok(reached, `Could not reach port sector ${portSector.sectorId}`);

    // Give the player organics directly so we don't need a separate buy port
    await pool.query('UPDATE ship_cargo SET organics = 10 WHERE player_id = $1', [welcome.playerId]);

    const portBefore = await wsRequest(wsConn, { type: ClientMsgType.PortInfo, sectorId: portSector.sectorId }, ServerMsgType.PortInfoResult);
    const price = portBefore.orgPrice;
    const msg = await wsRequest(wsConn, {
      type: ClientMsgType.PortTransaction,
      good: 'organics',
      quantity: 3,
      action: 'sell',
    }, ServerMsgType.PortTransactionResult);
    assert.equal(msg.type, ServerMsgType.PortTransactionResult);
    assert.equal(msg.cargo.organics, 7); // had 10, sold 3
    assert.equal(msg.credits, 10000 + 3 * price);

    const portAfter = await wsRequest(wsConn, { type: ClientMsgType.PortInfo, sectorId: portSector.sectorId }, ServerMsgType.PortInfoResult);
    assert.equal(portAfter.organics, portBefore.organics + 3);

    await closeWS(wsConn);
  });

  it('trade returns error for insufficient credits', async () => {
    const { ws: wsConn } = await ws();
    const portSector = await findPortSelling(wsConn, 'fuel');
    assert.ok(portSector, 'No port found selling fuel');

    const reached = await movePlayerTo(wsConn, portSector.sectorId);
    assert.ok(reached);

    // Ensure the port has enough inventory so we hit credits check first.
    await pool.query(
      'UPDATE ports SET fuel = 2000 WHERE sector_id = (SELECT id FROM sectors WHERE sector_number = $1 AND universe_id = $2)',
      [portSector.sectorId, UNIVERSE_ID]
    );

    const msg = await wsRequest(wsConn, {
      type: ClientMsgType.PortTransaction,
      good: 'fuel',
      quantity: 1001,
      action: 'buy',
    }, ServerMsgType.PortTransactionResult);
    assert.equal(msg.type, ServerMsgType.Error);
    assert.equal(msg.message, 'Insufficient credits');

    await closeWS(wsConn);
  });

  it('trade returns error for insufficient port inventory on buy', async () => {
    const { ws: wsConn, welcome } = await ws();
    const portSector = await findPortSelling(wsConn, 'fuel');
    assert.ok(portSector, 'No port found selling fuel');

    const reached = await movePlayerTo(wsConn, portSector.sectorId);
    assert.ok(reached);

    // Give player enough credits so we hit inventory check, not credits check
    await pool.query('UPDATE ship_cargo SET credits = 9999999 WHERE player_id = $1', [welcome.playerId]);

    const portInfo = await wsRequest(wsConn, { type: ClientMsgType.PortInfo, sectorId: portSector.sectorId }, ServerMsgType.PortInfoResult);
    const amount = portInfo.fuel + 1; // one more than available

    const msg = await wsRequest(wsConn, {
      type: ClientMsgType.PortTransaction,
      good: 'fuel',
      quantity: amount,
      action: 'buy',
    }, ServerMsgType.PortTransactionResult);
    assert.equal(msg.type, ServerMsgType.Error);
    assert.equal(msg.message, 'Insufficient port inventory');
    await closeWS(wsConn);
  });

  it('trade returns error for insufficient cargo on sell', async () => {
    const { ws: wsConn } = await ws();
    const portSector = await findPortBuying(wsConn, 'fuel');
    assert.ok(portSector, 'No port found buying fuel');

    const reached = await movePlayerTo(wsConn, portSector.sectorId);
    assert.ok(reached);

    const msg = await wsRequest(wsConn, {
      type: ClientMsgType.PortTransaction,
      good: 'fuel',
      quantity: 1,
      action: 'sell',
    }, ServerMsgType.PortTransactionResult);
    assert.equal(msg.type, ServerMsgType.Error);
    assert.equal(msg.message, 'Insufficient cargo');

    await closeWS(wsConn);
  });

  it('trade returns error when port does not trade the commodity', async () => {
    const { ws: wsConn } = await ws();
    // Find a port that buys fuel (player can sell but NOT buy)
    const portSector = await findPortBuying(wsConn, 'fuel');
    assert.ok(portSector, 'No port found buying fuel');

    const reached = await movePlayerTo(wsConn, portSector.sectorId);
    assert.ok(reached);

    // Try to BUY fuel from a port that only BUYS fuel
    const msg = await wsRequest(wsConn, {
      type: ClientMsgType.PortTransaction,
      good: 'fuel',
      quantity: 1,
      action: 'buy',
    }, ServerMsgType.PortTransactionResult);
    assert.equal(msg.type, ServerMsgType.Error);
    assert.equal(msg.message, 'Port does not trade this commodity');

    await closeWS(wsConn);
  });

  it('trade returns error for invalid fields', async () => {
    const { ws: wsConn } = await ws();

    const msg1 = await wsRequest(wsConn, {
      type: ClientMsgType.PortTransaction,
      good: 'unobtanium',
      quantity: 1,
      action: 'buy',
    }, ServerMsgType.PortTransactionResult);
    assert.equal(msg1.type, ServerMsgType.Error);
    assert.equal(msg1.message, 'Invalid good');

    const msg2 = await wsRequest(wsConn, {
      type: ClientMsgType.PortTransaction,
      good: 'fuel',
      quantity: 1,
      action: 'barter',
    }, ServerMsgType.PortTransactionResult);
    assert.equal(msg2.type, ServerMsgType.Error);
    assert.equal(msg2.message, 'Invalid action');

    await closeWS(wsConn);
  });

  it('trade returns error when not at a port', async () => {
    const { ws: wsConn } = await ws();
    let noPortSector = null;
    for (let i = 1; i <= 100; i++) {
      const res = await wsRequest(wsConn, { type: ClientMsgType.PortInfo, sectorId: i }, ServerMsgType.PortInfoResult);
      if (res.type === ServerMsgType.Error) { noPortSector = i; break; }
    }
    assert.ok(noPortSector, 'All sectors have ports');

    const reached = await movePlayerTo(wsConn, noPortSector);
    assert.ok(reached, `Could not reach sector ${noPortSector}`);

    const msg = await wsRequest(wsConn, {
      type: ClientMsgType.PortTransaction,
      good: 'fuel',
      quantity: 1,
      action: 'buy',
    }, ServerMsgType.PortTransactionResult);
    assert.equal(msg.type, ServerMsgType.Error);
    assert.equal(msg.message, 'No port in this sector');

    await closeWS(wsConn);
  });

  it('concurrent trades do not corrupt port inventory', async () => {
    const { ws: ws1, welcome: w1 } = await ws();
    const { ws: ws2, welcome: w2 } = await ws();

    const portSector = await findPortSector(ws1);
    assert.ok(portSector, 'No ports found');

    const r1 = await movePlayerTo(ws1, portSector.sectorId);
    const r2 = await movePlayerTo(ws2, portSector.sectorId);
    assert.ok(r1 && r2, 'Could not move both players to port');

    // Find a port that sells fuel for this test
    const sellingPort = await findPortSelling(ws1, 'fuel');
    if (!sellingPort) {
      // Skip if no port sells fuel — can't test concurrent buys
      await closeWS(ws1);
      await closeWS(ws2);
      return;
    }

    await movePlayerTo(ws1, sellingPort.sectorId);
    await movePlayerTo(ws2, sellingPort.sectorId);

    const portBeforeTrade = await wsRequest(ws1, { type: ClientMsgType.PortInfo, sectorId: sellingPort.sectorId }, ServerMsgType.PortInfoResult);
    const availFuel = portBeforeTrade.fuel;
    const buyAmt = Math.floor(availFuel * 0.7);

    const [res1, res2] = await Promise.all([
      wsRequest(ws1, { type: ClientMsgType.PortTransaction, good: 'fuel', quantity: buyAmt, action: 'buy' }, ServerMsgType.PortTransactionResult),
      wsRequest(ws2, { type: ClientMsgType.PortTransaction, good: 'fuel', quantity: buyAmt, action: 'buy' }, ServerMsgType.PortTransactionResult),
    ]);

    const portAfter = await wsRequest(ws1, { type: ClientMsgType.PortInfo, sectorId: sellingPort.sectorId }, ServerMsgType.PortInfoResult);
    assert.ok(portAfter.fuel >= 0, `Port fuel went negative: ${portAfter.fuel}`);

    if (buyAmt * 2 > availFuel) {
      const successes = [res1, res2].filter(r => r.type === ServerMsgType.PortTransactionResult).length;
      assert.ok(successes <= 1,
        `Both trades succeeded but combined quantity (${buyAmt * 2}) exceeds available (${availFuel})`);
    }

    await closeWS(ws1);
    await closeWS(ws2);
  });
});

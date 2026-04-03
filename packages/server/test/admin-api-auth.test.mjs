import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPool, createRegularUser,
  adminPost, adminGet, adminPut, adminDelete,
  setupAdminTests, teardownAdminTests,
} from './admin-helpers.mjs';

let pool;
let serverProc;

before(async () => {
  ({ pool, serverProc } = await setupAdminTests());
});

after(async () => {
  await teardownAdminTests(pool, serverProc);
});

describe('Admin API - Authentication', () => {
  it('POST /api/admin/universes/generate rejects unauthenticated requests', async () => {
    const res = await adminPost('/api/admin/universes/generate', { name: 'Test', sectors: 20 }, null);
    assert.equal(res.status, 403);
  });

  it('POST /api/admin/universes/generate rejects non-admin users', async () => {
    const { token } = await createRegularUser(pool);
    const res = await adminPost('/api/admin/universes/generate', { name: 'Test', sectors: 20 }, token);
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/universes/:id/stats rejects unauthenticated requests', async () => {
    const res = await adminGet('/api/admin/universes/999/stats', null);
    assert.equal(res.status, 403);
  });

  it('DELETE /api/admin/universes/:id rejects unauthenticated requests', async () => {
    const res = await adminDelete('/api/admin/universes/999', null);
    assert.equal(res.status, 403);
  });

  it('PUT /api/admin/universes/:id rejects unauthenticated requests', async () => {
    const res = await adminPut('/api/admin/universes/999', { name: 'New' }, null);
    assert.equal(res.status, 403);
  });

  it('POST /api/admin/universes/:id/clone rejects unauthenticated requests', async () => {
    const res = await adminPost('/api/admin/universes/999/clone', { name: 'Clone' }, null);
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/universes/:id/topology rejects unauthenticated requests', async () => {
    const res = await adminGet('/api/admin/universes/999/topology', null);
    assert.equal(res.status, 403);
  });

  it('GET /api/admin/universes/:id/ports rejects unauthenticated requests', async () => {
    const res = await adminGet('/api/admin/universes/999/ports', null);
    assert.equal(res.status, 403);
  });

  it('PUT /api/admin/universes/:id/ports/:sectorId rejects unauthenticated requests', async () => {
    const res = await adminPut('/api/admin/universes/999/ports/1', { fuel: 100 }, null);
    assert.equal(res.status, 403);
  });

  it('POST /api/admin/universes/:id/ports/:sectorId rejects unauthenticated requests', async () => {
    const res = await adminPost('/api/admin/universes/999/ports/1', { class: 1 }, null);
    assert.equal(res.status, 403);
  });

  it('DELETE /api/admin/universes/:id/ports/:sectorId rejects unauthenticated requests', async () => {
    const res = await adminDelete('/api/admin/universes/999/ports/1', null);
    assert.equal(res.status, 403);
  });
});

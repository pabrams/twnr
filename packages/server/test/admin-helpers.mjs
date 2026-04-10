import { BASE, JWT_SECRET, ADMIN_API_KEY, createTestUserWithToken } from './global-setup.mjs';

export { JWT_SECRET, ADMIN_API_KEY, BASE };

export async function createAdminUser(pool) {
  return createTestUserWithToken(pool, { role: 'admin' });
}

export async function createRegularUser(pool) {
  return createTestUserWithToken(pool, { role: 'player' });
}

export async function adminPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Cookie'] = `twnr_auth=${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminGet(path, token) {
  const headers = {};
  if (token) headers['Cookie'] = `twnr_auth=${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminPut(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Cookie'] = `twnr_auth=${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminDelete(path, token) {
  const headers = {};
  if (token) headers['Cookie'] = `twnr_auth=${token}`;
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminKeyPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminKeyGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Admin-Key': ADMIN_API_KEY },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminKeyDelete(path) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Key': ADMIN_API_KEY },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

export async function adminKeyPut(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_API_KEY },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

// BFS connectivity check
export function isConnected(sectorCount, warps) {
  const adj = new Map();
  for (let i = 1; i <= sectorCount; i++) adj.set(i, []);
  for (const w of warps) {
    if (adj.has(w.sector_from)) adj.get(w.sector_from).push(w.sector_to);
  }
  const visited = new Set();
  const queue = [1];
  visited.add(1);
  while (queue.length > 0) {
    const node = queue.shift();
    for (const next of (adj.get(node) || [])) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited.size === sectorCount;
}

import pg from 'pg';
import { spawn } from 'node:child_process';

const { Pool } = pg;

export function createPool() {
  return new Pool({
    host:     process.env.PGHOST     || 'localhost',
    database: process.env.PGDATABASE || 'twnr',
    user:     process.env.PGUSER     || 'twnr_user',
    password: process.env.PGPASSWORD || 'twnr_pass',
  });
}

export function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['dist/server.js'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
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

export function connectWS() {
  return import('ws').then(({ default: WebSocket }) => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://localhost:3000');
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS connect timeout')); }, 5000);

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'welcome') {
          clearTimeout(timer);
          resolve({ ws, welcome: msg });
        }
      });
      ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
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
  const res = await fetch(`http://localhost:3000${path}`);
  return { status: res.status, body: await res.json() };
}

export async function httpPost(path, data) {
  const res = await fetch(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export async function findPortSector() {
  for (let i = 1; i <= 100; i++) {
    const res = await httpGet(`/api/port/${i}`);
    if (res.status === 200) return { sectorId: i, port: res.body };
  }
  return null;
}

export async function findPortSelling(good) {
  for (let i = 1; i <= 100; i++) {
    const res = await httpGet(`/api/port/${i}`);
    if (res.status === 200) {
      const actions = PORT_CLASS_ACTIONS[res.body.class];
      if (actions && actions[good] === 'S') return { sectorId: i, port: res.body };
    }
  }
  return null;
}

export async function findPortBuying(good) {
  for (let i = 1; i <= 100; i++) {
    const res = await httpGet(`/api/port/${i}`);
    if (res.status === 200) {
      const actions = PORT_CLASS_ACTIONS[res.body.class];
      if (actions && actions[good] === 'B') return { sectorId: i, port: res.body };
    }
  }
  return null;
}

export async function movePlayerTo(ws, targetSector) {
  const dispPromise = waitForMsg(ws, 'sectorDisplay');
  ws.send(JSON.stringify({ type: 'display' }));
  const disp = await dispPromise;
  if (disp.sector === targetSector) return true;

  const routeRes = await httpGet(`/api/route/${disp.sector}/${targetSector}`);
  if (routeRes.status !== 200) return false;

  for (let i = 1; i < routeRes.body.path.length; i++) {
    const movePromise = waitForMsg(ws, 'playerMoved');
    ws.send(JSON.stringify({ type: 'move', sector: routeRes.body.path[i] }));
    await movePromise;
  }
  return true;
}

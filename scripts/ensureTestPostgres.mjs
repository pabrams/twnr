#!/usr/bin/env node
/**
 * Ensures a PostgreSQL instance is running for tests.
 * If the system postgres is already up, does nothing.
 * Otherwise, initialises and starts a user-owned cluster at
 * ~/.local/share/twnr-test-pg so no sudo is required.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DATA_DIR = join(homedir(), '.local', 'share', 'twnr-test-pg');
const LOG_FILE = join(homedir(), '.local', 'share', 'twnr-test-pg.log');
const PG_PORT  = process.env.PGPORT || '5432';
const PG_HOST  = process.env.PGHOST || 'localhost';

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', stdio: 'inherit', ...opts });
}

function pgIsReady() {
  const r = spawnSync('pg_isready', ['-h', PG_HOST, '-p', PG_PORT, '-q'], { encoding: 'utf8' });
  return r.status === 0;
}

function psql(sql) {
  return spawnSync(
    'psql',
    ['-h', PG_HOST, '-p', PG_PORT, '-d', 'postgres', '-c', sql],
    { encoding: 'utf8' }
  );
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

if (pgIsReady()) {
  console.log('PostgreSQL already running.');
  process.exit(0);
}

console.log('PostgreSQL not running – starting user-owned test cluster…');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
  console.log(`initdb → ${DATA_DIR}`);
  const init = run('initdb', ['-D', DATA_DIR, '--no-locale', '--encoding=UTF8', '-A', 'trust']);
  if (init.status !== 0) { console.error('initdb failed'); process.exit(1); }

  const hba = join(DATA_DIR, 'pg_hba.conf');
  const hbaLines = readFileSync(hba, 'utf8')
    .split('\n')
    .map(l => l.startsWith('host') ? l.replace(/\b(ident|peer|scram-sha-256)\b/, 'trust') : l)
    .join('\n');
  writeFileSync(hba, hbaLines);
}

console.log('pg_ctl start…');
const start = run('pg_ctl', ['-D', DATA_DIR, '-l', LOG_FILE, '-o', `-p ${PG_PORT} -k /tmp`, 'start']);
if (start.status !== 0) { console.error('pg_ctl start failed'); process.exit(1); }

for (let i = 0; i < 60; i++) {
  if (pgIsReady()) break;
  await sleep(500);
}
if (!pgIsReady()) { console.error('Postgres did not become ready in time'); process.exit(1); }

const userExists = psql("SELECT 1 FROM pg_roles WHERE rolname='twnr_user'");
if (!userExists.stdout.includes('(1 row)')) {
  console.log('Creating role twnr_user…');
  psql("CREATE USER twnr_user WITH PASSWORD 'twnr_pass'");
}

const dbExists = spawnSync(
  'psql', ['-h', PG_HOST, '-p', PG_PORT, '-d', 'postgres', '-tAc',
           "SELECT 1 FROM pg_database WHERE datname='twnr_test'"],
  { encoding: 'utf8' }
);
if (!dbExists.stdout.trim().includes('1')) {
  console.log('Creating database twnr_test…');
  run('createdb', ['-h', PG_HOST, '-p', PG_PORT, '-O', 'twnr_user', 'twnr_test']);
}

console.log('PostgreSQL test cluster ready.');

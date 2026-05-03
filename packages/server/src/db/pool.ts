import { Pool, Client } from 'pg';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';

/**
 * Per-worktree DB isolation: when PGDATABASE is unset, derive
 * `<sanitized_leaf>_<8-char-sha256-of-toplevel-path>`. The hash suffix
 * keeps two unrelated clones at e.g. `~/repos/twnr` and `~/scratch/twnr`
 * from colliding on the same DB. PGDATABASE always wins (production sets
 * it explicitly in docker-compose.production.yml). Falls back to cwd if
 * git is unavailable (e.g. stripped container).
 */
function deriveDatabaseName(): string {
    if (process.env.PGDATABASE) return process.env.PGDATABASE;
    let root: string;
    try {
        root = execSync('git rev-parse --show-toplevel', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        root = process.cwd();
    }
    const sanitized =
        path
            .basename(root)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'twnr';
    const hash = createHash('sha256').update(root).digest('hex').slice(0, 8);
    return `${sanitized}_${hash}`;
}

export const databaseName = deriveDatabaseName();

export const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    database: databaseName,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
});

/**
 * Connect to the `postgres` system DB and CREATE DATABASE if missing. Safe to
 * call multiple times. Identifier is sanitized in deriveDatabaseName, so the
 * quoted interpolation below cannot inject SQL.
 */
export async function ensureDatabase(): Promise<void> {
    const admin = new Client({
        host: process.env.PGHOST || 'localhost',
        database: 'postgres',
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
    });
    await admin.connect();
    try {
        const res = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
            databaseName,
        ]);
        if (res.rowCount === 0) {
            await admin.query(`CREATE DATABASE "${databaseName}"`);
            console.log(`Created database: ${databaseName}`);
        }
    } finally {
        await admin.end();
    }
}

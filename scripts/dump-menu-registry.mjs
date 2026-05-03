#!/usr/bin/env node
/**
 * Dumps the menu registry from the database to docs/menu-registry.json.
 * Uses psql via a .sql file (no node pg dependency needed).
 * Falls back gracefully if DB is unavailable.
 */
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import { basename, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'docs', 'menu-registry.json');
const sqlPath = join(__dirname, 'menu-registry.sql');

function deriveDatabaseName() {
    if (process.env.PGDATABASE) return process.env.PGDATABASE;
    let root;
    try {
        root = execSync('git rev-parse --show-toplevel', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        root = process.cwd();
    }
    const sanitized =
        basename(root)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '') || 'twnr';
    const hash = createHash('sha256').update(root).digest('hex').slice(0, 8);
    return `${sanitized}_${hash}`;
}

try {
    const env = {
        ...process.env,
        PGDATABASE: deriveDatabaseName(),
        PGUSER: process.env.PGUSER || 'twnr_user',
        PGPASSWORD: process.env.PGPASSWORD || 'twnr_pass',
    };
    if (!env.PGHOST) env.PGHOST = 'localhost';

    const result = execSync(`psql -t -A -f "${sqlPath}"`, {
        encoding: 'utf8',
        env,
        timeout: 5000,
    }).trim();

    const registry = JSON.parse(result);
    writeFileSync(outPath, JSON.stringify(registry, null, 2));
    console.log(`Menu registry dumped to docs/menu-registry.json (${registry.length} menus)`);
} catch (err) {
    console.warn(`Could not dump menu registry: ${err.message?.split('\n')[0]}`);
    console.warn('Docs will use existing menu-registry.json if available.');
}

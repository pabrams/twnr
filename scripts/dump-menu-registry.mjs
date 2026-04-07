#!/usr/bin/env node
/**
 * Dumps the menu registry from the database to docs/menu-registry.json.
 * Uses psql via a .sql file (no node pg dependency needed).
 * Falls back gracefully if DB is unavailable.
 */
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '..', 'docs', 'menu-registry.json');
const sqlPath = join(__dirname, 'menu-registry.sql');

try {
    const env = {
        ...process.env,
        PGDATABASE: process.env.PGDATABASE || 'twnr',
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

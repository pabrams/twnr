#!/usr/bin/env node
/**
 * erd.mjs — regenerate the ER diagram from schema.ts, and keep its layout.
 *
 *   pnpm erd               schema.ts → throwaway DB → pg_dump → docs/twnr.erd.json,
 *                          then apply erd/layout.json (positions, colours, memos)
 *   pnpm erd:save-layout   read docs/twnr.erd.json (after you've dragged things
 *                          around in the editor) back into erd/layout.json
 *
 * schema.ts is the source of truth. The dump and docs/twnr.erd.json are build
 * output (docs/ is gitignored; the erd-editor gives every entity a fresh random
 * id on each import, so the .erd.json would diff noisily anyway). Only
 * erd/layout.json is tracked: it maps table names to x/y/colour, so applying it
 * is deterministic — same schema + same layout file = same diagram.
 *
 * Needs: Postgres running, PGUSER/PGPASSWORD/PGHOST in packages/server/.env
 * (the user needs CREATEDB, which twnr's setup already requires), pg_dump on
 * PATH, and the erd-editor MCP server: set ERD_MCP to the path of a built
 * erd-editor-mcp.js (e.g. in packages/server/.env), otherwise
 * `npx -y @dineug/erd-editor-mcp` is used.
 *
 * The throwaway DB (twnr_erd_tmp) is dropped before and after every run; your
 * dev and test databases are never touched.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'packages', 'server');
const ENV_FILE = path.join(SERVER_DIR, '.env');
const LAYOUT_FILE = path.join(ROOT, 'erd', 'layout.json');
const ERD_FILE = path.join(ROOT, 'docs', 'twnr.erd.json');
const TMP_DB = 'twnr_erd_tmp';
const BATCH_LIMIT = 100; // erd_batch takes at most 100 operations
const UNPLACED_GAP = 80;

if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const command = process.argv[2] ?? 'generate';
if (command === 'generate') await generate();
else if (command === 'save-layout') saveLayout();
else {
    console.error(`Unknown command "${command}". Use "generate" or "save-layout".`);
    process.exit(1);
}

// ---------------------------------------------------------------------------

async function generate() {
    const sql = dumpSchemaFromFreshDatabase();
    const layout = readLayout();

    rmSync(ERD_FILE, { force: true });
    const mcp = await startMcp();
    try {
        const p = ERD_FILE;
        await mcp.call('erd_open_document', { path: p, create: true });
        await mcp.call('erd_set_database', { path: p, value: 'PostgreSQL' });
        await mcp.call('erd_import_sql', { path: p, value: sql });

        const tables = await listTables(mcp, p);
        const report = await applyLayout(mcp, p, tables, layout);

        console.log(`\nWrote ${path.relative(ROOT, ERD_FILE)}: ${tables.length} tables.`);
        if (report.unplaced.length) {
            console.log(
                `\nNot in erd/layout.json (placed in a row below the diagram — drag them ` +
                    `into place, then run pnpm erd:save-layout):\n  ${report.unplaced.join('\n  ')}`,
            );
        }
        if (report.missing.length) {
            console.log(
                `\nIn erd/layout.json but no longer in the schema (run pnpm erd:save-layout ` +
                    `to drop them):\n  ${report.missing.join('\n  ')}`,
            );
        }
    } finally {
        mcp.close();
    }
}

/**
 * Run schema.ts's connectDB() (straight from source via tsx, so neither a stale
 * dist/ nor a type error elsewhere in the server gets in the way) against a
 * throwaway DB, dump it, drop it.
 */
function dumpSchemaFromFreshDatabase() {
    const pgEnv = { ...process.env, PGDATABASE: TMP_DB };
    dropTmpDb(pgEnv);
    try {
        // connectDB() creates PGDATABASE if missing; it reads config/ relative to cwd.
        const src = file => JSON.stringify(pathToFileURL(path.join(SERVER_DIR, 'src', 'db', file)).href);
        const init = [
            `const { connectDB } = await import(${src('schema.ts')});`,
            `const { pool } = await import(${src('pool.ts')});`,
            'await connectDB();',
            'await pool.end();',
            'process.exit(0);',
        ].join('\n');
        run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', init], {
            cwd: SERVER_DIR,
            env: pgEnv,
        });

        const dump = run(
            'pg_dump',
            ['-h', pgEnv.PGHOST || 'localhost', '--schema-only', '--no-owner', '--no-privileges'],
            { env: pgEnv, capture: true },
        );
        return dump;
    } finally {
        dropTmpDb(pgEnv);
    }
}

function dropTmpDb(env) {
    run('dropdb', ['-h', env.PGHOST || 'localhost', '--if-exists', TMP_DB], { env });
}

/** All tables as { id, name, x, y, width, height }, following erd_list's pages. */
async function listTables(mcp, p) {
    const tables = [];
    let offset = 0;
    for (;;) {
        const page = await mcp.call('erd_list', { path: p, offset, limit: 100 });
        tables.push(...page.tables);
        if (page.nextOffset == null) return tables;
        offset = page.nextOffset;
    }
}

async function applyLayout(mcp, p, tables, layout) {
    const byName = new Map(tables.map(t => [t.name, t]));
    const known = tables.filter(t => layout.tables[t.name]);
    const unplaced = tables
        .filter(t => !layout.tables[t.name])
        .sort((a, b) => a.name.localeCompare(b.name));
    const missing = Object.keys(layout.tables)
        .filter(name => !byName.has(name))
        .sort();

    // New tables go in one row under everything the layout places.
    const bottoms = [
        ...known.map(t => layout.tables[t.name].y + t.height),
        ...layout.memos.map(m => m.y + m.height),
    ];
    let x = 0;
    const rowY = (bottoms.length ? Math.max(...bottoms) : 0) + UNPLACED_GAP * 2;
    const unplacedPositions = unplaced.map(t => {
        const pos = { tableId: t.id, x, y: rowY };
        x += t.width + UNPLACED_GAP;
        return pos;
    });

    // Each group is an atomic list of operations (memo ops refer to their $memo).
    const groups = [];
    const positions = [
        ...known.map(t => ({ tableId: t.id, x: layout.tables[t.name].x, y: layout.tables[t.name].y })),
        ...unplacedPositions,
    ];
    if (positions.length) groups.push([{ tool: 'erd_move_tables', args: { positions } }]);
    for (const t of known) {
        const color = layout.tables[t.name].color;
        if (color) groups.push([{ tool: 'erd_change_table_color', args: { tableId: t.id, color } }]);
    }
    layout.memos.forEach((m, i) => {
        // `as` names must be unique within one erd_batch.
        const as = `memo${i}`;
        const ref = `$${as}`;
        groups.push([
            { tool: 'erd_add_memo', as, args: {} },
            { tool: 'erd_change_memo_value', args: { memoId: ref, value: m.value } },
            { tool: 'erd_resize_memo', args: { memoId: ref, width: m.width, height: m.height } },
            { tool: 'erd_move_memo', args: { memoId: ref, x: m.x, y: m.y } },
            ...(m.color ? [{ tool: 'erd_change_memo_color', args: { memoId: ref, color: m.color } }] : []),
        ]);
    });

    let batch = [];
    const flush = async () => {
        if (batch.length) await mcp.call('erd_batch', { path: p, operations: batch });
        batch = [];
    };
    for (const g of groups) {
        if (batch.length + g.length > BATCH_LIMIT) await flush();
        batch.push(...g);
    }
    await flush();

    return { unplaced: unplaced.map(t => t.name), missing };
}

// ---------------------------------------------------------------------------

/** docs/twnr.erd.json → erd/layout.json, sorted so the file diffs cleanly. */
function saveLayout() {
    if (!existsSync(ERD_FILE)) {
        console.error(`${path.relative(ROOT, ERD_FILE)} does not exist; run pnpm erd first.`);
        process.exit(1);
    }
    const doc = JSON.parse(readFileSync(ERD_FILE, 'utf8'));
    const tableEntities = doc.collections.tableEntities ?? {};
    const memoEntities = doc.collections.memoEntities ?? {};

    const tables = {};
    for (const id of [...doc.doc.tableIds].sort((a, b) =>
        tableEntities[a].name.localeCompare(tableEntities[b].name),
    )) {
        const { name, ui } = tableEntities[id];
        tables[name] = {
            x: Math.round(ui.x),
            y: Math.round(ui.y),
            ...(ui.color ? { color: ui.color } : {}),
        };
    }

    const memos = doc.doc.memoIds
        .map(id => memoEntities[id])
        .map(({ value, ui }) => ({
            value,
            x: Math.round(ui.x),
            y: Math.round(ui.y),
            width: Math.round(ui.width),
            height: Math.round(ui.height),
            ...(ui.color ? { color: ui.color } : {}),
        }))
        .sort((a, b) => a.y - b.y || a.x - b.x || a.value.localeCompare(b.value));

    writeFileSync(LAYOUT_FILE, JSON.stringify({ tables, memos }, null, 2) + '\n');
    console.log(
        `Wrote ${path.relative(ROOT, LAYOUT_FILE)}: ${Object.keys(tables).length} tables, ${memos.length} memos.`,
    );
}

function readLayout() {
    if (!existsSync(LAYOUT_FILE)) return { tables: {}, memos: [] };
    const layout = JSON.parse(readFileSync(LAYOUT_FILE, 'utf8'));
    return { tables: layout.tables ?? {}, memos: layout.memos ?? [] };
}

// ---------------------------------------------------------------------------

function run(cmd, args, { cwd = ROOT, env = process.env, capture = false } = {}) {
    const res = spawnSync(cmd, args, {
        cwd,
        env,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    if (res.error) throw new Error(`${cmd}: ${res.error.message}`);
    if (res.status !== 0) throw new Error(`${cmd} ${args[0] ?? ''} exited with ${res.status}`);
    return res.stdout;
}

/** A minimal MCP stdio client for the erd-editor MCP server. */
async function startMcp() {
    const [cmd, args] = process.env.ERD_MCP
        ? [process.execPath, [process.env.ERD_MCP]]
        : ['npx', ['-y', '@dineug/erd-editor-mcp']];
    const proc = spawn(cmd, args, { cwd: ROOT, stdio: ['pipe', 'pipe', 'inherit'] });
    const pending = new Map();
    let nextId = 1;
    let exited = null;

    proc.on('exit', code => {
        exited = new Error(`erd-editor MCP server exited (${code})`);
        for (const { reject } of pending.values()) reject(exited);
        pending.clear();
    });
    readline.createInterface({ input: proc.stdout }).on('line', line => {
        let msg;
        try {
            msg = JSON.parse(line);
        } catch {
            return;
        }
        const waiter = msg.id != null && pending.get(msg.id);
        if (!waiter) return;
        pending.delete(msg.id);
        waiter.resolve(msg);
    });

    const request = (method, params) =>
        new Promise((resolve, reject) => {
            if (exited) return reject(exited);
            const id = nextId++;
            pending.set(id, { resolve, reject });
            proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });

    await request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'twnr-erd', version: '1' },
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    return {
        async call(name, args) {
            const msg = await request('tools/call', { name, arguments: args });
            if (msg.error) throw new Error(`${name}: ${msg.error.message}`);
            const text = msg.result.content.map(c => c.text).join('\n');
            if (msg.result.isError) throw new Error(`${name}: ${text}`);
            try {
                return JSON.parse(text);
            } catch {
                return text;
            }
        },
        close() {
            proc.stdin.end();
            proc.kill();
        },
    };
}

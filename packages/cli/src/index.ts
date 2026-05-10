#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loginGuest, login, register } from './auth.js';
import { connect } from './connect.js';
import { loadSession, clearSession } from './session.js';
import { listCommands, showCommand } from './meta.js';

const DEFAULT_HOST = process.env.TWNR_HOST || 'http://localhost:3000';

const USAGE = `twnr — minimal CLI client for the twnr server

usage:
  twnr guest [--host URL]
  twnr register --name N --email E --password P [--host URL]
  twnr login --email E --password P [--host URL]
  twnr connect [--universe N] [--drain-ms N] [--debug] [--pretty]
  twnr commands [<name>]
  twnr whoami
  twnr logout

stdin/stdout for 'connect': one ClientCommand JSON per line in,
one ServerResult JSON per line out. Diagnostics on stderr.
`;

function die(msg: string, code = 1): never {
    process.stderr.write(msg + '\n');
    process.exit(code);
}

async function main(): Promise<void> {
    process.stdout.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EPIPE') process.exit(0);
        throw err;
    });

    const [, , cmd, ...rest] = process.argv;
    if (!cmd || cmd === '-h' || cmd === '--help') {
        process.stdout.write(USAGE);
        return;
    }

    if (cmd === 'guest') {
        const { values } = parseArgs({
            args: rest,
            options: { host: { type: 'string' } },
        });
        const s = await loginGuest(values.host ?? DEFAULT_HOST);
        process.stdout.write(
            JSON.stringify({ userId: s.userId, name: s.name, universeId: s.universeId }, null, 2) +
                '\n',
        );
        return;
    }

    if (cmd === 'login') {
        const { values } = parseArgs({
            args: rest,
            options: {
                host: { type: 'string' },
                email: { type: 'string' },
                password: { type: 'string' },
            },
        });
        if (!values.email || !values.password) die('--email and --password are required');
        const s = await login(values.host ?? DEFAULT_HOST, values.email, values.password);
        process.stdout.write(JSON.stringify({ userId: s.userId }, null, 2) + '\n');
        return;
    }

    if (cmd === 'register') {
        const { values } = parseArgs({
            args: rest,
            options: {
                host: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
                password: { type: 'string' },
            },
        });
        if (!values.name || !values.email || !values.password) {
            die('--name, --email, and --password are required');
        }
        const s = await register(
            values.host ?? DEFAULT_HOST,
            values.name,
            values.email,
            values.password,
        );
        process.stdout.write(
            JSON.stringify({ userId: s.userId, name: s.name }, null, 2) + '\n',
        );
        return;
    }

    if (cmd === 'connect') {
        const { values } = parseArgs({
            args: rest,
            options: {
                universe: { type: 'string' },
                'drain-ms': { type: 'string' },
                debug: { type: 'boolean' },
                pretty: { type: 'boolean' },
            },
        });
        const session = loadSession();
        if (!session) die('No session — run `twnr guest` or `twnr login` first.');
        const universeId =
            values.universe !== undefined ? parseInt(values.universe, 10) : session.universeId;
        if (universeId === undefined || isNaN(universeId)) {
            die('--universe N is required (no universeId in session)');
        }
        const drainMs =
            values['drain-ms'] !== undefined ? parseInt(values['drain-ms'], 10) : undefined;
        const exitCode = await connect(session, universeId, {
            drainMs,
            debug: values.debug,
            pretty: values.pretty,
        });
        process.exit(exitCode);
    }

    if (cmd === 'commands') {
        const types = listCommands();
        const target = rest[0];
        if (!target) {
            for (const t of types) process.stdout.write(t + '\n');
            return;
        }
        if (!types.includes(target)) {
            die(`unknown command: ${target}\n(run \`twnr commands\` to see all)`);
        }
        const def = showCommand(target);
        if (!def) die(`No schema entry found for "${target}".`);
        process.stdout.write(JSON.stringify(def, null, 2) + '\n');
        return;
    }

    if (cmd === 'whoami') {
        const s = loadSession();
        if (!s) die('No session.');
        process.stdout.write(JSON.stringify(s, null, 2) + '\n');
        return;
    }

    if (cmd === 'logout') {
        const removed = clearSession();
        process.stdout.write(removed ? 'session cleared\n' : 'no session\n');
        return;
    }

    die(`unknown command: ${cmd}\n\n${USAGE}`);
}

main().catch((err) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});

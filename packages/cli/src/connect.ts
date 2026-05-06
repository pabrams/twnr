import { WebSocket } from 'ws';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Session } from './session.js';
import { listCommands, showCommand } from './meta.js';

const META_LIST = [
    ':?               list REPL meta-commands (this list)',
    ':help            list every server command',
    ':help <name>     JSON schema for one server command',
    ':quit            close the connection and exit',
].join('\n');

function handleMeta(line: string, ws: WebSocket, write: (s: string) => void): void {
    const [verb, ...args] = line.slice(1).trim().split(/\s+/);
    switch (verb) {
        case '?':
            write(META_LIST + '\n');
            return;
        case 'help':
        case 'h':
            if (!args[0]) {
                for (const t of listCommands()) write(t + '\n');
                return;
            }
            {
                const def = showCommand(args[0]);
                if (!def) {
                    write(`unknown command: ${args[0]} (try :help)\n`);
                    return;
                }
                write(JSON.stringify(def, null, 2) + '\n');
            }
            return;
        case 'quit':
        case 'q':
            if (ws.readyState === WebSocket.OPEN) ws.close(1000);
            return;
        default:
            write(`unknown meta: :${verb} (try :?)\n`);
    }
}

const AUTH_COOKIE_NAME = 'twnr_auth';
const PROMPT = 'twnr> ';

function toWsUrl(host: string, universeId: number): string {
    const u = new URL(host);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/ws';
    u.searchParams.set('universe', String(universeId));
    return u.toString();
}

export type ConnectOpts = {
    drainMs?: number;
    debug?: boolean;
    pretty?: boolean;
};

/**
 * Open a WS, pipe stdin → server and server → stdout (one JSON frame per line
 * each direction). When stdin is a TTY, runs in REPL mode with a prompt and
 * a clear-line dance so async server frames don't garble the user's input.
 *
 * Two protocol-level workarounds for server lifecycle quirks:
 *
 *  1. Server attaches its `ws.on('message', ...)` only after its async connect
 *     setup completes (auth/DB queries + Welcome send). Frames sent during
 *     that window are dropped because the `ws` library doesn't buffer
 *     received frames for late listeners. We queue stdin lines until the
 *     first server frame arrives, then drain.
 *
 *  2. Server's `sendEnvelope` no-ops when `ws.readyState !== OPEN`, so closing
 *     immediately on stdin EOF races the server's async handler and eats the
 *     reply. After stdin EOF we wait `drainMs` of silence on the WS before
 *     closing; the timer resets on every incoming frame so multi-message
 *     replies fully drain.
 */
export async function connect(
    session: Session,
    universeId: number,
    opts: ConnectOpts = {},
): Promise<number> {
    const drainMs = opts.drainMs ?? 500;
    const url = toWsUrl(session.host, universeId);
    const ws = new WebSocket(url, {
        headers: { Cookie: `${AUTH_COOKIE_NAME}=${session.token}` },
    });

    const isTTY = !!process.stdin.isTTY;
    let rl: ReadlineInterface | null = null;

    /** Write text that the user should see, taking care to clear the
     * current prompt line first (TTY) and re-render the prompt + cursor
     * after, so async frames don't garble in-progress input. */
    const writeOut = (text: string): void => {
        if (isTTY && rl) {
            process.stdout.write('\r\x1b[K');
            process.stdout.write(text);
            rl.prompt(true);
        } else {
            process.stdout.write(text);
        }
    };

    return new Promise((resolve) => {
        let stdinClosed = false;
        let serverReady = false;
        let drainTimer: NodeJS.Timeout | null = null;
        const pendingSends: string[] = [];

        const armDrainTimer = (): void => {
            if (drainTimer) clearTimeout(drainTimer);
            drainTimer = setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) ws.close(1000);
            }, drainMs);
        };

        const flushPending = (): void => {
            while (pendingSends.length > 0) {
                const msg = pendingSends.shift()!;
                if (ws.readyState !== WebSocket.OPEN) return;
                if (opts.debug) process.stderr.write(`[send] ${msg}\n`);
                ws.send(msg);
            }
        };

        ws.on('message', (data) => {
            const raw = data.toString();
            let formatted: string;
            if (opts.pretty) {
                try {
                    formatted = JSON.stringify(JSON.parse(raw), null, 2);
                } catch {
                    formatted = raw;
                }
            } else {
                formatted = raw;
            }
            writeOut(formatted + '\n');
            if (!serverReady) {
                serverReady = true;
                flushPending();
            }
            if (stdinClosed) armDrainTimer();
        });

        ws.on('close', (code, reason) => {
            if (drainTimer) clearTimeout(drainTimer);
            if (rl) rl.close();
            const reasonStr = reason.toString();
            process.stderr.write(
                `\n[ws closed] code=${code}${reasonStr ? ` reason=${reasonStr}` : ''}\n`,
            );
            resolve(code === 1000 ? 0 : 1);
        });

        ws.on('error', (err) => {
            process.stderr.write(`[ws error] ${err.message}\n`);
        });

        ws.on('open', () => {
            if (opts.debug) process.stderr.write(`[ws open]\n`);
            rl = createInterface({
                input: process.stdin,
                output: isTTY ? process.stdout : undefined,
                prompt: isTTY ? PROMPT : '',
                terminal: isTTY,
            });
            if (isTTY) rl.prompt();

            rl.on('line', (line) => {
                const trimmed = line.trim();
                if (!trimmed) {
                    if (isTTY && rl) rl.prompt();
                    return;
                }
                if (trimmed.startsWith(':')) {
                    handleMeta(trimmed, ws, writeOut);
                    if (isTTY && rl) rl.prompt();
                    return;
                }
                if (!serverReady) {
                    if (opts.debug) process.stderr.write(`[queue] ${trimmed}\n`);
                    pendingSends.push(trimmed);
                    if (isTTY && rl) rl.prompt();
                    return;
                }
                if (ws.readyState !== WebSocket.OPEN) return;
                if (opts.debug) process.stderr.write(`[send] ${trimmed}\n`);
                ws.send(trimmed);
                // No prompt here: the server's response will fire writeOut
                // which redraws the prompt. Showing it now would just paint
                // it twice with the response landing in between.
            });
            rl.on('close', () => {
                if (opts.debug) process.stderr.write(`[stdin EOF; draining ${drainMs}ms]\n`);
                stdinClosed = true;
                armDrainTimer();
            });
        });
    });
}

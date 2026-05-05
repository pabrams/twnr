import { WebSocket } from 'ws';
import { createInterface } from 'node:readline';
import type { Session } from './session.js';

const AUTH_COOKIE_NAME = 'twnr_auth';

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
 * each direction).
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
            if (opts.pretty) {
                try {
                    process.stdout.write(JSON.stringify(JSON.parse(raw), null, 2) + '\n');
                } catch {
                    process.stdout.write(raw + '\n');
                }
            } else {
                process.stdout.write(raw + '\n');
            }
            if (!serverReady) {
                serverReady = true;
                flushPending();
            }
            if (stdinClosed) armDrainTimer();
        });

        ws.on('close', (code, reason) => {
            if (drainTimer) clearTimeout(drainTimer);
            const reasonStr = reason.toString();
            process.stderr.write(
                `[ws closed] code=${code}${reasonStr ? ` reason=${reasonStr}` : ''}\n`,
            );
            resolve(code === 1000 ? 0 : 1);
        });

        ws.on('error', (err) => {
            process.stderr.write(`[ws error] ${err.message}\n`);
        });

        ws.on('open', () => {
            if (opts.debug) process.stderr.write(`[ws open]\n`);
            const rl = createInterface({ input: process.stdin });
            rl.on('line', (line) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                if (!serverReady) {
                    if (opts.debug) process.stderr.write(`[queue] ${trimmed}\n`);
                    pendingSends.push(trimmed);
                    return;
                }
                if (ws.readyState !== WebSocket.OPEN) return;
                if (opts.debug) process.stderr.write(`[send] ${trimmed}\n`);
                ws.send(trimmed);
            });
            rl.on('close', () => {
                if (opts.debug) process.stderr.write(`[stdin EOF; draining ${drainMs}ms]\n`);
                stdinClosed = true;
                armDrainTimer();
            });
        });
    });
}

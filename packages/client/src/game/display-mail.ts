import type { GameContext } from './types.js';
import { render } from './renderer.js';
import { EVENT } from './messages/index.js';

export type MailEntry = {
    id: number;
    senderName: string | null;
    kind: string;
    body: string;
    createdAt: string;
};

type MailCtx = Pick<GameContext, 'io'>;

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

/** "11:37:09 AM S.D. 05/13/54" — stardate-flavored locale time. */
export function formatMailTime(iso: string): string {
    const d = new Date(iso);
    const h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    const time = `${pad(h12)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
    const date = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${pad(d.getFullYear() % 100)}`;
    return `${time} S.D. ${date}`;
}

function renderBody(body: string): string[] {
    const lines = body.split(/\r?\n/);
    return lines.map((line) => render(EVENT.mailBodyLine, { line }));
}

export function renderMailEntry(ctx: MailCtx, entry: MailEntry): void {
    if (entry.senderName !== null) {
        ctx.io.term.writeln(
            render(EVENT.mailReceivedFromHeader, {
                name: entry.senderName,
                time: formatMailTime(entry.createdAt),
            }),
        );
    }
    for (const line of renderBody(entry.body)) {
        ctx.io.term.writeln(line);
    }
}

export function renderMailEntries(ctx: MailCtx, entries: MailEntry[]): void {
    for (const m of entries) renderMailEntry(ctx, m);
}

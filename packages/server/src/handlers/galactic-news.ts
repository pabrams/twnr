import { ServerTag, GameEventSchema, type ReadGalacticNewsCommand } from '@twnr/shared';
import type { GalacticNewsEntry } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { sendEnvelope, sendError } from '../state/messaging.js';
import {
    getEarliestGalacticNewsAt,
    listGalacticNewsSince,
    type GalacticNewsRow,
} from '../db/queries/game-events.js';

function toNewsEntry(row: GalacticNewsRow): GalacticNewsEntry | null {
    const parsed = GameEventSchema.safeParse({ kind: row.kind, ...(row.payload as object) });
    if (!parsed.success) {
        console.error(`Unrenderable game event ${row.id} (${row.kind}):`, parsed.error.issues);
        return null;
    }
    return { id: row.id, createdAt: row.created_at.toISOString(), event: parsed.data };
}

export async function serveGalacticNewsRange(playerId: number): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;
    const earliest = await getEarliestGalacticNewsAt(player.universeId);
    sendEnvelope(playerId, {
        type: ServerTag.GalacticNewsRangeResult,
        earliestCreatedAt: earliest?.toISOString() ?? null,
    });
}

export async function serveReadGalacticNews(
    playerId: number,
    data: ReadGalacticNewsCommand,
): Promise<void> {
    const player = onlinePlayers[playerId];
    if (!player) return;
    const since = new Date(data.since);
    if (Number.isNaN(since.getTime())) {
        sendError(playerId, 'Invalid news date');
        return;
    }
    const rows = await listGalacticNewsSince(player.universeId, since);
    sendEnvelope(playerId, {
        type: ServerTag.GalacticNewsResult,
        entries: rows.map(toNewsEntry).filter((entry) => entry !== null),
    });
}

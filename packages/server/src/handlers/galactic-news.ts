import { GameEventSchema, type CommandRequest } from '@twnr/shared';
import type { GalacticNewsEntry } from '@twnr/shared';
import { requireOnlinePlayer } from '../state/players.js';
import {
    getEarliestGalacticNewsAt,
    listGalacticNewsSince,
    type GalacticNewsRow,
} from '../db/queries/game-events.js';
import { type CommandResult } from './command.js';

const NEWS_CHUNK_SIZE = 200;

function toNewsEntry(row: GalacticNewsRow): GalacticNewsEntry | null {
    const parsed = GameEventSchema.safeParse({ kind: row.kind, ...(row.payload as object) });
    if (!parsed.success) {
        console.error(`Unrenderable game event ${row.id} (${row.kind}):`, parsed.error.issues);
        return null;
    }
    return { id: row.id, createdAt: row.created_at.toISOString(), event: parsed.data };
}

export async function serveGalacticNewsRange(
    playerId: number,
): Promise<CommandResult<'GalacticNewsRange'>> {
    const player = requireOnlinePlayer(playerId);
    const earliest = await getEarliestGalacticNewsAt(player.universeId);
    return {
        earliestCreatedAt: earliest?.toISOString() ?? null,
    };
}

export async function serveReadGalacticNews(
    playerId: number,
    data: CommandRequest<'ReadGalacticNews'>,
): Promise<CommandResult<'ReadGalacticNews'>> {
    const player = requireOnlinePlayer(playerId);
    const since = new Date(data.since);
    const rows = await listGalacticNewsSince(
        player.universeId,
        since,
        data.afterId ?? 0,
        NEWS_CHUNK_SIZE + 1,
    );
    const hasMore = rows.length > NEWS_CHUNK_SIZE;
    const chunk = hasMore ? rows.slice(0, NEWS_CHUNK_SIZE) : rows;
    return {
        entries: chunk.map(toNewsEntry).filter((entry) => entry !== null),
        hasMore,
    };
}

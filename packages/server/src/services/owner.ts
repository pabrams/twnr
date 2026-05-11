/**
 * Canonical owner reference used by every asset that can be player-owned
 * OR clan-owned OR rogue (abandoned). Display code consumes OwnerRef so
 * the dual-column storage (`owner_player_id` + `owner_clan_id`) stays out
 * of UI layers.
 *
 * Resolution is intentionally NOT a query: callers should LEFT JOIN the
 * player and clan rows when fetching the asset so `resolveOwner` can run
 * against the already-fetched row. This avoids per-row N+1 lookups for
 * list displays (sector ship listing, planet listing, mine list, etc.).
 */

export type OwnerRef =
    | { kind: 'player'; playerId: number; name: string }
    | { kind: 'clan'; clanId: number; clanNumber: number; name: string }
    | { kind: 'rogue' };

export type OwnerJoinCols = {
    owner_player_id: number | null;
    owner_clan_id: number | null;
    owner_player_name?: string | null;
    owner_clan_name?: string | null;
    owner_clan_number?: number | null;
};

export function resolveOwner(row: OwnerJoinCols): OwnerRef {
    if (row.owner_player_id !== null && row.owner_player_id !== undefined) {
        return {
            kind: 'player',
            playerId: row.owner_player_id,
            name: row.owner_player_name ?? '',
        };
    }
    if (row.owner_clan_id !== null && row.owner_clan_id !== undefined) {
        return {
            kind: 'clan',
            clanId: row.owner_clan_id,
            clanNumber: row.owner_clan_number ?? 0,
            name: row.owner_clan_name ?? '',
        };
    }
    return { kind: 'rogue' };
}

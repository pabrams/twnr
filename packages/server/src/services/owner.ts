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

/** True iff the owned row belongs to the given player personally or to
 *  their clan. Used to gate friendly-vs-enemy checks (mine encounters,
 *  drone encounters, deploy-onto-friendly, etc.). */
export function isFriendlyOwner(
    row: Pick<OwnerJoinCols, 'owner_player_id' | 'owner_clan_id'>,
    playerId: number,
    playerClanId: number | null,
): boolean {
    if (row.owner_player_id === playerId) return true;
    if (playerClanId !== null && row.owner_clan_id === playerClanId) return true;
    return false;
}

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

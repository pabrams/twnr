/**
 * Canonical owner-text formatting used everywhere clan-or-player ownership
 * is rendered. Consumes the LEFT-JOINed clan/player names so callers don't
 * incur extra queries per row.
 *
 * Format:
 *   - player-owned: `Bob`            (bare name, no brackets)
 *   - clan-owned:   `(#2 Crimson Tide)`
 *   - rogue:        `(Rogue)`
 */

export type OwnerJoinCols = {
    owner_player_id: number | null;
    owner_clan_id: number | null;
    owner_player_name?: string | null;
    owner_clan_name?: string | null;
    owner_clan_number?: number | null;
};

export function formatOwner(row: OwnerJoinCols): string {
    if (row.owner_player_id !== null && row.owner_player_id !== undefined) {
        return row.owner_player_name ?? '';
    }
    if (row.owner_clan_id !== null && row.owner_clan_id !== undefined) {
        return `(#${row.owner_clan_number ?? '?'} ${row.owner_clan_name ?? 'Clan'})`;
    }
    return '(Rogue)';
}

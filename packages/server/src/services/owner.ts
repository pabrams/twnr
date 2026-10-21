// Resolution is deliberately not a query: fetchers LEFT JOIN the player/clan
// rows so resolveOwner runs on the already-fetched row (no per-row N+1).

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

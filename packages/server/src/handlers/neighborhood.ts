import { ServerMsgType } from '@twnr/shared';
import type { NeighborhoodResultObject, NeighborhoodSector, NeighborhoodWarp } from '@twnr/shared';
import { players, sendEnvelope } from '../game-state.js';
import { getUniverseTopology } from '../db/queries/universe.js';
import {
    listVisitedSectorsForUniverse,
    listPlanetObservationsForSectors,
} from '../db/queries/observations.js';
import { pool } from '../db/pool.js';

const DEFAULT_DEPTH = 3;
const MIN_DEPTH = 1;
const MAX_DEPTH = 200;

/**
 * Clamp a raw depth value: floor + clamp to [1, MAX_DEPTH]; fall back to the
 * default for NaN/±Infinity. Non-numeric is rejected earlier at the wire
 * layer. The cap exists only to bound BFS work; non-admins are scoped by
 * their visited set anyway, so a high request just reaches the edge of what
 * they've explored. The client sets depth dynamically from its zoom level.
 */
function normalizeDepth(raw: number): number {
    if (!Number.isFinite(raw)) return DEFAULT_DEPTH;
    const floored = Math.floor(raw);
    if (floored < MIN_DEPTH) return MIN_DEPTH;
    if (floored > MAX_DEPTH) return MAX_DEPTH;
    return floored;
}

export async function handleGetNeighborhood(playerId: number, depth: number): Promise<void> {
    const player = players[playerId];
    if (!player) return;
    const universeId = player.universeId;
    const currentSectorId = player.sectorId;
    const isAdmin = player.isAdmin === true;
    const normalizedDepth = normalizeDepth(depth);

    const topology = await getUniverseTopology(universeId);

    // Random-topology universes: return empty payload — client renders a
    // "no map data" state. Never leak positions here even though x/y are NULL.
    if (topology === 'random') {
        const payload: NeighborhoodResultObject = {
            type: ServerMsgType.NeighborhoodResult,
            topology: 'random',
            current_sector_id: currentSectorId,
            sectors: [],
            warps: [],
        };
        sendEnvelope(playerId, payload);
        return;
    }

    // Visited sectors: full-information view. Admins see every sector in the
    // universe as if visited (no fog), so the BFS reaches the whole graph and
    // ports/planets render normally for any sector that has been observed.
    const visited = await listVisitedSectorsForUniverse(playerId, universeId);
    const visitedIds = new Set<number>();
    const visitedById = new Map<number, (typeof visited)[number]>();
    for (const row of visited) {
        visitedIds.add(row.id);
        visitedById.set(row.id, row);
    }

    // All warps in this universe as (from_id, to_id) plus sector-number/x/y
    // lookup. Pulled once and filtered locally so the BFS can look up either
    // side of any edge and return sector metadata (sector_number/x/y) for
    // both visited and glimpsed nodes.
    const warpRes = await pool.query<{
        from_id: number;
        to_id: number;
    }>(
        `SELECT w.from_sector_id AS from_id, w.to_sector_id AS to_id
         FROM warps w
         JOIN sectors s ON w.from_sector_id = s.id
         WHERE s.universe_id = $1`,
        [universeId],
    );

    const sectorMetaRes = await pool.query<{
        id: number;
        sector_number: number;
        x: number | null;
        y: number | null;
    }>('SELECT id, sector_number, x, y FROM sectors WHERE universe_id = $1', [universeId]);
    const sectorMeta = new Map<
        number,
        { id: number; sector_number: number; x: number | null; y: number | null }
    >();
    for (const row of sectorMetaRes.rows) {
        sectorMeta.set(row.id, row);
    }

    // Forward + reverse adjacency restricted to this universe's sectors.
    // edgeSet is the universe-wide set, used to detect confirmed one-way
    // warps when both endpoints are visited.
    const outAdj = new Map<number, number[]>();
    const inAdj = new Map<number, number[]>();
    const edgeSet = new Set<string>();
    for (const w of warpRes.rows) {
        if (!outAdj.has(w.from_id)) outAdj.set(w.from_id, []);
        outAdj.get(w.from_id)!.push(w.to_id);
        if (!inAdj.has(w.to_id)) inAdj.set(w.to_id, []);
        inAdj.get(w.to_id)!.push(w.from_id);
        edgeSet.add(`${w.from_id},${w.to_id}`);
    }

    // BFS outward from current sector, up to `depth` hops. Only visited
    // sectors may be traversed; the walk may step from a visited sector to a
    // glimpsed-only sector as the final hop but not pass through. Admins are
    // allowed to traverse every sector in the universe (no fog).
    const distance = new Map<number, number>();
    distance.set(currentSectorId, 0);
    // If the player isn't already in visitedIds (e.g. before any sector has
    // been recorded), seed it as visited so BFS has an origin.
    const traversable = isAdmin ? new Set(sectorMeta.keys()) : new Set(visitedIds);
    traversable.add(currentSectorId);
    const queue: number[] = [currentSectorId];
    const includedSectors = new Set<number>([currentSectorId]);

    while (queue.length > 0) {
        const u = queue.shift()!;
        const d = distance.get(u)!;
        if (d >= normalizedDepth) continue;

        // Forward warps: include the target (even glimpsed), but only continue
        // BFS through visited targets — you learn a sector exists by seeing
        // an outbound warp to it from somewhere you've been.
        const forward = outAdj.get(u) ?? [];
        for (const v of forward) {
            if (!sectorMeta.has(v)) continue;
            includedSectors.add(v);
            if (!traversable.has(v)) continue;
            if (!distance.has(v)) {
                distance.set(v, d + 1);
                queue.push(v);
            }
        }

        // Reverse warps: only follow when the source is a visited sector.
        // The player already knows about that sector from previous trips, so
        // this doesn't leak any information they shouldn't have — it just
        // preserves their memory of incoming one-way edges after following
        // one. Each reverse hop still costs depth, so the selected depth
        // limit is respected in both directions.
        const reverse = inAdj.get(u) ?? [];
        for (const v of reverse) {
            if (!traversable.has(v)) continue;
            if (!sectorMeta.has(v)) continue;
            includedSectors.add(v);
            if (!distance.has(v)) {
                distance.set(v, d + 1);
                queue.push(v);
            }
        }
    }

    // Fringe pass: for visited sectors exactly at the max depth, include
    // their outgoing-warp targets (one hop beyond the normal limit) so the
    // client can render those warps as directional stubs.
    const fringeIds = new Set<number>();
    for (const [u, d] of distance) {
        if (d !== normalizedDepth) continue;
        if (!traversable.has(u)) continue;
        for (const v of outAdj.get(u) ?? []) {
            if (!sectorMeta.has(v)) continue;
            if (includedSectors.has(v)) continue; // already shown fully
            includedSectors.add(v);
            fringeIds.add(v);
        }
    }

    // Build sector payloads.
    const planetRows = await listPlanetObservationsForSectors(
        playerId,
        [...visitedIds].filter((id) => includedSectors.has(id)),
    );
    const planetsBySector = new Map<
        number,
        Array<{ name: string; type: string | null; observed_at: string }>
    >();
    for (const p of planetRows) {
        if (!planetsBySector.has(p.sector_id)) planetsBySector.set(p.sector_id, []);
        planetsBySector.get(p.sector_id)!.push({
            name: p.planet_name,
            type: p.planet_type,
            observed_at: new Date(p.observed_at).toISOString(),
        });
    }

    const sectors: NeighborhoodSector[] = [];
    for (const id of includedSectors) {
        const meta = sectorMeta.get(id);
        if (!meta) continue;
        const isVisited = isAdmin || visitedIds.has(id) || id === currentSectorId;
        const visibility: 'visited' | 'glimpsed' = isVisited ? 'visited' : 'glimpsed';
        let port: NeighborhoodSector['port'] = null;
        let planets: NeighborhoodSector['planets'] = [];
        if (isVisited) {
            const vrow = visitedById.get(id);
            if (vrow && vrow.port_class !== null && vrow.port_observed_at) {
                port = {
                    class: vrow.port_class,
                    observed_at: new Date(vrow.port_observed_at).toISOString(),
                };
            }
            planets = planetsBySector.get(id) ?? [];
        }
        sectors.push({
            id: meta.id,
            sector_number: meta.sector_number,
            x: meta.x,
            y: meta.y,
            visibility,
            fringe: fringeIds.has(id),
            port,
            planets,
        });
    }

    // Warp payload: every warp whose source is visited and whose target is in
    // the neighborhood. known_two_way requires both endpoints visited AND the
    // reverse warp to exist.
    const warps: NeighborhoodWarp[] = [];
    const emittedKeys = new Set<string>();
    for (const w of warpRes.rows) {
        if (!traversable.has(w.from_id)) continue;
        if (!includedSectors.has(w.to_id)) continue;
        const knownTwoWay = traversable.has(w.to_id) && edgeSet.has(`${w.to_id},${w.from_id}`);
        const key = `${w.from_id},${w.to_id}`;
        if (emittedKeys.has(key)) continue;
        emittedKeys.add(key);
        warps.push({
            from_sector_id: w.from_id,
            to_sector_id: w.to_id,
            known_two_way: knownTwoWay,
        });
    }

    const payload: NeighborhoodResultObject = {
        type: ServerMsgType.NeighborhoodResult,
        topology: 'proximal',
        current_sector_id: currentSectorId,
        sectors,
        warps,
    };
    sendEnvelope(playerId, payload);
}

export { normalizeDepth };

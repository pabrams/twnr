import { ServerTag } from '@twnr/shared';
import type {
    NeighborhoodReply,
    NeighborhoodSector,
    NeighborhoodWarp,
    GetNeighborhoodCommand,
} from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { sendEnvelope } from '../state/messaging.js';
import { getUniverseTopology } from '../db/queries/universe.js';
import {
    listVisitedSectorsForUniverse,
    listPlanetObservationsForSectors,
} from '../db/queries/observations.js';
import { listSectorObservations } from '../services/sector-observations.js';
import { pool } from '../db/pool.js';

/** Smallest viewport extent the client may legitimately request (world units). */
const MIN_HALF_EXTENT = 50;
/** Hard upper bound to keep payloads bounded on absurdly zoomed-out admin views. */
const MAX_HALF_EXTENT = 1_000_000;
const DEFAULT_HALF_EXTENT = 600;

function clampHalfExtent(raw: number): number {
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_HALF_EXTENT;
    if (raw < MIN_HALF_EXTENT) return MIN_HALF_EXTENT;
    if (raw > MAX_HALF_EXTENT) return MAX_HALF_EXTENT;
    return raw;
}

/**
 * Return sectors within an axis-aligned bbox centered on the player's current
 * sector. With static hex positions this is a clean positional crop — no BFS
 * by hop count. Non-admin players still see only sectors they've visited (or
 * glimpsed via an outbound warp from a visited sector); admins see everything
 * within the bbox regardless of fog.
 */
export async function serveGetNeighborhood(
    playerId: number,
    data: GetNeighborhoodCommand,
): Promise<void> {
    const { halfWidthWorld, halfHeightWorld, centerXWorld, centerYWorld } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;
    const universeId = player.universeId;
    const currentSectorId = player.sectorId;
    const isAdmin = player.isAdmin === true;
    const halfW = clampHalfExtent(halfWidthWorld);
    const halfH = clampHalfExtent(halfHeightWorld);

    const topology = await getUniverseTopology(universeId);

    // Random-topology universes: positions are NULL, no map to render.
    if (topology === 'random') {
        const payload: NeighborhoodReply = {
            type: ServerTag.NeighborhoodResult,
            topology: 'random',
            current_sector_id: currentSectorId,
            sectors: [],
            warps: [],
        };
        sendEnvelope(playerId, payload);
        return;
    }

    // Pull all sector metadata for this universe (id, sector_number, x, y).
    // Cheap enough for any sane universe size; cropping happens client-side
    // would push too much data over the wire on big universes, so we filter
    // here in JS after the fetch. (TODO: DB-side bbox query would also work but
    // requires an index we don't yet have.)
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

    const currentMeta = sectorMeta.get(currentSectorId);
    // Use the client-supplied viewport center when present (zoom-toward-cursor
    // / pan), otherwise center on the player's current sector. If neither
    // exists we can't crop — bail empty.
    let cx: number;
    let cy: number;
    if (typeof centerXWorld === 'number' && typeof centerYWorld === 'number') {
        cx = centerXWorld;
        cy = centerYWorld;
    } else if (currentMeta && currentMeta.x != null && currentMeta.y != null) {
        cx = currentMeta.x;
        cy = currentMeta.y;
    } else {
        const payload: NeighborhoodReply = {
            type: ServerTag.NeighborhoodResult,
            topology: 'proximal',
            current_sector_id: currentSectorId,
            sectors: [],
            warps: [],
        };
        sendEnvelope(playerId, payload);
        return;
    }

    // Visited sectors: full-information view (port + planet observations).
    // Admins skip the visited filter and see every sector in the bbox.
    const visited = await listVisitedSectorsForUniverse(playerId, universeId);
    const visitedIds = new Set<number>();
    const visitedById = new Map<number, (typeof visited)[number]>();
    for (const row of visited) {
        visitedIds.add(row.id);
        visitedById.set(row.id, row);
    }

    // All warps in this universe — needed both for emitting result warps and
    // for computing glimpsed sectors (target of an outbound warp from a
    // visited source).
    const warpRes = await pool.query<{ from_id: number; to_id: number }>(
        `SELECT w.from_sector_id AS from_id, w.to_sector_id AS to_id
         FROM warps w
         JOIN sectors s ON w.from_sector_id = s.id
         WHERE s.universe_id = $1`,
        [universeId],
    );

    const edgeSet = new Set<string>();
    for (const w of warpRes.rows) edgeSet.add(`${w.from_id},${w.to_id}`);

    // Determine which sector ids are "in view" (positionally) — the
    // axis-aligned bbox around the current sector.
    const inBbox = new Set<number>();
    for (const meta of sectorMeta.values()) {
        if (meta.x == null || meta.y == null) continue;
        if (Math.abs(meta.x - cx) > halfW) continue;
        if (Math.abs(meta.y - cy) > halfH) continue;
        inBbox.add(meta.id);
    }

    // Visibility rule for non-admins: the sector must be visited, OR it must
    // be the target of an outbound warp from a visited sector (glimpsed).
    // Admins skip this filter entirely. We also include warp targets that
    // sit *outside* the bbox so the client can draw stub lines pointing
    // toward them — important for keeping wormhole edges visible when the
    // far end is off-screen. Such targets are flagged fringe (no pill, just
    // a position).
    const includedSectors = new Set<number>();
    const fringeIds = new Set<number>();
    const sourceKnowable = (sid: number): boolean =>
        isAdmin || visitedIds.has(sid) || sid === currentSectorId;
    if (isAdmin) {
        for (const id of inBbox) includedSectors.add(id);
    } else {
        // Always include the current sector even if visited-table is empty.
        includedSectors.add(currentSectorId);
        for (const id of inBbox) {
            if (visitedIds.has(id) || id === currentSectorId) includedSectors.add(id);
        }
        // Glimpsed-in-bbox: targets in bbox of warps from visited sources.
        for (const w of warpRes.rows) {
            if (!inBbox.has(w.to_id)) continue;
            if (includedSectors.has(w.to_id)) continue;
            if (!sourceKnowable(w.from_id)) continue;
            includedSectors.add(w.to_id);
            fringeIds.add(w.to_id);
        }
    }
    // Out-of-bbox warp targets: include them as fringe so the client can draw
    // stub lines toward them. Source must be in-bbox and knowable so we don't
    // leak warps for sectors the player can't see.
    for (const w of warpRes.rows) {
        if (!includedSectors.has(w.from_id)) continue;
        if (!sourceKnowable(w.from_id)) continue;
        if (includedSectors.has(w.to_id)) continue;
        if (!sectorMeta.has(w.to_id)) continue;
        includedSectors.add(w.to_id);
        fringeIds.add(w.to_id);
    }

    // Build planet payload only for visited sectors that made it into the
    // result (admin sees all sectors as "visited" so the same query covers
    // them — but only if observations exist, which for unexplored sectors
    // they won't).
    const planetSectorIds: number[] = [];
    for (const id of includedSectors) {
        if (isAdmin || visitedIds.has(id)) planetSectorIds.push(id);
    }
    const planetRows = await listPlanetObservationsForSectors(playerId, planetSectorIds);
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

    const visitedSectorIds: number[] = [];
    for (const id of includedSectors) {
        if (isAdmin || visitedIds.has(id) || id === currentSectorId) {
            visitedSectorIds.push(id);
        }
    }
    const observationsBySector = await listSectorObservations(playerId, visitedSectorIds);

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
        const obs = isVisited ? observationsBySector.get(id) : undefined;
        sectors.push({
            id: meta.id,
            sector_number: meta.sector_number,
            x: meta.x,
            y: meta.y,
            visibility,
            fringe: fringeIds.has(id),
            port,
            planets,
            ...(obs ? { observations: obs } : {}),
        });
    }

    // Warp payload: every warp whose source is "knowable" by the player
    // (visited for non-admin, anything for admin) and whose target is in the
    // result. known_two_way needs both endpoints knowable + reverse edge.
    const warps: NeighborhoodWarp[] = [];
    const emittedKeys = new Set<string>();
    for (const w of warpRes.rows) {
        if (!sourceKnowable(w.from_id)) continue;
        if (!includedSectors.has(w.to_id)) continue;
        // Emit warps with the source either in the result OR the source is
        // current sector (always emitted). For non-admins, glimpsed targets
        // are reached by exactly this rule.
        if (!includedSectors.has(w.from_id)) continue;
        const knownTwoWay = sourceKnowable(w.to_id) && edgeSet.has(`${w.to_id},${w.from_id}`);
        const key = `${w.from_id},${w.to_id}`;
        if (emittedKeys.has(key)) continue;
        emittedKeys.add(key);
        warps.push({
            from_sector_id: w.from_id,
            to_sector_id: w.to_id,
            known_two_way: knownTwoWay,
        });
    }

    const payload: NeighborhoodReply = {
        type: ServerTag.NeighborhoodResult,
        topology: 'proximal',
        current_sector_id: currentSectorId,
        sectors,
        warps,
    };
    sendEnvelope(playerId, payload);
}

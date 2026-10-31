import type { NeighborhoodSector, NeighborhoodWarp, CommandRequest } from '@twnr/shared';
import { onlinePlayers } from '../state/players.js';
import { getUniverseTopology } from '../db/queries/universe.js';
import {
    listVisitedSectorsForUniverse,
    listPlanetObservationsForSectors,
} from '../db/queries/observations.js';
import { listSectorObservations } from '../services/sector-observations.js';
import { listSectorPositions, listWarpEdgesByIds } from '../db/queries/sector.js';
import { type CommandResult } from './command.js';

const MIN_HALF_EXTENT = 50;
const MAX_HALF_EXTENT = 1_000_000;
const DEFAULT_HALF_EXTENT = 600;

function clampHalfExtent(raw: number): number {
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_HALF_EXTENT;
    if (raw < MIN_HALF_EXTENT) return MIN_HALF_EXTENT;
    if (raw > MAX_HALF_EXTENT) return MAX_HALF_EXTENT;
    return raw;
}

export async function serveGetNeighborhood(
    playerId: number,
    data: CommandRequest<'GetNeighborhood'>,
): Promise<CommandResult<'GetNeighborhood'>> {
    const { halfWidthWorld, halfHeightWorld, centerXWorld, centerYWorld } = data;
    const player = onlinePlayers[playerId];
    if (!player) return;
    const universeId = player.universeId;
    const currentSectorId = player.sectorId;
    const isAdmin = player.isAdmin === true;
    const halfW = clampHalfExtent(halfWidthWorld);
    const halfH = clampHalfExtent(halfHeightWorld);

    const topology = await getUniverseTopology(universeId);

    // Random-topology universes have NULL positions — no map to render.
    if (topology === 'random') {
        return {
            topology: 'random',
            current_sector_id: currentSectorId,
            sectors: [],
            warps: [],
        };
    }

    // TODO: DB-side bbox query would need an index we don't yet have.
    const sectorMetaRows = await listSectorPositions(universeId);
    const sectorMeta = new Map<
        number,
        { id: number; sector_number: number; x: number | null; y: number | null }
    >();
    for (const row of sectorMetaRows) {
        sectorMeta.set(row.id, row);
    }

    const currentMeta = sectorMeta.get(currentSectorId);
    let cx: number;
    let cy: number;
    if (typeof centerXWorld === 'number' && typeof centerYWorld === 'number') {
        cx = centerXWorld;
        cy = centerYWorld;
    } else if (currentMeta && currentMeta.x != null && currentMeta.y != null) {
        cx = currentMeta.x;
        cy = currentMeta.y;
    } else {
        return {
            topology: 'proximal',
            current_sector_id: currentSectorId,
            sectors: [],
            warps: [],
        };
    }

    const visited = await listVisitedSectorsForUniverse(playerId, universeId);
    const visitedIds = new Set<number>();
    const visitedById = new Map<number, (typeof visited)[number]>();
    for (const row of visited) {
        visitedIds.add(row.id);
        visitedById.set(row.id, row);
    }

    const warpRows = await listWarpEdgesByIds(universeId);

    const edgeSet = new Set<string>();
    for (const w of warpRows) edgeSet.add(`${w.from_id},${w.to_id}`);

    const inBbox = new Set<number>();
    for (const meta of sectorMeta.values()) {
        if (meta.x == null || meta.y == null) continue;
        if (Math.abs(meta.x - cx) > halfW) continue;
        if (Math.abs(meta.y - cy) > halfH) continue;
        inBbox.add(meta.id);
    }

    const includedSectors = new Set<number>();
    const fringeIds = new Set<number>();
    const sourceKnowable = (sid: number): boolean =>
        isAdmin || visitedIds.has(sid) || sid === currentSectorId;
    if (isAdmin) {
        for (const id of inBbox) includedSectors.add(id);
    } else {
        // The visited table may not yet contain the current sector.
        includedSectors.add(currentSectorId);
        for (const id of inBbox) {
            if (visitedIds.has(id) || id === currentSectorId) includedSectors.add(id);
        }
        for (const w of warpRows) {
            if (!inBbox.has(w.to_id)) continue;
            if (includedSectors.has(w.to_id)) continue;
            if (!sourceKnowable(w.from_id)) continue;
            includedSectors.add(w.to_id);
            fringeIds.add(w.to_id);
        }
    }
    for (const w of warpRows) {
        if (!includedSectors.has(w.from_id)) continue;
        if (!sourceKnowable(w.from_id)) continue;
        if (includedSectors.has(w.to_id)) continue;
        if (!sectorMeta.has(w.to_id)) continue;
        includedSectors.add(w.to_id);
        fringeIds.add(w.to_id);
    }

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

    const warps: NeighborhoodWarp[] = [];
    const emittedKeys = new Set<string>();
    for (const w of warpRows) {
        if (!sourceKnowable(w.from_id)) continue;
        if (!includedSectors.has(w.to_id)) continue;
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

    return {
        topology: 'proximal',
        current_sector_id: currentSectorId,
        sectors,
        warps,
    };
}

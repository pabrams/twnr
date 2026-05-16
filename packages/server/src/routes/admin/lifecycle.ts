import { Router } from 'express';
import { universeConfig } from '@twnr/shared';
import { withTransaction } from '../../db/index.js';
import { generateUniverse } from '../../bigbang/index.js';
import type { RouteDeps, Middleware } from '../middleware.js';
import { asyncHandler, HttpError, parseIntParam } from '../async-handler.js';
import {
    universeExists,
    getUniverseBasicInfo,
    insertUniverseFull,
    renameUniverse,
    deleteUniverse,
    getTemplateIdByName,
    snapshotTemplateForUniverse,
    getEarthStartingColonistsForUniverse,
} from '../../db/queries/universe.js';
import {
    countSectorsInUniverse,
    countWarpsInUniverse,
    insertSector,
    insertWarp,
    listWarpEdges,
    getStarbaseSectorNumber,
} from '../../db/queries/sector.js';
import {
    countPortsInUniverse,
    insertGeneratedPort,
    upsertSpecialPort,
} from '../../db/queries/port.js';
import { insertUnownedPlanet, setEarthColonists } from '../../db/queries/planet.js';
import { invalidateGraphCache } from '../../state/graph-cache.js';
import {
    countPlayersInUniverse,
    listPlayerIdsInUniverse,
    deleteVisitedSectorsForPlayers,
    clearShipIdsForPlayers,
    deleteShipsByOwners,
    deletePlayersInUniverse,
} from '../../db/queries/player.js';

export function createAdminLifecycleRoutes(
    router: Router,
    deps: RouteDeps,
    middleware: Middleware,
): void {
    const { authenticateAdmin } = middleware;
    void deps;

    router.post(
        '/api/admin/universes/generate',
        authenticateAdmin,
        asyncHandler(async (req, res) => {
            const {
                name,
                sectors,
                seed,
                portDensity,
                twoWayPct,
                warpDist,
                topology,
                fillDensity,
                maxPathLength,
                template_name = 'stock',
            } = req.body;

            if (!name || !String(name).trim()) {
                throw new HttpError(400, 'name is required');
            }
            const sectorCount = parseInt(sectors, 10);
            if (!sectors || isNaN(sectorCount) || sectorCount < 20 || sectorCount > 25000) {
                throw new HttpError(400, 'sectors is required and must be between 20 and 25000');
            }

            let parsedWarpDist: number[] | undefined;
            if (warpDist != null) {
                if (
                    !Array.isArray(warpDist) ||
                    warpDist.length !== 6 ||
                    warpDist.some((v: unknown) => typeof v !== 'number' || v < 0)
                ) {
                    throw new HttpError(
                        400,
                        'warpDist must be an array of 6 non-negative numbers (degrees 1-6)',
                    );
                }
                const sum = warpDist.reduce((a: number, b: number) => a + b, 0);
                if (Math.abs(sum - 100) > 0.01) {
                    throw new HttpError(400, `warpDist values must sum to 100 (got ${sum})`);
                }
                parsedWarpDist = [0, ...warpDist];
            }

            let parsedTopology: 'random' | 'proximal' | undefined;
            if (topology != null) {
                if (topology !== 'random' && topology !== 'proximal') {
                    throw new HttpError(400, "topology must be 'random' or 'proximal'");
                }
                parsedTopology = topology;
            }

            let parsedFillDensity: number | undefined;
            if (fillDensity != null) {
                const fd = Number(fillDensity);
                if (!Number.isFinite(fd) || fd < 0.1 || fd > 1.0) {
                    throw new HttpError(400, 'fillDensity must be a number between 0.1 and 1.0');
                }
                parsedFillDensity = fd;
            }

            let parsedMaxPathLength: number | undefined;
            if (maxPathLength != null) {
                const mp = Math.floor(Number(maxPathLength));
                if (!Number.isFinite(mp) || mp < 5 || mp > 10000) {
                    throw new HttpError(
                        400,
                        'maxPathLength must be an integer between 5 and 10000',
                    );
                }
                parsedMaxPathLength = mp;
            }

            const result = generateUniverse({
                sectors: sectorCount,
                seed: seed != null ? Math.floor(Number(seed)) : undefined,
                portDensity: portDensity != null ? Number(portDensity) : undefined,
                twoWayPct: twoWayPct != null ? Number(twoWayPct) : undefined,
                warpDist: parsedWarpDist,
                topology: parsedTopology,
                fillDensity: parsedFillDensity,
                maxPathLength: parsedMaxPathLength,
            });

            const universeId = await withTransaction(async (client) => {
                // pointer for content lookups + snapshot for frozen settings
                const templateId = await getTemplateIdByName(template_name, client);
                const newUniverseId = await insertUniverseFull(
                    name,
                    result.seed,
                    templateId,
                    client,
                    result.topology,
                );
                await snapshotTemplateForUniverse(newUniverseId, template_name, client);

                // record the form-supplied bigbang knobs so the per-universe
                // settings reflect what was actually used, not the template defaults
                await client.query(
                    `UPDATE universe_settings
                     SET sector_count = $2,
                         warp_dist = $3::jsonb,
                         two_way_pct = $4,
                         port_spawn_density = $5,
                         fill_density = $6,
                         max_path_length = $7
                     WHERE universe_id = $1`,
                    [
                        newUniverseId,
                        sectorCount,
                        JSON.stringify(warpDist ?? universeConfig.warpDist),
                        twoWayPct ?? universeConfig.twoWayPct,
                        portDensity ?? universeConfig.portSpawnDensity,
                        parsedFillDensity ?? universeConfig.fillDensity,
                        parsedMaxPathLength ?? universeConfig.maxPathLength,
                    ],
                );

                const sectorIdMap = new Map<number, number>();
                for (const s of result.sectors) {
                    const id = await insertSector(newUniverseId, s.id, s.name, client, s.x, s.y);
                    sectorIdMap.set(s.id, id);
                }

                for (const w of result.warps) {
                    await insertWarp(sectorIdMap.get(w.from)!, sectorIdMap.get(w.to)!, client);
                }

                for (const p of result.ports) {
                    await insertGeneratedPort(
                        sectorIdMap.get(p.sector)!,
                        p.class,
                        {
                            fuelQty: p.fuel_qty,
                            fuelPrice: p.fuel_price,
                            orgQty: p.org_qty,
                            orgPrice: p.org_price,
                            equQty: p.equ_qty,
                            equPrice: p.equ_price,
                        },
                        client,
                    );
                }

                const sector1Id = sectorIdMap.get(1)!;
                await upsertSpecialPort(sector1Id, 0, client);

                const starbaseSectorNumber = await getStarbaseSectorNumber(newUniverseId, client);
                if (starbaseSectorNumber !== null) {
                    const starbaseSectorDbId = sectorIdMap.get(starbaseSectorNumber);
                    if (starbaseSectorDbId !== undefined) {
                        await upsertSpecialPort(starbaseSectorDbId, 9, client);
                    }
                }

                // Persist all planets the generator emitted (always includes
                // Earth at sector 1; may include scattered planets if
                // planetDensity > 0).
                for (const p of result.planets) {
                    const sectorDbId = sectorIdMap.get(p.sector);
                    if (sectorDbId === undefined) continue;
                    await insertUnownedPlanet(sectorDbId, p.name, p.type, client);
                }
                const earthCol = await getEarthStartingColonistsForUniverse(newUniverseId, client);
                await setEarthColonists(sector1Id, earthCol, client);

                return newUniverseId;
            });

            invalidateGraphCache(universeId!);

            const [warpCount, portCount] = await Promise.all([
                countWarpsInUniverse(universeId!),
                countPortsInUniverse(universeId!),
            ]);

            res.status(201).json({
                id: universeId,
                name,
                seed: result.seed,
                topology: result.topology,
                sectorCount: result.sectors.length,
                warpCount,
                portCount,
            });
        }),
    );

    router.get(
        '/api/admin/universes/:id/stats',
        authenticateAdmin,
        asyncHandler(async (req, res) => {
            const universeId = parseIntParam(req.params.id, 'id');

            const univ = await getUniverseBasicInfo(universeId);
            if (!univ) {
                throw new HttpError(404, 'Universe not found');
            }

            const [sectorCount, warpCount, portCount, playerCount] = await Promise.all([
                countSectorsInUniverse(universeId),
                countWarpsInUniverse(universeId),
                countPortsInUniverse(universeId),
                countPlayersInUniverse(universeId),
            ]);

            res.json({
                id: univ.id,
                name: univ.name,
                seed: univ.seed,
                createdAt: univ.created_at,
                sectorCount,
                warpCount,
                portCount,
                playerCount,
            });
        }),
    );

    router.delete(
        '/api/admin/universes/:id',
        authenticateAdmin,
        asyncHandler(async (req, res) => {
            const universeId = parseIntParam(req.params.id, 'id');

            if (!(await universeExists(universeId))) {
                throw new HttpError(404, 'Universe not found');
            }

            await withTransaction(async (client) => {
                const playerIds = await listPlayerIdsInUniverse(universeId, client);
                if (playerIds.length > 0) {
                    await deleteVisitedSectorsForPlayers(playerIds, client);
                    await clearShipIdsForPlayers(playerIds, client);
                    await deleteShipsByOwners(playerIds, client);
                    await deletePlayersInUniverse(universeId, client);
                }

                await deleteUniverse(universeId, client);
            });

            invalidateGraphCache(universeId);

            res.json({ deleted: true, id: universeId });
        }),
    );

    router.put(
        '/api/admin/universes/:id',
        authenticateAdmin,
        asyncHandler(async (req, res) => {
            const universeId = parseIntParam(req.params.id, 'id');
            const { name } = req.body;

            if (!name || !String(name).trim()) {
                throw new HttpError(400, 'name is required');
            }

            const renamed = await renameUniverse(universeId, name);
            if (!renamed) {
                throw new HttpError(404, 'Universe not found');
            }

            res.json({ id: renamed.id, name: renamed.name });
        }),
    );

    router.get(
        '/api/admin/universes/:id/topology',
        authenticateAdmin,
        asyncHandler(async (req, res) => {
            const universeId = parseIntParam(req.params.id, 'id');

            if (!(await universeExists(universeId))) {
                throw new HttpError(404, 'Universe not found');
            }

            const [totalSectors, warps] = await Promise.all([
                countSectorsInUniverse(universeId),
                listWarpEdges(universeId),
            ]);
            const totalWarps = warps.length;

            const warpSet = new Set(warps.map((w) => `${w.from},${w.to}`));
            const counted = new Set<string>();
            let bidirectionalPairs = 0;
            for (const w of warps) {
                const a = Math.min(w.from, w.to);
                const b = Math.max(w.from, w.to);
                const key = `${a},${b}`;
                if (!counted.has(key) && warpSet.has(`${w.to},${w.from}`)) {
                    bidirectionalPairs++;
                    counted.add(key);
                }
            }

            const outDeg = new Map<number, number>();
            for (const w of warps) {
                outDeg.set(w.from, (outDeg.get(w.from) || 0) + 1);
            }
            const avgOut =
                totalSectors > 0 ? Math.round((totalWarps / totalSectors) * 100) / 100 : 0;

            const deadEndSectors: number[] = [];
            for (const [sector, deg] of outDeg) {
                if (deg === 1) deadEndSectors.push(sector);
            }
            deadEndSectors.sort((a, b) => a - b);

            const adj = new Map<number, number[]>();
            for (const w of warps) {
                if (!adj.has(w.from)) adj.set(w.from, []);
                adj.get(w.from)!.push(w.to);
            }
            const visited = new Set<number>();
            const queue = [1];
            visited.add(1);
            while (queue.length > 0) {
                const node = queue.shift()!;
                for (const next of adj.get(node) || []) {
                    if (!visited.has(next)) {
                        visited.add(next);
                        queue.push(next);
                    }
                }
            }
            const isConnected = visited.size === totalSectors;

            res.json({
                totalSectors,
                totalWarps,
                bidirectionalPairs,
                averageOutDegree: avgOut,
                deadEndSectors,
                isConnected,
            });
        }),
    );
}

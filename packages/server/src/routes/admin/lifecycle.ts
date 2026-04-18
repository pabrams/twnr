import { Router } from 'express';
import { withTransaction } from '../../db/index.js';
import { generateUniverse } from '../../bigbang/index.js';
import type { RouteDeps, Middleware } from '../middleware.js';
import { asyncHandler, HttpError } from '../async-handler.js';
import {
    universeExists,
    getUniverseBasicInfo,
    insertUniverseFull,
    renameUniverse,
    deleteUniverse,
    getEditIdByName,
    getEarthStartingColonistsForEdit,
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
import { upsertEarthPlanet, setEarthColonists } from '../../db/queries/planet.js';
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
                edit_name = 'stock',
            } = req.body;

            if (!name || !String(name).trim()) {
                throw new HttpError(400, 'name is required');
            }
            const sectorCount = parseInt(sectors, 10);
            if (!sectors || isNaN(sectorCount) || sectorCount < 20 || sectorCount > 25000) {
                throw new HttpError(
                    400,
                    'sectors is required and must be between 20 and 25000',
                );
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

            const result = generateUniverse({
                sectors: sectorCount,
                seed: seed != null ? Math.floor(Number(seed)) : undefined,
                portDensity: portDensity != null ? Number(portDensity) : undefined,
                twoWayPct: twoWayPct != null ? Number(twoWayPct) : undefined,
                warpDist: parsedWarpDist,
            });

            const universeId = await withTransaction(async (client) => {
                const editId = await getEditIdByName(edit_name, client);
                const newUniverseId = await insertUniverseFull(
                    name,
                    result.seed,
                    editId,
                    client,
                );

                const sectorIdMap = new Map<number, number>();
                for (const s of result.sectors) {
                    const id = await insertSector(newUniverseId, s.id, s.name, client);
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

                await upsertEarthPlanet(sector1Id, client);
                const earthCol = await getEarthStartingColonistsForEdit(editId, client);
                await setEarthColonists(sector1Id, earthCol, client);

                return newUniverseId;
            });

            const [warpCount, portCount] = await Promise.all([
                countWarpsInUniverse(universeId!),
                countPortsInUniverse(universeId!),
            ]);

            res.status(201).json({
                id: universeId,
                name,
                seed: result.seed,
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
            const universeId = parseInt(req.params.id as string, 10);

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
            const universeId = parseInt(req.params.id as string, 10);

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

                // CASCADE handles sectors, warps, ports, planets, sector_drones
                await deleteUniverse(universeId, client);
            });

            res.json({ deleted: true, id: universeId });
        }),
    );

    router.put(
        '/api/admin/universes/:id',
        authenticateAdmin,
        asyncHandler(async (req, res) => {
            const universeId = parseInt(req.params.id as string, 10);
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
            const universeId = parseInt(req.params.id as string, 10);

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

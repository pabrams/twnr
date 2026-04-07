import { Router } from 'express';
import { pool } from '../../db/index.js';
import { generateUniverse } from '../../bigbang/index.js';
import type { RouteDeps, Middleware } from '../middleware.js';

export function createAdminLifecycleRoutes(
    router: Router,
    deps: RouteDeps,
    middleware: Middleware,
): void {
    const { authenticateAdmin } = middleware;

    router.post(
        '/api/admin/universes/generate',
        authenticateAdmin,
        async (req, res): Promise<any> => {
            const {
                name,
                sectors,
                seed,
                portDensity,
                twoWayPct,
                max_planets_per_sector = 2,
            } = req.body;

            if (!name || !String(name).trim()) {
                return res.status(400).json({ error: 'name is required' });
            }
            const sectorCount = parseInt(sectors, 10);
            if (!sectors || isNaN(sectorCount) || sectorCount < 20 || sectorCount > 500) {
                return res
                    .status(400)
                    .json({ error: 'sectors is required and must be between 20 and 500' });
            }
            const maxPlanets = parseInt(String(max_planets_per_sector), 10);
            if (isNaN(maxPlanets) || maxPlanets < 0 || maxPlanets > 25) {
                return res
                    .status(400)
                    .json({ error: 'max_planets_per_sector must be between 0 and 25' });
            }

            try {
                const result = generateUniverse({
                    sectors: sectorCount,
                    seed: seed != null ? Math.floor(Number(seed)) : undefined,
                    portDensity: portDensity != null ? Number(portDensity) : undefined,
                    twoWayPct: twoWayPct != null ? Number(twoWayPct) : undefined,
                });

                const client = await pool.connect();
                try {
                    await client.query('BEGIN');

                    // Create universe row
                    const univRes = await client.query(
                        'INSERT INTO universes (name, seed, max_planets_per_sector) VALUES ($1, $2, $3) RETURNING id',
                        [name, result.seed, maxPlanets],
                    );
                    const universeId = univRes.rows[0].id;

                    // Insert sectors and build sector_number → id map
                    const sectorIdMap = new Map<number, number>();
                    for (const s of result.sectors) {
                        const sRes = await client.query(
                            'INSERT INTO sectors (universe_id, sector_number, name) VALUES ($1, $2, $3) RETURNING id',
                            [universeId, s.id, s.name],
                        );
                        sectorIdMap.set(s.id, sRes.rows[0].id);
                    }

                    // Insert warps
                    for (const w of result.warps) {
                        await client.query(
                            'INSERT INTO warps (from_sector_id, to_sector_id) VALUES ($1, $2)',
                            [sectorIdMap.get(w.from), sectorIdMap.get(w.to)],
                        );
                    }

                    // Insert trading ports
                    for (const p of result.ports) {
                        await client.query(
                            `INSERT INTO ports (sector_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                            [
                                sectorIdMap.get(p.sector),
                                p.class,
                                p.fuel_qty,
                                p.fuel_price,
                                p.org_qty,
                                p.org_price,
                                p.equ_qty,
                                p.equ_price,
                            ],
                        );
                    }

                    // Seed Class 0 port in Sector 1
                    const sector1Id = sectorIdMap.get(1)!;
                    await client.query(
                        `INSERT INTO ports (sector_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
                         VALUES ($1, 0, 0, 0, 0, 0, 0, 0)
                         ON CONFLICT (sector_id) DO UPDATE
                         SET class = 0, fuel = 0, fuel_price = 0, organics = 0, org_price = 0, equipment = 0, equ_price = 0`,
                        [sector1Id],
                    );

                    // Seed Class 9 port at Starbase
                    const starbaseRes = await client.query(
                        `SELECT id FROM sectors WHERE name = 'Starbase' AND universe_id = $1`,
                        [universeId],
                    );
                    if (starbaseRes.rows.length > 0) {
                        await client.query(
                            `INSERT INTO ports (sector_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
                             VALUES ($1, 9, 0, 0, 0, 0, 0, 0)
                             ON CONFLICT (sector_id) DO UPDATE
                             SET class = 9, fuel = 0, fuel_price = 0, organics = 0, org_price = 0, equipment = 0, equ_price = 0`,
                            [starbaseRes.rows[0].id],
                        );
                    }

                    // Seed Earth in Sector 1
                    await client.query(
                        `INSERT INTO planets (sector_id, name, type)
                         VALUES ($1, 'Earth', 'Terran')
                         ON CONFLICT DO NOTHING`,
                        [sector1Id],
                    );

                    await client.query('COMMIT');

                    // Count actual data
                    const warpCountRes = await pool.query(
                        `SELECT COUNT(*) FROM warps w
                         JOIN sectors s ON w.from_sector_id = s.id
                         WHERE s.universe_id = $1`,
                        [universeId],
                    );
                    const portCountRes = await pool.query(
                        `SELECT COUNT(*) FROM ports p
                         JOIN sectors s ON p.sector_id = s.id
                         WHERE s.universe_id = $1`,
                        [universeId],
                    );

                    res.status(201).json({
                        id: universeId,
                        name,
                        seed: result.seed,
                        sectorCount: result.sectors.length,
                        warpCount: parseInt(warpCountRes.rows[0].count, 10),
                        portCount: parseInt(portCountRes.rows[0].count, 10),
                    });
                } catch (err) {
                    await client.query('ROLLBACK');
                    throw err;
                } finally {
                    client.release();
                }
            } catch (err) {
                console.error('Generate universe error', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );

    router.get(
        '/api/admin/universes/:id/stats',
        authenticateAdmin,
        async (req, res): Promise<any> => {
            const universeId = parseInt(req.params.id as string, 10);

            try {
                const univRes = await pool.query(
                    'SELECT id, name, seed, created_at FROM universes WHERE id = $1',
                    [universeId],
                );
                if (univRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Universe not found' });
                }

                const univ = univRes.rows[0];
                const sectorCount = await pool.query(
                    'SELECT COUNT(*) FROM sectors WHERE universe_id = $1',
                    [universeId],
                );
                const warpCount = await pool.query(
                    `SELECT COUNT(*) FROM warps w
                     JOIN sectors s ON w.from_sector_id = s.id
                     WHERE s.universe_id = $1`,
                    [universeId],
                );
                const portCount = await pool.query(
                    `SELECT COUNT(*) FROM ports p
                     JOIN sectors s ON p.sector_id = s.id
                     WHERE s.universe_id = $1`,
                    [universeId],
                );
                const playerCount = await pool.query(
                    'SELECT COUNT(*) FROM players WHERE universe_id = $1',
                    [universeId],
                );

                res.json({
                    id: univ.id,
                    name: univ.name,
                    seed: univ.seed,
                    createdAt: univ.created_at,
                    sectorCount: parseInt(sectorCount.rows[0].count, 10),
                    warpCount: parseInt(warpCount.rows[0].count, 10),
                    portCount: parseInt(portCount.rows[0].count, 10),
                    playerCount: parseInt(playerCount.rows[0].count, 10),
                });
            } catch (err) {
                console.error('Universe stats error', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );

    router.delete('/api/admin/universes/:id', authenticateAdmin, async (req, res): Promise<any> => {
        const universeId = parseInt(req.params.id as string, 10);

        try {
            // Check universe exists
            const univRes = await pool.query('SELECT id FROM universes WHERE id = $1', [
                universeId,
            ]);
            if (univRes.rows.length === 0) {
                return res.status(404).json({ error: 'Universe not found' });
            }

            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Get player IDs for this universe
                const playerRes = await client.query(
                    'SELECT id FROM players WHERE universe_id = $1',
                    [universeId],
                );
                const playerIds = playerRes.rows.map((r: { id: number }) => r.id);

                if (playerIds.length > 0) {
                    // Delete player-related data
                    await client.query(
                        'DELETE FROM visited_sectors WHERE player_id = ANY($1::int[])',
                        [playerIds],
                    );
                    await client.query(
                        'UPDATE players SET ship_id = NULL WHERE id = ANY($1::int[])',
                        [playerIds],
                    );
                    await client.query('DELETE FROM ships WHERE owner_id = ANY($1::int[])', [
                        playerIds,
                    ]);
                    await client.query('DELETE FROM players WHERE universe_id = $1', [universeId]);
                }

                // Delete universe — CASCADE handles sectors, warps, ports, planets, sector_drones
                await client.query('DELETE FROM universes WHERE id = $1', [universeId]);

                await client.query('COMMIT');

                res.json({ deleted: true, id: universeId });
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        } catch (err) {
            console.error('Delete universe error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.put('/api/admin/universes/:id', authenticateAdmin, async (req, res): Promise<any> => {
        const universeId = parseInt(req.params.id as string, 10);
        const { name } = req.body;

        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'name is required' });
        }

        try {
            const result = await pool.query(
                'UPDATE universes SET name = $1 WHERE id = $2 RETURNING id, name',
                [name, universeId],
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Universe not found' });
            }

            res.json({ id: result.rows[0].id, name: result.rows[0].name });
        } catch (err) {
            console.error('Rename universe error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.get(
        '/api/admin/universes/:id/topology',
        authenticateAdmin,
        async (req, res): Promise<any> => {
            const universeId = parseInt(req.params.id as string, 10);

            try {
                const univRes = await pool.query('SELECT id FROM universes WHERE id = $1', [
                    universeId,
                ]);
                if (univRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Universe not found' });
                }

                const sectorRes = await pool.query(
                    'SELECT COUNT(*) FROM sectors WHERE universe_id = $1',
                    [universeId],
                );
                const totalSectors = parseInt(sectorRes.rows[0].count, 10);

                const warpRes = await pool.query(
                    `SELECT s_from.sector_number as sector_from, s_to.sector_number as sector_to
                     FROM warps w
                     JOIN sectors s_from ON w.from_sector_id = s_from.id
                     JOIN sectors s_to ON w.to_sector_id = s_to.id
                     WHERE s_from.universe_id = $1`,
                    [universeId],
                );
                const totalWarps = warpRes.rows.length;

                // Count bidirectional pairs (each pair counted once)
                const warpSet = new Set(
                    warpRes.rows.map(
                        (w: { sector_from: number; sector_to: number }) =>
                            `${w.sector_from},${w.sector_to}`,
                    ),
                );
                const counted = new Set<string>();
                let bidirectionalPairs = 0;
                for (const w of warpRes.rows) {
                    const a = Math.min(w.sector_from, w.sector_to);
                    const b = Math.max(w.sector_from, w.sector_to);
                    const key = `${a},${b}`;
                    if (!counted.has(key) && warpSet.has(`${w.sector_to},${w.sector_from}`)) {
                        bidirectionalPairs++;
                        counted.add(key);
                    }
                }

                // Compute out-degree per sector
                const outDeg = new Map<number, number>();
                for (const w of warpRes.rows) {
                    outDeg.set(w.sector_from, (outDeg.get(w.sector_from) || 0) + 1);
                }
                const avgOut =
                    totalSectors > 0 ? Math.round((totalWarps / totalSectors) * 100) / 100 : 0;

                // Dead-end sectors: exactly 1 outgoing warp
                const deadEndSectors: number[] = [];
                for (const [sector, deg] of outDeg) {
                    if (deg === 1) deadEndSectors.push(sector);
                }
                deadEndSectors.sort((a, b) => a - b);

                // BFS connectivity from sector 1
                const adj = new Map<number, number[]>();
                for (const w of warpRes.rows) {
                    if (!adj.has(w.sector_from)) adj.set(w.sector_from, []);
                    adj.get(w.sector_from)!.push(w.sector_to);
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
            } catch (err) {
                console.error('Topology error', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );
}

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

                    // Insert sectors
                    for (const s of result.sectors) {
                        await client.query(
                            'INSERT INTO sectors (id, universe_id, name) VALUES ($1, $2, $3)',
                            [s.id, universeId, s.name],
                        );
                    }

                    // Insert warps
                    for (const w of result.warps) {
                        await client.query(
                            'INSERT INTO warps (sector_from, sector_to, universe_id) VALUES ($1, $2, $3)',
                            [w.from, w.to, universeId],
                        );
                    }

                    // Insert trading ports
                    for (const p of result.ports) {
                        await client.query(
                            `INSERT INTO ports (sector_id, universe_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                            [
                                p.sector,
                                universeId,
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
                    await client.query(
                        `INSERT INTO ports (sector_id, universe_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
                         VALUES (1, $1, 0, 0, 0, 0, 0, 0, 0)
                         ON CONFLICT (sector_id, universe_id) DO UPDATE
                         SET class = 0, fuel = 0, fuel_price = 0, organics = 0, org_price = 0, equipment = 0, equ_price = 0`,
                        [universeId],
                    );

                    // Seed Class 9 port at Stardock
                    await client.query(
                        `INSERT INTO ports (sector_id, universe_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
                         SELECT id, $1, 9, 0, 0, 0, 0, 0, 0
                         FROM sectors WHERE name = 'Stardock' AND universe_id = $1
                         ON CONFLICT (sector_id, universe_id) DO UPDATE
                         SET class = 9, fuel = 0, fuel_price = 0, organics = 0, org_price = 0, equipment = 0, equ_price = 0`,
                        [universeId],
                    );

                    // Seed Earth in Sector 1
                    await client.query(
                        `INSERT INTO planets (id, sector_id, universe_id, name, type)
                         VALUES (1, 1, $1, 'Earth', 'Terran')
                         ON CONFLICT (id, universe_id) DO NOTHING`,
                        [universeId],
                    );

                    await client.query('COMMIT');

                    // Count actual data
                    const warpCountRes = await pool.query(
                        'SELECT COUNT(*) FROM warps WHERE universe_id = $1',
                        [universeId],
                    );
                    const portCountRes = await pool.query(
                        'SELECT COUNT(*) FROM ports WHERE universe_id = $1',
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
                    'SELECT COUNT(*) FROM warps WHERE universe_id = $1',
                    [universeId],
                );
                const portCount = await pool.query(
                    'SELECT COUNT(*) FROM ports WHERE universe_id = $1',
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
                    await client.query('DELETE FROM ship_cargo WHERE player_id = ANY($1::int[])', [
                        playerIds,
                    ]);
                    await client.query(
                        'DELETE FROM player_ships WHERE player_id = ANY($1::int[])',
                        [playerIds],
                    );
                    await client.query('DELETE FROM players WHERE universe_id = $1', [universeId]);
                }

                // Delete universe data
                await client.query('DELETE FROM planets WHERE universe_id = $1', [universeId]);
                await client.query('DELETE FROM ports WHERE universe_id = $1', [universeId]);
                await client.query('DELETE FROM warps WHERE universe_id = $1', [universeId]);
                await client.query('DELETE FROM sectors WHERE universe_id = $1', [universeId]);
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

    router.post(
        '/api/admin/universes/:id/clone',
        authenticateAdmin,
        async (req, res): Promise<any> => {
            const sourceId = parseInt(req.params.id as string, 10);
            const { name } = req.body;

            if (!name || !String(name).trim()) {
                return res.status(400).json({ error: 'name is required' });
            }

            try {
                // Check source exists
                const srcRes = await pool.query(
                    'SELECT id, seed, max_planets_per_sector, planet_collision_likelihood, planet_collision_min_hours, planet_collision_max_hours FROM universes WHERE id = $1',
                    [sourceId],
                );
                if (srcRes.rows.length === 0) {
                    return res.status(404).json({ error: 'Universe not found' });
                }

                const client = await pool.connect();
                try {
                    await client.query('BEGIN');

                    // Create new universe row
                    const newUnivRes = await client.query(
                        'INSERT INTO universes (name, seed, max_planets_per_sector, planet_collision_likelihood, planet_collision_min_hours, planet_collision_max_hours) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
                        [
                            name,
                            srcRes.rows[0].seed,
                            srcRes.rows[0].max_planets_per_sector,
                            srcRes.rows[0].planet_collision_likelihood,
                            srcRes.rows[0].planet_collision_min_hours,
                            srcRes.rows[0].planet_collision_max_hours,
                        ],
                    );
                    const newId = newUnivRes.rows[0].id;

                    // Copy sectors
                    await client.query(
                        `INSERT INTO sectors (id, universe_id, name)
                         SELECT id, $1, name FROM sectors WHERE universe_id = $2`,
                        [newId, sourceId],
                    );

                    // Copy warps
                    await client.query(
                        `INSERT INTO warps (sector_from, sector_to, universe_id)
                         SELECT sector_from, sector_to, $1 FROM warps WHERE universe_id = $2`,
                        [newId, sourceId],
                    );

                    // Copy ports
                    await client.query(
                        `INSERT INTO ports (sector_id, universe_id, class, fuel, fuel_price, organics, org_price, equipment, equ_price)
                         SELECT sector_id, $1, class, fuel, fuel_price, organics, org_price, equipment, equ_price
                         FROM ports WHERE universe_id = $2`,
                        [newId, sourceId],
                    );

                    // Copy planets
                    await client.query(
                        `INSERT INTO planets (id, sector_id, universe_id, name, type, fighters, fuel, organics, equipment, colonists_fuel, colonists_organics, colonists_equipment)
                         SELECT id, sector_id, $1, name, type, fighters, fuel, organics, equipment, colonists_fuel, colonists_organics, colonists_equipment
                         FROM planets WHERE universe_id = $2`,
                        [newId, sourceId],
                    );

                    await client.query('COMMIT');

                    // Get counts
                    const sectorCount = await pool.query(
                        'SELECT COUNT(*) FROM sectors WHERE universe_id = $1',
                        [newId],
                    );
                    const warpCount = await pool.query(
                        'SELECT COUNT(*) FROM warps WHERE universe_id = $1',
                        [newId],
                    );
                    const portCount = await pool.query(
                        'SELECT COUNT(*) FROM ports WHERE universe_id = $1',
                        [newId],
                    );

                    res.status(201).json({
                        id: newId,
                        name,
                        seed: srcRes.rows[0].seed,
                        sectorCount: parseInt(sectorCount.rows[0].count, 10),
                        warpCount: parseInt(warpCount.rows[0].count, 10),
                        portCount: parseInt(portCount.rows[0].count, 10),
                    });
                } catch (err) {
                    await client.query('ROLLBACK');
                    throw err;
                } finally {
                    client.release();
                }
            } catch (err) {
                console.error('Clone universe error', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );

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
                    'SELECT sector_from, sector_to FROM warps WHERE universe_id = $1',
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

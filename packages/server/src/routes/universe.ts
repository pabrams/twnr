import { Router } from 'express';
import { pool } from '../db/index.js';
import type { RouteDeps, Middleware } from './middleware.js';
import { newPlayerConfig } from '../game-config.js';

export function createUniverseRoutes(
    router: Router,
    deps: RouteDeps,
    middleware: Middleware,
): void {
    const { getAuthenticatedPlayer, shipConfigs } = deps;
    const { authenticateToken } = middleware;

    router.post('/api/universes', authenticateToken, async (req, res): Promise<any> => {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'name is required' });
        }

        try {
            const result = await pool.query(
                'INSERT INTO universes (name) VALUES ($1) RETURNING id, name',
                [name],
            );
            const universe = result.rows[0];
            res.status(201).json({ universeId: universe.id, name: universe.name });
        } catch (err) {
            console.error('Create universe error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.get('/api/universes', authenticateToken, async (req, res): Promise<any> => {
        const { userId } = getAuthenticatedPlayer(req);
        try {
            const result = await pool.query(
                `SELECT u.id, u.name, u.created_at, p.id AS player_id, p.name AS player_name
                 FROM universes u
                 LEFT JOIN players p ON p.universe_id = u.id AND p.user_id = $1
                 ORDER BY u.id`,
                [userId],
            );
            const universes = result.rows.map((r) => ({
                id: r.id,
                name: r.name,
                createdAt: r.created_at,
                playerId: r.player_id ?? null,
                playerName: r.player_name ?? null,
            }));
            res.json(universes);
        } catch (err) {
            console.error('List universes error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.post('/api/universes/:id/join', authenticateToken, async (req, res): Promise<any> => {
        const { userId } = getAuthenticatedPlayer(req);
        const universeId = parseInt(req.params.id as string, 10);
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'name is required' });
        }

        try {
            // Check universe exists
            const univRes = await pool.query('SELECT id, starting_turns FROM universes WHERE id = $1', [
                universeId,
            ]);
            if (univRes.rows.length === 0) {
                return res.status(404).json({ error: 'Universe not found' });
            }

            // Create player row
            const startSector = newPlayerConfig.startingSector;
            const startingTurns = univRes.rows[0].starting_turns;
            const playerRes = await pool.query(
                `INSERT INTO players (name, user_id, universe_id, current_sector, turns, last_turns_granted_at)
                 VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
                [name, userId, universeId, startSector, startingTurns],
            );
            const playerId = playerRes.rows[0].id;

            // Create ship
            const startShip = shipConfigs[newPlayerConfig.startingShip];
            if (startShip) {
                await pool.query(
                    `INSERT INTO player_ships (player_id, ship_name, fighters, shields, cargo_limit, turns_per_warp)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        playerId,
                        startShip.name,
                        newPlayerConfig.startingFighters,
                        newPlayerConfig.startingShields,
                        startShip.startingHolds,
                        startShip.turnsPerWarp ?? 1,
                    ],
                );
            }

            // Create cargo
            await pool.query(
                `INSERT INTO ship_cargo (player_id, fuel, organics, equipment, credits)
                 VALUES ($1, 0, 0, 0, $2)`,
                [playerId, newPlayerConfig.startingCredits],
            );

            // Mark starting sector as visited
            await pool.query(
                'INSERT INTO visited_sectors (player_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [playerId, startSector],
            );

            res.status(201).json({ playerId, universeId });
        } catch (err: any) {
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Already joined this universe' });
            }
            console.error('Join universe error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.get('/api/universes/:id/players', authenticateToken, async (req, res): Promise<any> => {
        const universeId = parseInt(req.params.id as string, 10);
        try {
            const result = await pool.query(
                `SELECT p.name, COALESCE(ps.ship_name, 'No ship') AS ship_name
                     FROM players p
                     LEFT JOIN player_ships ps ON p.id = ps.player_id
                     WHERE p.universe_id = $1
                     ORDER BY p.name`,
                [universeId],
            );
            res.json(
                result.rows.map((r: any) => ({
                    name: r.name,
                    shipName: r.ship_name,
                })),
            );
        } catch (err) {
            console.error('List players error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}

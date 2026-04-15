import { Router } from 'express';
import { pool } from '../db/index.js';
import type { PlayerListRow } from '../db/types.js';
import type { RouteDeps, Middleware } from './middleware.js';
import { newPlayerConfig } from '../game-config.js';

export function createUniverseRoutes(
    router: Router,
    deps: RouteDeps,
    middleware: Middleware,
): void {
    const { getAuthenticatedPlayer } = deps;
    const { authenticateToken } = middleware;

    router.post('/api/universes', authenticateToken, async (req, res) => {
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

    router.get('/api/universes', authenticateToken, async (req, res) => {
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

    router.post('/api/universes/:id/join', authenticateToken, async (req, res) => {
        const { userId } = getAuthenticatedPlayer(req);
        const universeId = parseInt(req.params.id as string, 10);
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'name is required' });
        }

        try {
            // Check universe exists and get edit defaults
            const univRes = await pool.query(
                `SELECT u.id, e.starting_turns, e.starting_credits, e.starting_ship, e.starting_drones
                 FROM universes u
                 LEFT JOIN edits e ON u.edit_id = e.id
                 WHERE u.id = $1`,
                [universeId],
            );
            if (univRes.rows.length === 0) {
                return res.status(404).json({ error: 'Universe not found' });
            }

            const editDefaults = univRes.rows[0];
            // Create player row
            const startSector = newPlayerConfig.startingSector;
            const startingTurns = editDefaults.starting_turns ?? 500;
            const startingCredits =
                editDefaults.starting_credits ?? newPlayerConfig.startingCredits;
            const startingShip = editDefaults.starting_ship ?? newPlayerConfig.startingShip;
            const startingDrones = editDefaults.starting_drones ?? newPlayerConfig.startingDrones;
            const sectorIdRes = await pool.query(
                'SELECT id FROM sectors WHERE sector_number = $1 AND universe_id = $2',
                [startSector, universeId],
            );
            const startSectorId = sectorIdRes.rows[0]?.id;
            const playerRes = await pool.query(
                `INSERT INTO players (name, user_id, universe_id, current_sector_id, credits, turns, last_turns_granted_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id`,
                [name, userId, universeId, startSectorId, startingCredits, startingTurns],
            );
            const playerId = playerRes.rows[0].id;

            // Create ship
            const startShipType = await pool.query(
                'SELECT id, starting_holds, turns_per_warp FROM ship_types WHERE name = $1',
                [startingShip],
            );
            if (startShipType.rows.length > 0) {
                const st = startShipType.rows[0];
                const shipRes = await pool.query(
                    `INSERT INTO ships (owner_id, ship_type_id, sector_id, drones, shields, holds, turns_per_warp)
                     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
                    [
                        playerId,
                        st.id,
                        startSectorId,
                        startingDrones,
                        newPlayerConfig.startingShields,
                        st.starting_holds,
                        st.turns_per_warp,
                    ],
                );
                await pool.query('UPDATE players SET ship_id = $1 WHERE id = $2', [
                    shipRes.rows[0].id,
                    playerId,
                ]);
            }

            // Mark starting sector as visited
            await pool.query(
                'INSERT INTO visited_sectors (player_id, sector_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [playerId, startSector],
            );

            res.status(201).json({ playerId, universeId });
        } catch (err) {
            if (
                err instanceof Error &&
                'code' in err &&
                (err as Record<string, unknown>).code === '23505'
            ) {
                return res.status(409).json({ error: 'Already joined this universe' });
            }
            console.error('Join universe error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.get('/api/universes/:id/players', authenticateToken, async (req, res) => {
        const universeId = parseInt(req.params.id as string, 10);
        try {
            const result = await pool.query<PlayerListRow>(
                `SELECT p.name, COALESCE(st.name, 'No ship') AS ship_name
                     FROM players p
                     LEFT JOIN ships s ON p.ship_id = s.id
                     LEFT JOIN ship_types st ON s.ship_type_id = st.id
                     WHERE p.universe_id = $1
                     ORDER BY p.name`,
                [universeId],
            );
            res.json(
                result.rows.map((r) => ({
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

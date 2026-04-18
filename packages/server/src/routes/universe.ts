import { Router } from 'express';
import type { RouteDeps, Middleware } from './middleware.js';
import { newPlayerConfig } from '../game-config.js';
import {
    createUniverse,
    listUniversesForUser,
    getUniverseEditDefaults,
} from '../db/queries/universe.js';
import {
    insertPlayer,
    setPlayerShipId,
    listPlayersInUniverse,
    markSectorVisited,
} from '../db/queries/player.js';
import { getSectorDbId } from '../db/queries/sector.js';
import { getStartingShipTypeByName, insertStartingShip } from '../db/queries/ship.js';

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
            const universe = await createUniverse(name);
            res.status(201).json({ universeId: universe.id, name: universe.name });
        } catch (err) {
            console.error('Create universe error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.get('/api/universes', authenticateToken, async (req, res) => {
        const { userId } = getAuthenticatedPlayer(req);
        try {
            const rows = await listUniversesForUser(userId);
            const universes = rows.map((r) => ({
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
            const editDefaults = await getUniverseEditDefaults(universeId);
            if (!editDefaults) {
                return res.status(404).json({ error: 'Universe not found' });
            }

            const startSector = newPlayerConfig.startingSector;
            const startingTurns = editDefaults.starting_turns ?? 500;
            const startingCredits =
                editDefaults.starting_credits ?? newPlayerConfig.startingCredits;
            const startingShip = editDefaults.starting_ship ?? newPlayerConfig.startingShip;
            const startingDrones = editDefaults.starting_drones ?? newPlayerConfig.startingDrones;

            const startSectorId = await getSectorDbId(startSector, universeId);
            if (startSectorId === undefined) {
                return res.status(500).json({ error: 'Starting sector not found' });
            }

            const playerId = await insertPlayer(
                name,
                userId,
                universeId,
                startSectorId,
                startingCredits,
                startingTurns,
            );

            const startShipType = await getStartingShipTypeByName(startingShip);
            if (startShipType) {
                const newShipId = await insertStartingShip(
                    playerId,
                    startShipType.id,
                    startSectorId,
                    startingDrones,
                    newPlayerConfig.startingShields,
                    startShipType.starting_holds,
                    startShipType.turns_per_warp,
                );
                await setPlayerShipId(playerId, newShipId);
            }

            await markSectorVisited(playerId, startSectorId);

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
            const rows = await listPlayersInUniverse(universeId);
            res.json(
                rows.map((r) => ({
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

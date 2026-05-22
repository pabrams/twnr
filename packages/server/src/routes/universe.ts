import { Router } from 'express';
import { z } from 'zod';
import type { RouteDeps, Middleware } from './middleware.js';
import { asyncHandler, HttpError, parseBody, parseIntParam } from './async-handler.js';
import { universeConfig } from '@twnr/shared';

const NameBodySchema = z.object({
    name: z
        .string()
        .min(1)
        .refine((s) => s.trim().length > 0, 'name is required'),
});
import {
    createUniverse,
    listUniversesForUser,
    getUniverseTemplateDefaults,
} from '../db/queries/universe.js';
import { insertPlayer, listPlayersInUniverse, markSectorVisited } from '../db/queries/player.js';
import { getSectorDbId } from '../db/queries/sector.js';

export function createUniverseRoutes(
    router: Router,
    deps: RouteDeps,
    middleware: Middleware,
): void {
    const { getAuthenticatedPlayer } = deps;
    const { authenticateToken } = middleware;

    router.post(
        '/api/universes',
        authenticateToken,
        asyncHandler(async (req, res) => {
            const { name } = parseBody(req, NameBodySchema);

            const universe = await createUniverse(name);
            res.status(201).json({ universeId: universe.id, name: universe.name });
        }),
    );

    router.get(
        '/api/universes',
        authenticateToken,
        asyncHandler(async (req, res) => {
            const { userId } = getAuthenticatedPlayer(req);
            const rows = await listUniversesForUser(userId);
            const universes = rows.map((r) => ({
                id: r.id,
                name: r.name,
                createdAt: r.created_at,
                playerId: r.player_id ?? null,
                playerName: r.player_name ?? null,
            }));
            res.json(universes);
        }),
    );

    router.post(
        '/api/universes/:id/join',
        authenticateToken,
        asyncHandler(async (req, res) => {
            const { userId } = getAuthenticatedPlayer(req);
            const universeId = parseIntParam(req.params.id, 'id');
            const { name } = parseBody(req, NameBodySchema);

            const templateDefaults = await getUniverseTemplateDefaults(universeId);
            if (!templateDefaults) {
                throw new HttpError(404, 'Universe not found');
            }

            const startSector = universeConfig.startingSector;
            const startingTurns = templateDefaults.starting_turns ?? universeConfig.startingTurns;
            const startingCredits =
                templateDefaults.starting_credits ?? universeConfig.startingCredits;

            const startSectorId = await getSectorDbId(startSector, universeId);
            if (startSectorId === undefined) {
                throw new HttpError(500, 'Starting sector not found');
            }

            let playerId: number;
            try {
                playerId = await insertPlayer(
                    name,
                    userId,
                    universeId,
                    startSectorId,
                    startingCredits,
                    startingTurns,
                );
            } catch (err) {
                if ((err as { code?: string }).code === '23505') {
                    throw new HttpError(409, 'Already joined this universe');
                }
                throw err;
            }

            await markSectorVisited(playerId, startSectorId);

            res.status(201).json({ playerId, universeId });
        }),
    );

    router.get(
        '/api/universes/:id/players',
        authenticateToken,
        asyncHandler(async (req, res) => {
            const universeId = parseIntParam(req.params.id, 'id');
            const rows = await listPlayersInUniverse(universeId);
            res.json(
                rows.map((r) => ({
                    name: r.name,
                    shipName: r.ship_name,
                    coloredShipName: r.ship_display_name,
                    clanNumber: r.clan_number,
                    clanName: r.clan_name,
                    reputation: r.reputation,
                    experience: r.experience,
                })),
            );
        }),
    );
}

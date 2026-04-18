import { Router } from 'express';
import type { ServerStatsResponse } from '@twnr/shared';
import type { RouteDeps, Middleware } from '../middleware.js';
import { countAllPlayers } from '../../db/queries/player.js';
import { countAllSectors } from '../../db/queries/sector.js';

export function createAdminStatsRoutes(
    router: Router,
    deps: RouteDeps,
    middleware: Middleware,
): void {
    const { players } = deps;
    const { authenticateAdmin } = middleware;

    router.get('/api/admin/server-stats', authenticateAdmin, async (_req, res) => {
        try {
            const [totalPlayers, totalSectors] = await Promise.all([
                countAllPlayers(),
                countAllSectors(),
            ]);
            const body: ServerStatsResponse = {
                uptime: process.uptime(),
                playersOnline: Object.keys(players).length,
                totalPlayers,
                totalSectors,
                nodeVersion: process.version,
                platform: process.platform,
            };
            res.json(body);
        } catch {
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}

import { Router } from 'express';
import { pool } from '../../db/index.js';
import type { ServerStatsResponse } from '@twnr/shared';
import type { RouteDeps, Middleware } from '../middleware.js';

export function createAdminStatsRoutes(
    router: Router,
    deps: RouteDeps,
    middleware: Middleware,
): void {
    const { players } = deps;
    const { authenticateAdmin } = middleware;

    router.get('/api/admin/server-stats', authenticateAdmin, async (_req, res) => {
        try {
            const playerCount = await pool.query('SELECT COUNT(*) FROM players');
            const sectorCount = await pool.query('SELECT COUNT(*) FROM sectors');
            const body: ServerStatsResponse = {
                uptime: process.uptime(),
                playersOnline: Object.keys(players).length,
                totalPlayers: parseInt(playerCount.rows[0].count, 10),
                totalSectors: parseInt(sectorCount.rows[0].count, 10),
                nodeVersion: process.version,
                platform: process.platform,
            };
            res.json(body);
        } catch {
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}

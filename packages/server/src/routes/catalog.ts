import { Router } from 'express';
import { class0Prices } from '../game-config.js';
import type { Middleware } from './middleware.js';
import { asyncHandler, parseIntParam } from './async-handler.js';
import { pool } from '../db/index.js';
import { listHardwareCatalog } from '../db/queries/hardware.js';

export function createCatalogRoutes(router: Router, _middleware: Middleware): void {
    router.get('/api/class0-prices', (_req, res) => {
        res.json(class0Prices);
    });

    // Ship catalog for a universe (universe_id query param required).
    router.get(
        '/api/ships',
        asyncHandler(async (req, res) => {
            const universeId = parseIntParam(req.query.universe_id as string, 'universe_id');
            const [shipTypesRes, hwRes] = await Promise.all([
                pool.query(
                    `SELECT * FROM universe_ship_types WHERE universe_id = $1 ORDER BY sort_order, slug`,
                    [universeId],
                ),
                pool.query<{ ship_type_slug: string; name: string; max_quantity: number }>(
                    `SELECT sth.ship_type_slug, hi.name, sth.max_quantity
                     FROM universe_ship_type_hardware sth
                     JOIN hardware_item hi ON hi.id = sth.hardware_item_id
                     WHERE sth.universe_id = $1`,
                    [universeId],
                ),
            ]);
            const hwBySlug: Record<string, Record<string, number>> = {};
            for (const h of hwRes.rows) {
                if (!hwBySlug[h.ship_type_slug]) hwBySlug[h.ship_type_slug] = {};
                hwBySlug[h.ship_type_slug][h.name] = h.max_quantity;
            }
            const result = shipTypesRes.rows.map((st) => ({
                ...st,
                hardware: hwBySlug[st.slug] ?? {},
            }));
            res.json(result);
        }),
    );

    router.get(
        '/api/planets',
        asyncHandler(async (req, res) => {
            const universeId = parseIntParam(req.query.universe_id as string, 'universe_id');
            const result = await pool.query(
                `SELECT * FROM universe_planet_types WHERE universe_id = $1 ORDER BY slug`,
                [universeId],
            );
            res.json(result.rows);
        }),
    );

    router.get(
        '/api/hardware',
        asyncHandler(async (_req, res) => {
            const items = await listHardwareCatalog();
            res.json(items);
        }),
    );
}

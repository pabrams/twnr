import { Router } from 'express';
import { holdBaseCostNow, HOLD_COST_INCREMENT } from '@twnr/shared';
import { class0Prices } from '../game-config.js';
import type { Middleware } from './middleware.js';
import { asyncHandler, parseIntParam } from './async-handler.js';
import { listHardwareCatalog, listShipTypeHardwareMaxForUniverse } from '../db/queries/hardware.js';
import { listUniverseShipTypes } from '../db/queries/ship.js';
import { listUniversePlanetTypes } from '../db/queries/planet.js';

export function createCatalogRoutes(router: Router, _middleware: Middleware): void {
    router.get('/api/class0-prices', (_req, res) => {
        // Compute today's base cost so the client can render the next-hold
        // price without re-deriving it.
        res.json({
            ...class0Prices,
            holdCostIncrement: HOLD_COST_INCREMENT,
            holdBaseCost: holdBaseCostNow(
                class0Prices.holdBaseCostMin,
                class0Prices.holdBaseCostMax,
                class0Prices.holdCostPeriodDays,
            ),
        });
    });

    // Ship catalog for a universe (universe_id query param required).
    router.get(
        '/api/ships',
        asyncHandler(async (req, res) => {
            const universeId = parseIntParam(req.query.universe_id as string, 'universe_id');
            const [shipTypes, hwRows] = await Promise.all([
                listUniverseShipTypes(universeId),
                listShipTypeHardwareMaxForUniverse(universeId),
            ]);
            const hwBySlug: Record<string, Record<string, number>> = {};
            for (const h of hwRows) {
                if (!hwBySlug[h.ship_type_slug]) hwBySlug[h.ship_type_slug] = {};
                hwBySlug[h.ship_type_slug][h.name] = h.max_quantity;
            }
            const result = shipTypes.map((st) => ({
                ...st,
                hardware: hwBySlug[st.slug as string] ?? {},
            }));
            res.json(result);
        }),
    );

    router.get(
        '/api/planets',
        asyncHandler(async (req, res) => {
            const universeId = parseIntParam(req.query.universe_id as string, 'universe_id');
            const result = await listUniversePlanetTypes(universeId);
            res.json(result);
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

import { Router } from 'express';
import type { RouteDeps, Middleware } from '../middleware.js';
import { PORT_CLASS_ACTIONS } from '@twnr/shared';
import { asyncHandler, HttpError, parseIntParam } from '../async-handler.js';
import { universeExists } from '../../db/queries/universe.js';
import { getSectorDbId } from '../../db/queries/sector.js';
import {
    listPortsInUniverse,
    getPortAdminRowByUniverseSector,
    portExistsForSector,
    updatePortFull,
    insertPort,
    deletePort,
    type PortAdminRow,
} from '../../db/queries/port.js';

interface PortFields {
    class: number;
    fuel: number;
    fuelPrice: number;
    organics: number;
    orgPrice: number;
    equipment: number;
    equPrice: number;
}

/**
 * Parse port fields from a request body. When `existing` is provided, missing
 * fields fall back to the existing row's values (PUT semantics); otherwise all
 * fields are required (POST semantics). Throws HttpError(400) on bad input.
 */
function parsePortFields(body: Record<string, unknown>, existing?: PortAdminRow): PortFields {
    const pick = (bodyKey: string, existingVal?: number): number => {
        const raw = body[bodyKey];
        if (raw !== undefined) {
            const n = parseInt(String(raw), 10);
            if (isNaN(n)) throw new HttpError(400, `${bodyKey} must be a number`);
            return n;
        }
        if (existingVal !== undefined) return existingVal;
        throw new HttpError(400, `${bodyKey} is required`);
    };

    return {
        class: pick('class', existing?.class),
        fuel: pick('fuel', existing?.fuel),
        fuelPrice: pick('fuelPrice', existing?.fuel_price),
        organics: pick('organics', existing?.organics),
        orgPrice: pick('orgPrice', existing?.org_price),
        equipment: pick('equipment', existing?.equipment),
        equPrice: pick('equPrice', existing?.equ_price),
    };
}

function validateCommodityQuantities(f: PortFields): string | null {
    for (const [name, val] of [
        ['fuel', f.fuel],
        ['organics', f.organics],
        ['equipment', f.equipment],
    ] as const) {
        if (val < 0 || val > 5000) return `${name} must be 0-5000`;
    }
    return null;
}

export function validatePortPrices(
    portClass: number,
    fuelPrice: number,
    orgPrice: number,
    equPrice: number,
): string | null {
    const actions = PORT_CLASS_ACTIONS[portClass];
    if (!actions) return null;

    const commodities = [
        { name: 'fuel', action: actions.fuel, price: fuelPrice },
        { name: 'organics', action: actions.organics, price: orgPrice },
        { name: 'equipment', action: actions.equipment, price: equPrice },
    ];

    for (const c of commodities) {
        if (c.action === 'S' && (c.price < 10 || c.price > 50)) {
            return `${c.name} is a selling commodity for class ${portClass} and price must be 10-50, got ${c.price}`;
        }
        if (c.action === 'B' && (c.price < 51 || c.price > 100)) {
            return `${c.name} is a buying commodity for class ${portClass} and price must be 51-100, got ${c.price}`;
        }
    }
    return null;
}

export function createAdminPortRoutes(
    router: Router,
    deps: RouteDeps,
    middleware: Middleware,
): void {
    const { authenticateAdmin } = middleware;
    void deps;

    router.get(
        '/api/admin/universes/:id/ports',
        authenticateAdmin,
        asyncHandler(async (req, res) => {
            const universeId = parseIntParam(req.params.id, 'id');

            if (!(await universeExists(universeId))) {
                throw new HttpError(404, 'Universe not found');
            }

            const rows = await listPortsInUniverse(universeId);
            const ports = rows.map((r) => ({
                sectorId: r.sector_id,
                class: r.class,
                fuel: r.fuel,
                fuelPrice: r.fuel_price,
                organics: r.organics,
                orgPrice: r.org_price,
                equipment: r.equipment,
                equPrice: r.equ_price,
            }));

            res.json(ports);
        }),
    );

    router.put(
        '/api/admin/universes/:id/ports/:sectorId',
        authenticateAdmin,
        asyncHandler(async (req, res) => {
            const universeId = parseIntParam(req.params.id, 'id');
            const sectorId = parseIntParam(req.params.sectorId, 'sectorId');

            if (!(await universeExists(universeId))) {
                throw new HttpError(404, 'Universe not found');
            }

            const existing = await getPortAdminRowByUniverseSector(sectorId, universeId);
            if (!existing) {
                throw new HttpError(404, 'Port not found');
            }

            if (existing.class === 0 || existing.class === 9) {
                throw new HttpError(403, 'Cannot modify special port');
            }

            const fields = parsePortFields(req.body, existing);

            if (fields.class < 1 || fields.class > 8) {
                throw new HttpError(400, 'class must be 1-8');
            }

            const qtyError = validateCommodityQuantities(fields);
            if (qtyError) throw new HttpError(400, qtyError);

            const priceError = validatePortPrices(
                fields.class,
                fields.fuelPrice,
                fields.orgPrice,
                fields.equPrice,
            );
            if (priceError) throw new HttpError(400, priceError);

            await updatePortFull(existing.id, fields);

            res.json({ sectorId, ...fields });
        }),
    );

    router.post(
        '/api/admin/universes/:id/ports/:sectorId',
        authenticateAdmin,
        asyncHandler(async (req, res) => {
            const universeId = parseIntParam(req.params.id, 'id');
            const sectorId = parseIntParam(req.params.sectorId, 'sectorId');

            if (!(await universeExists(universeId))) {
                throw new HttpError(404, 'Universe not found');
            }

            const sectorDbId = await getSectorDbId(sectorId, universeId);
            if (sectorDbId === undefined) {
                throw new HttpError(404, 'Sector not found');
            }

            if (await portExistsForSector(sectorDbId)) {
                throw new HttpError(409, 'Port already exists');
            }

            const fields = parsePortFields(req.body);

            if (fields.class < 1 || fields.class > 8) {
                throw new HttpError(400, 'class must be 1-8 for trading ports');
            }

            const qtyError = validateCommodityQuantities(fields);
            if (qtyError) throw new HttpError(400, qtyError);

            const priceError = validatePortPrices(
                fields.class,
                fields.fuelPrice,
                fields.orgPrice,
                fields.equPrice,
            );
            if (priceError) throw new HttpError(400, priceError);

            await insertPort(sectorDbId, fields);

            res.status(201).json({ sectorId, ...fields });
        }),
    );

    router.delete(
        '/api/admin/universes/:id/ports/:sectorId',
        authenticateAdmin,
        asyncHandler(async (req, res) => {
            const universeId = parseIntParam(req.params.id, 'id');
            const sectorId = parseIntParam(req.params.sectorId, 'sectorId');

            if (!(await universeExists(universeId))) {
                throw new HttpError(404, 'Universe not found');
            }

            const portRow = await getPortAdminRowByUniverseSector(sectorId, universeId);
            if (!portRow) {
                throw new HttpError(404, 'Port not found');
            }

            if (portRow.class === 0 || portRow.class === 9) {
                throw new HttpError(403, 'Cannot delete special port');
            }

            await deletePort(portRow.id);

            res.json({ deleted: true, sectorId });
        }),
    );
}

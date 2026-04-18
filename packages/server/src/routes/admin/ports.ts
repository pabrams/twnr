import { Router } from 'express';
import type { RouteDeps, Middleware } from '../middleware.js';
import { universeExists } from '../../db/queries/universe.js';
import { getSectorDbId } from '../../db/queries/sector.js';
import {
    listPortsInUniverse,
    getPortAdminRowByUniverseSector,
    portExistsForSector,
    updatePortFull,
    insertPort,
    deletePort,
} from '../../db/queries/port.js';

export const PORT_CLASS_ACTIONS: Record<number, [string, string, string]> = {
    1: ['B', 'B', 'S'],
    2: ['B', 'S', 'B'],
    3: ['S', 'B', 'B'],
    4: ['S', 'S', 'B'],
    5: ['B', 'S', 'S'],
    6: ['S', 'B', 'S'],
    7: ['S', 'S', 'S'],
    8: ['B', 'B', 'B'],
};

export function validatePortPrices(
    portClass: number,
    fuelPrice: number,
    orgPrice: number,
    equPrice: number,
): string | null {
    const actions = PORT_CLASS_ACTIONS[portClass];
    if (!actions) return null;

    const commodities = [
        { name: 'fuel', action: actions[0], price: fuelPrice },
        { name: 'organics', action: actions[1], price: orgPrice },
        { name: 'equipment', action: actions[2], price: equPrice },
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

    router.get('/api/admin/universes/:id/ports', authenticateAdmin, async (req, res) => {
        const universeId = parseInt(req.params.id as string, 10);

        try {
            if (!(await universeExists(universeId))) {
                return res.status(404).json({ error: 'Universe not found' });
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
        } catch (err) {
            console.error('List ports error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.put('/api/admin/universes/:id/ports/:sectorId', authenticateAdmin, async (req, res) => {
        const universeId = parseInt(req.params.id as string, 10);
        const sectorId = parseInt(req.params.sectorId as string, 10);

        try {
            if (!(await universeExists(universeId))) {
                return res.status(404).json({ error: 'Universe not found' });
            }

            const existing = await getPortAdminRowByUniverseSector(sectorId, universeId);
            if (!existing) {
                return res.status(404).json({ error: 'Port not found' });
            }

            // Reject special ports
            if (existing.class === 0 || existing.class === 9) {
                return res.status(403).json({ error: 'Cannot modify special port' });
            }

            // Merge updates with existing values
            const newClass =
                req.body.class !== undefined ? parseInt(req.body.class, 10) : existing.class;
            const newFuel =
                req.body.fuel !== undefined ? parseInt(req.body.fuel, 10) : existing.fuel;
            const newFuelPrice =
                req.body.fuelPrice !== undefined
                    ? parseInt(req.body.fuelPrice, 10)
                    : existing.fuel_price;
            const newOrganics =
                req.body.organics !== undefined
                    ? parseInt(req.body.organics, 10)
                    : existing.organics;
            const newOrgPrice =
                req.body.orgPrice !== undefined
                    ? parseInt(req.body.orgPrice, 10)
                    : existing.org_price;
            const newEquipment =
                req.body.equipment !== undefined
                    ? parseInt(req.body.equipment, 10)
                    : existing.equipment;
            const newEquPrice =
                req.body.equPrice !== undefined
                    ? parseInt(req.body.equPrice, 10)
                    : existing.equ_price;

            if (newClass < 1 || newClass > 8) {
                return res.status(400).json({ error: 'class must be 1-8' });
            }

            for (const [name, val] of [
                ['fuel', newFuel],
                ['organics', newOrganics],
                ['equipment', newEquipment],
            ] as const) {
                if (val < 0 || val > 5000) {
                    return res.status(400).json({ error: `${name} must be 0-5000` });
                }
            }

            const priceError = validatePortPrices(newClass, newFuelPrice, newOrgPrice, newEquPrice);
            if (priceError) {
                return res.status(400).json({ error: priceError });
            }

            await updatePortFull(existing.id, {
                class: newClass,
                fuel: newFuel,
                fuelPrice: newFuelPrice,
                organics: newOrganics,
                orgPrice: newOrgPrice,
                equipment: newEquipment,
                equPrice: newEquPrice,
            });

            res.json({
                sectorId,
                class: newClass,
                fuel: newFuel,
                fuelPrice: newFuelPrice,
                organics: newOrganics,
                orgPrice: newOrgPrice,
                equipment: newEquipment,
                equPrice: newEquPrice,
            });
        } catch (err) {
            console.error('Update port error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.post('/api/admin/universes/:id/ports/:sectorId', authenticateAdmin, async (req, res) => {
        const universeId = parseInt(req.params.id as string, 10);
        const sectorId = parseInt(req.params.sectorId as string, 10);

        try {
            if (!(await universeExists(universeId))) {
                return res.status(404).json({ error: 'Universe not found' });
            }

            const sectorDbId = await getSectorDbId(sectorId, universeId);
            if (sectorDbId === undefined) {
                return res.status(404).json({ error: 'Sector not found' });
            }

            if (await portExistsForSector(sectorDbId)) {
                return res.status(409).json({ error: 'Port already exists' });
            }

            const {
                class: portClass,
                fuel,
                fuelPrice,
                organics,
                orgPrice,
                equipment,
                equPrice,
            } = req.body;

            const cls = parseInt(portClass, 10);
            if (isNaN(cls) || cls < 1 || cls > 8) {
                return res.status(400).json({ error: 'class must be 1-8 for trading ports' });
            }

            const fuelQty = parseInt(fuel, 10);
            const orgQty = parseInt(organics, 10);
            const equQty = parseInt(equipment, 10);
            for (const [name, val] of [
                ['fuel', fuelQty],
                ['organics', orgQty],
                ['equipment', equQty],
            ] as const) {
                if (isNaN(val) || val < 0 || val > 5000) {
                    return res.status(400).json({ error: `${name} must be 0-5000` });
                }
            }

            const fp = parseInt(fuelPrice, 10);
            const op = parseInt(orgPrice, 10);
            const ep = parseInt(equPrice, 10);

            if (isNaN(fp) || isNaN(op) || isNaN(ep)) {
                return res.status(400).json({ error: 'all price fields are required' });
            }

            const priceError = validatePortPrices(cls, fp, op, ep);
            if (priceError) {
                return res.status(400).json({ error: priceError });
            }

            await insertPort(sectorDbId, {
                class: cls,
                fuel: fuelQty,
                fuelPrice: fp,
                organics: orgQty,
                orgPrice: op,
                equipment: equQty,
                equPrice: ep,
            });

            res.status(201).json({
                sectorId,
                class: cls,
                fuel: fuelQty,
                fuelPrice: fp,
                organics: orgQty,
                orgPrice: op,
                equipment: equQty,
                equPrice: ep,
            });
        } catch (err) {
            console.error('Create port error', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.delete(
        '/api/admin/universes/:id/ports/:sectorId',
        authenticateAdmin,
        async (req, res) => {
            const universeId = parseInt(req.params.id as string, 10);
            const sectorId = parseInt(req.params.sectorId as string, 10);

            try {
                if (!(await universeExists(universeId))) {
                    return res.status(404).json({ error: 'Universe not found' });
                }

                const portRow = await getPortAdminRowByUniverseSector(sectorId, universeId);
                if (!portRow) {
                    return res.status(404).json({ error: 'Port not found' });
                }

                if (portRow.class === 0 || portRow.class === 9) {
                    return res.status(403).json({ error: 'Cannot delete special port' });
                }

                await deletePort(portRow.id);

                res.json({ deleted: true, sectorId });
            } catch (err) {
                console.error('Delete port error', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        },
    );
}

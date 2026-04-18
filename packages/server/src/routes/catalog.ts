import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { shipConfigs, SHIPS_DIR, reloadShipConfigs } from '../ship-config.js';
import { planetConfigs, PLANETS_DIR, reloadPlanetConfigs } from '../planet-config.js';
import { class0Prices } from '../game-config.js';
import type { Middleware } from './middleware.js';
import type { MenuRow } from '../db/types.js';
import { asyncHandler } from './async-handler.js';
import {
    listShipTypes,
    listShipTypeHardware,
    listMenus,
    listMenuCommands,
} from '../db/queries/catalog.js';

function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

export function createCatalogRoutes(router: Router, middleware: Middleware): void {
    const { authenticateAdmin } = middleware;

    router.get('/api/class0-prices', (_req, res) => {
        res.json(class0Prices);
    });

    router.get(
        '/api/ships',
        asyncHandler(async (_req, res) => {
            const [shipTypes, allHw] = await Promise.all([listShipTypes(), listShipTypeHardware()]);
            const hwByType: Record<number, Record<string, number>> = {};
            for (const h of allHw) {
                if (!hwByType[h.ship_type_id]) hwByType[h.ship_type_id] = {};
                hwByType[h.ship_type_id][h.name] = h.max_quantity;
            }
            const result = shipTypes.map((st) => ({
                ...st,
                hardware: hwByType[st.id] ?? {},
            }));
            res.json(result);
        }),
    );

    router.get('/api/planets', (_req, res) => {
        const planets = Object.values(planetConfigs).sort((a, b) => a.type.localeCompare(b.type));
        res.json(planets);
    });

    // Menu registry: menus + commands, cached by client for the session
    router.get(
        '/api/menu-registry',
        asyncHandler(async (_req, res) => {
            const [menus, commands] = await Promise.all([listMenus(), listMenuCommands()]);

            const menuMap = new Map<number, MenuRow>(menus.map((m) => [m.id, m]));
            const registry = menus.map((m) => ({
                name: m.name,
                label: m.label,
                parentMenu: m.parent_menu_id ? (menuMap.get(m.parent_menu_id)?.name ?? null) : null,
                commands: commands
                    .filter((c) => c.menu_id === m.id)
                    .map((c) => ({
                        command: c.command_name,
                        keyPattern: c.key_pattern,
                        label: c.mc_label || c.command_label,
                        clientMsgType: c.client_msg_type || null,
                        targetMenu: c.target_menu_id
                            ? (menuMap.get(c.target_menu_id)?.name ?? null)
                            : null,
                        sortOrder: c.sort_order,
                    })),
            }));

            res.json(registry);
        }),
    );

    router.get('/api/admin/ships/:name', authenticateAdmin, (req, res) => {
        const ship = shipConfigs[req.params.name as string];
        if (!ship) return res.status(404).json({ error: 'Ship not found' });
        res.json(ship);
    });

    router.put('/api/admin/ships/:name', authenticateAdmin, (req, res) => {
        const existing = shipConfigs[req.params.name as string];
        if (!existing) return res.status(404).json({ error: 'Ship not found' });

        const updated = { ...existing, ...req.body, name: req.params.name as string };
        const filePath = path.join(SHIPS_DIR, `${slugify(updated.name)}.json`);
        try {
            fs.writeFileSync(filePath, JSON.stringify(updated), 'utf-8');
            reloadShipConfigs();
            res.json(shipConfigs[updated.name]);
        } catch (err) {
            console.error('Update ship error', err);
            res.status(500).json({ error: 'Failed to write config' });
        }
    });

    router.post('/api/admin/ships', authenticateAdmin, (req, res) => {
        const { name, maxDrones, maxShields, startingHolds, maxHolds, price } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });
        if (shipConfigs[name]) return res.status(409).json({ error: 'Ship already exists' });

        const ship = { name, maxDrones, maxShields, startingHolds, maxHolds, price };
        const filePath = path.join(SHIPS_DIR, `${slugify(name)}.json`);
        try {
            fs.writeFileSync(filePath, JSON.stringify(ship), 'utf-8');
            reloadShipConfigs();
            res.status(201).json(shipConfigs[name]);
        } catch (err) {
            console.error('Create ship error', err);
            res.status(500).json({ error: 'Failed to write config' });
        }
    });

    router.delete('/api/admin/ships/:name', authenticateAdmin, (req, res) => {
        const existing = shipConfigs[req.params.name as string];
        if (!existing) return res.status(404).json({ error: 'Ship not found' });

        const filePath = path.join(SHIPS_DIR, `${slugify(req.params.name as string)}.json`);
        try {
            fs.unlinkSync(filePath);
            reloadShipConfigs();
            res.json({ deleted: true, name: req.params.name as string });
        } catch (err) {
            console.error('Delete ship error', err);
            res.status(500).json({ error: 'Failed to delete config' });
        }
    });

    router.get('/api/admin/planets/:type', authenticateAdmin, (req, res) => {
        const planet = planetConfigs[req.params.type as string];
        if (!planet) return res.status(404).json({ error: 'Planet type not found' });
        res.json(planet);
    });

    router.put('/api/admin/planets/:type', authenticateAdmin, (req, res) => {
        const existing = planetConfigs[req.params.type as string];
        if (!existing) return res.status(404).json({ error: 'Planet type not found' });

        const updated = { ...existing, ...req.body, type: req.params.type as string };
        const filePath = path.join(PLANETS_DIR, `${slugify(updated.type)}.json`);
        try {
            fs.writeFileSync(filePath, JSON.stringify(updated), 'utf-8');
            reloadPlanetConfigs();
            res.json(planetConfigs[updated.type]);
        } catch (err) {
            console.error('Update planet error', err);
            res.status(500).json({ error: 'Failed to write config' });
        }
    });

    router.post('/api/admin/planets', authenticateAdmin, (req, res) => {
        const { type } = req.body;
        if (!type) return res.status(400).json({ error: 'type is required' });
        if (planetConfigs[type])
            return res.status(409).json({ error: 'Planet type already exists' });

        const planet = { ...req.body };
        const filePath = path.join(PLANETS_DIR, `${slugify(type)}.json`);
        try {
            fs.writeFileSync(filePath, JSON.stringify(planet), 'utf-8');
            reloadPlanetConfigs();
            res.status(201).json(planetConfigs[type]);
        } catch (err) {
            console.error('Create planet error', err);
            res.status(500).json({ error: 'Failed to write config' });
        }
    });

    router.delete('/api/admin/planets/:type', authenticateAdmin, (req, res) => {
        const existing = planetConfigs[req.params.type as string];
        if (!existing) return res.status(404).json({ error: 'Planet type not found' });

        const filePath = path.join(PLANETS_DIR, `${slugify(req.params.type as string)}.json`);
        try {
            fs.unlinkSync(filePath);
            reloadPlanetConfigs();
            res.json({ deleted: true, type: req.params.type as string });
        } catch (err) {
            console.error('Delete planet error', err);
            res.status(500).json({ error: 'Failed to delete config' });
        }
    });
}

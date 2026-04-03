import { Router } from 'express';
import { shipConfigs } from '../ship-config.js';
import { planetConfigs } from '../planet-config.js';

export function createCatalogRoutes(router: Router): void {
    router.get('/api/ships', (_req, res) => {
        const ships = Object.values(shipConfigs).sort((a: any, b: any) => a.price - b.price);
        res.json(ships);
    });

    router.get('/api/planets', (_req, res) => {
        const planets = Object.values(planetConfigs).sort((a: any, b: any) =>
            a.type.localeCompare(b.type),
        );
        res.json(planets);
    });
}

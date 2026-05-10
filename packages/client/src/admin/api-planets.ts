import { adminFetch } from './api.js';

export interface PlanetConfig {
    type: string;
    description: string;
    maxFuelColos: number;
    maxOrgColos: number;
    maxEquColos: number;
    maxCitadel: number;
    fuelProduction: number;
    organicsProduction: number;
    equipmentProduction: number;
}

export function listPlanets(): Promise<PlanetConfig[]> {
    return adminFetch('/api/planets');
}

export function getPlanet(type: string): Promise<PlanetConfig> {
    return adminFetch(`/api/admin/planets/${encodeURIComponent(type)}`);
}

export function createPlanet(planet: PlanetConfig): Promise<PlanetConfig> {
    return adminFetch('/api/admin/planets', {
        method: 'POST',
        body: JSON.stringify(planet),
    });
}

export function updatePlanet(type: string, params: Partial<PlanetConfig>): Promise<PlanetConfig> {
    return adminFetch(`/api/admin/planets/${encodeURIComponent(type)}`, {
        method: 'PUT',
        body: JSON.stringify(params),
    });
}

export function deletePlanet(type: string): Promise<{ deleted: boolean; type: string }> {
    return adminFetch(`/api/admin/planets/${encodeURIComponent(type)}`, { method: 'DELETE' });
}

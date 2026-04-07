import { adminFetch } from './api.js';

export interface ShipConfig {
    name: string;
    maxDrones: number;
    maxShields: number;
    startingHolds: number;
    maxHolds: number;
    price: number;
}

export function listShips(): Promise<ShipConfig[]> {
    return adminFetch('/api/ships');
}

export function getShip(name: string): Promise<ShipConfig> {
    return adminFetch(`/api/admin/ships/${encodeURIComponent(name)}`);
}

export function createShip(ship: ShipConfig): Promise<ShipConfig> {
    return adminFetch('/api/admin/ships', {
        method: 'POST',
        body: JSON.stringify(ship),
    });
}

export function updateShip(name: string, params: Partial<ShipConfig>): Promise<ShipConfig> {
    return adminFetch(`/api/admin/ships/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify(params),
    });
}

export function deleteShip(name: string): Promise<{ deleted: boolean; name: string }> {
    return adminFetch(`/api/admin/ships/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

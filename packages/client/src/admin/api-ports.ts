import { adminFetch } from './api.js';

export interface PortInfo {
    sectorId: number;
    class: number;
    fuel: number;
    fuelPrice: number;
    organics: number;
    orgPrice: number;
    equipment: number;
    equPrice: number;
}

export interface PortUpdateParams {
    class?: number;
    fuel?: number;
    fuelPrice?: number;
    organics?: number;
    orgPrice?: number;
    equipment?: number;
    equPrice?: number;
}

export interface PortCreateParams {
    class: number;
    fuel: number;
    fuelPrice: number;
    organics: number;
    orgPrice: number;
    equipment: number;
    equPrice: number;
}

export function listPorts(universeId: number): Promise<PortInfo[]> {
    return adminFetch(`/api/admin/universes/${universeId}/ports`);
}

export function updatePort(opts: {
    universeId: number;
    sectorId: number;
    params: PortUpdateParams;
}): Promise<PortInfo> {
    const { universeId, sectorId, params } = opts;
    return adminFetch(`/api/admin/universes/${universeId}/ports/${sectorId}`, {
        method: 'PUT',
        body: JSON.stringify(params),
    });
}

export function createPort(opts: {
    universeId: number;
    sectorId: number;
    params: PortCreateParams;
}): Promise<PortInfo> {
    const { universeId, sectorId, params } = opts;
    return adminFetch(`/api/admin/universes/${universeId}/ports/${sectorId}`, {
        method: 'POST',
        body: JSON.stringify(params),
    });
}

export function deletePort(opts: {
    universeId: number;
    sectorId: number;
}): Promise<{ deleted: boolean; sectorId: number }> {
    const { universeId, sectorId } = opts;
    return adminFetch(`/api/admin/universes/${universeId}/ports/${sectorId}`, { method: 'DELETE' });
}

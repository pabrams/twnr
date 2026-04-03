// Types for API responses

export interface ServerStats {
    uptime: number;
    playersOnline: number;
    totalPlayers: number;
    totalSectors: number;
    nodeVersion: string;
    platform: string;
}

export interface UniverseStats {
    id: number;
    name: string;
    seed: number;
    createdAt: string;
    sectorCount: number;
    warpCount: number;
    portCount: number;
    playerCount: number;
}

export interface UniverseTopology {
    totalSectors: number;
    totalWarps: number;
    bidirectionalPairs: number;
    averageOutDegree: number;
    deadEndSectors: number[];
    isConnected: boolean;
}

export interface GenerateUniverseParams {
    name: string;
    sectors: number;
    seed?: number;
    portDensity?: number;
    twoWayPct?: number;
}

export interface GenerateUniverseResult {
    id: number;
    name: string;
    seed: number;
    sectorCount: number;
    warpCount: number;
    portCount: number;
}

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

// API helper
async function adminFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options?.headers || {}),
        },
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed: ${res.status}`);
    }
    return res.json();
}

// Server stats
export function getServerStats(): Promise<ServerStats> {
    return adminFetch('/api/admin/server-stats');
}

// Universe lifecycle
export function generateUniverse(params: GenerateUniverseParams): Promise<GenerateUniverseResult> {
    return adminFetch('/api/admin/universes/generate', {
        method: 'POST',
        body: JSON.stringify(params),
    });
}

export function getUniverseStats(id: number): Promise<UniverseStats> {
    return adminFetch(`/api/admin/universes/${id}/stats`);
}

export function getUniverseTopology(id: number): Promise<UniverseTopology> {
    return adminFetch(`/api/admin/universes/${id}/topology`);
}

export function deleteUniverse(id: number): Promise<{ deleted: boolean; id: number }> {
    return adminFetch(`/api/admin/universes/${id}`, { method: 'DELETE' });
}

export function renameUniverse(id: number, name: string): Promise<{ id: number; name: string }> {
    return adminFetch(`/api/admin/universes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
    });
}

export function cloneUniverse(id: number, name: string): Promise<GenerateUniverseResult> {
    return adminFetch(`/api/admin/universes/${id}/clone`, {
        method: 'POST',
        body: JSON.stringify({ name }),
    });
}

// Port management
export function listPorts(universeId: number): Promise<PortInfo[]> {
    return adminFetch(`/api/admin/universes/${universeId}/ports`);
}

export function updatePort(
    universeId: number,
    sectorId: number,
    params: PortUpdateParams,
): Promise<PortInfo> {
    return adminFetch(`/api/admin/universes/${universeId}/ports/${sectorId}`, {
        method: 'PUT',
        body: JSON.stringify(params),
    });
}

export function createPort(
    universeId: number,
    sectorId: number,
    params: PortCreateParams,
): Promise<PortInfo> {
    return adminFetch(`/api/admin/universes/${universeId}/ports/${sectorId}`, {
        method: 'POST',
        body: JSON.stringify(params),
    });
}

export function deletePort(
    universeId: number,
    sectorId: number,
): Promise<{ deleted: boolean; sectorId: number }> {
    return adminFetch(`/api/admin/universes/${universeId}/ports/${sectorId}`, { method: 'DELETE' });
}

// Ship config management
export interface ShipConfig {
    name: string;
    maxFighters: number;
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

// Planet config management
export interface PlanetConfig {
    type: string;
    description: string;
    maxColonists: number;
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

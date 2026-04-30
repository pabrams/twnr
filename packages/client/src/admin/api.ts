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
    warpDist?: number[];
    topology?: 'random' | 'proximal';
    fillDensity?: number;
    maxPathLength?: number;
}

export interface GenerateUniverseResult {
    id: number;
    name: string;
    seed: number;
    sectorCount: number;
    warpCount: number;
    portCount: number;
}

export async function adminFetch<T>(path: string, options?: RequestInit): Promise<T> {
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

export function getServerStats(): Promise<ServerStats> {
    return adminFetch('/api/admin/server-stats');
}

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

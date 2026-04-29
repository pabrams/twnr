import { listSectorNumbers, listWarpEdges } from '../db/queries/sector.js';

/**
 * In-memory adjacency list per universe. Built lazily on first access and
 * invalidated only on universe create/delete (via invalidateGraphCache).
 * Warps don't change at runtime so this cache never goes stale during
 * normal play.
 */
const graphCache = new Map<number, number[][]>();

export async function getGraph(universeId: number): Promise<number[][]> {
    const cached = graphCache.get(universeId);
    if (cached) return cached;

    const [sectorNumbers, edges] = await Promise.all([
        listSectorNumbers(universeId),
        listWarpEdges(universeId),
    ]);
    if (sectorNumbers.length === 0) return [];

    const maxId = sectorNumbers[sectorNumbers.length - 1];
    const adjacencyList: number[][] = [];
    for (let i = 0; i <= maxId; i++) adjacencyList[i] = [];

    for (const e of edges) {
        if (adjacencyList[e.from]) adjacencyList[e.from].push(e.to);
    }

    graphCache.set(universeId, adjacencyList);
    return adjacencyList;
}

export function invalidateGraphCache(universeId: number): void {
    graphCache.delete(universeId);
}

import { PROXIMAL_PLANE_SIZE } from './types.js';

export interface Position {
    x: number;
    y: number;
}

/**
 * Poisson-disc sample N points in [0, size]² with a minimum pairwise distance.
 *
 * Uses a uniform grid of cellSize = minDist / sqrt(2) so every cell holds at
 * most one point and collision checks only need to inspect the 5x5 cell window
 * around the candidate.
 */
export function scatterPositions(
    N: number,
    rng: () => number,
    size: number = PROXIMAL_PLANE_SIZE,
): Position[] {
    if (N < 1) return [];
    // Minimum pairwise distance per spec: size / (2 * sqrt(N)).
    const minDist = size / (2 * Math.sqrt(N));
    const minDistSq = minDist * minDist;
    const cellSize = minDist / Math.SQRT2;
    const numCells = Math.ceil(size / cellSize) + 1;
    // Grid holds index into positions[], or -1 if empty.
    const grid = new Int32Array(numCells * numCells);
    grid.fill(-1);
    const positions: Position[] = [];

    function cellIdx(cx: number, cy: number): number {
        return cx + cy * numCells;
    }

    const MAX_ATTEMPTS = 200;
    for (let i = 0; i < N; i++) {
        let placed = false;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const x = rng() * size;
            const y = rng() * size;
            const cx = Math.min(numCells - 1, Math.floor(x / cellSize));
            const cy = Math.min(numCells - 1, Math.floor(y / cellSize));
            let conflict = false;
            for (let dy = -2; dy <= 2 && !conflict; dy++) {
                const ny = cy + dy;
                if (ny < 0 || ny >= numCells) continue;
                for (let dx = -2; dx <= 2 && !conflict; dx++) {
                    const nx = cx + dx;
                    if (nx < 0 || nx >= numCells) continue;
                    const idx = grid[cellIdx(nx, ny)];
                    if (idx < 0) continue;
                    const p = positions[idx];
                    const ddx = p.x - x;
                    const ddy = p.y - y;
                    if (ddx * ddx + ddy * ddy < minDistSq) {
                        conflict = true;
                    }
                }
            }
            if (!conflict) {
                grid[cellIdx(cx, cy)] = positions.length;
                positions.push({ x, y });
                placed = true;
                break;
            }
        }
        if (!placed) {
            throw new Error(
                `scatterPositions: failed to place point ${i + 1}/${N} (minDist=${minDist.toFixed(2)})`,
            );
        }
    }
    return positions;
}

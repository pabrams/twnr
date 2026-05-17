import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateUniverse, defaultBigBangOptions } from '../dist/bigbang/index.js';

// Edge endpoints in proximal mode carry (x, y); wormholes are the long-range
// shortcuts added by Phase 5 of graph-proximal.ts. Use Euclidean distance vs
// the hex cell pitch to classify.
function classifyEdgesByDistance(result) {
    return result.warps.map((w) => {
        const a = result.sectors[w.from - 1];
        const b = result.sectors[w.to - 1];
        return { ...w, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    });
}

describe('Wormhole bidirectionality (default flag = true)', () => {
    it('every long-range edge has a reverse edge', () => {
        // Use a tight diameter cap to maximize the number of wormholes.
        const opts = defaultBigBangOptions({
            sectors: 200,
            seed: 12345,
            topology: 'proximal',
            maxShortestPath: 'packed',
        });
        const result = generateUniverse(opts);
        const edges = classifyEdgesByDistance(result);
        // Cutoff: anything > 1.8 × cell pitch is a wormhole. Cell pitch is
        // HEX_CELL_SIZE (100) × HEX_SPACING_MULTIPLIER (1.4) = 140.
        const WORMHOLE_DIST = 100 * 1.4 * 1.8;
        const wormholes = edges.filter((e) => e.dist > WORMHOLE_DIST);
        assert.ok(wormholes.length > 0, 'expected at least one wormhole in 200-sector packed universe');
        const edgeSet = new Set(result.warps.map((w) => `${w.from},${w.to}`));
        for (const w of wormholes) {
            assert.ok(
                edgeSet.has(`${w.to},${w.from}`),
                `wormhole ${w.from}→${w.to} (dist=${w.dist.toFixed(0)}) has no reverse`,
            );
        }
    });
});

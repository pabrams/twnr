import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateUniverse, defaultBigBangOptions } from '../dist/bigbang/index.js';

function classifyEdgesByDistance(result) {
    return result.warps.map((w) => {
        const a = result.sectors[w.from - 1];
        const b = result.sectors[w.to - 1];
        return { ...w, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    });
}

describe('Wormhole bidirectionality (default flag = true)', () => {
    it('every long-range edge has a reverse edge', () => {
        const opts = defaultBigBangOptions({
            sectors: 200,
            seed: 12345,
            topology: 'proximal',
            maxShortestPath: 'packed',
        });
        const result = generateUniverse(opts);
        const edges = classifyEdgesByDistance(result);
        // 1.8 × cell pitch, where pitch = HEX_CELL_SIZE (100) × HEX_SPACING_MULTIPLIER (1.4)
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

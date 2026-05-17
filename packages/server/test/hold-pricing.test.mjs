import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    HOLD_COST_INCREMENT,
    holdBaseCostForDay,
    holdCostFromZero,
    holdCostRange,
    nextHoldCost,
    maxAffordableHolds,
} from '@twnr/shared';

describe('Hold pricing — increment constant', () => {
    it('is 20', () => {
        assert.equal(HOLD_COST_INCREMENT, 20);
    });
});

describe('Hold pricing — cumulative cost formula', () => {
    it('100 holds from 0 with B=200 costs 119,000 (worked example)', () => {
        // From spec: (200*100) + (20*100)*(100-1)/2 = 20000 + 99000 = 119000
        assert.equal(holdCostFromZero(100, 200), 119000);
    });

    it('51st hold (going from 50 → 51) at B=164 costs 1164 (worked example)', () => {
        // Spec: "you have 50 holds, and to get to 51 holds, it costs 1164"
        assert.equal(holdCostRange(50, 51, 164), 1164);
        assert.equal(nextHoldCost(50, 164), 1164);
    });

    it('50 → 250 with B=164 costs 630,800 (worked example, spec arithmetic was off by 10k)', () => {
        // Spec claims 250 from 0 = 663,500 and 50 from 0 = 32,700 (both
        // correct), then says the diff is 620,800 — but 663,500 − 32,700
        // = 630,800. We honor the per-hold formula, not the typo.
        assert.equal(holdCostFromZero(250, 164), 663500);
        assert.equal(holdCostFromZero(50, 164), 32700);
        assert.equal(holdCostRange(50, 250, 164), 630800);
    });

    it('zero or negative quantity is free', () => {
        assert.equal(holdCostFromZero(0, 200), 0);
        assert.equal(holdCostRange(50, 50, 200), 0);
        assert.equal(holdCostFromZero(-5, 200), 0);
    });
});

describe('Hold pricing — daily base cost triangular wave', () => {
    // Default cycle: min=151, max=249, period=18, half=9.
    it('day 0 is min', () => {
        assert.equal(holdBaseCostForDay(0, 151, 249, 18), 151);
    });
    it('day 9 (midpoint) is max', () => {
        assert.equal(holdBaseCostForDay(9, 151, 249, 18), 249);
    });
    it('day 18 is min again (one full cycle later)', () => {
        assert.equal(holdBaseCostForDay(18, 151, 249, 18), 151);
    });
    it('day 4 is mid-way up the rising half', () => {
        // 151 + round(98 * 4/9) ≈ 151 + 44 = 195
        assert.equal(holdBaseCostForDay(4, 151, 249, 18), 195);
    });
    it('day 13 is mid-way down the falling half', () => {
        // phase=13, second branch: max - round(98 * (13-9)/9) = 249 - 44 = 205
        assert.equal(holdBaseCostForDay(13, 151, 249, 18), 205);
    });
    it('handles negative days via modular wrap', () => {
        assert.equal(holdBaseCostForDay(-18, 151, 249, 18), 151);
        assert.equal(holdBaseCostForDay(-9, 151, 249, 18), 249);
    });
    it('returns min when min === max', () => {
        assert.equal(holdBaseCostForDay(5, 200, 200, 18), 200);
    });
});

describe('Hold pricing — maxAffordableHolds', () => {
    it('returns 0 when broke', () => {
        assert.equal(maxAffordableHolds(0, 0, 200), 0);
        assert.equal(maxAffordableHolds(50, 100, 200), 0);
    });

    it('matches the worked example: 119,000 credits buys exactly 100 holds at B=200 from 0', () => {
        assert.equal(maxAffordableHolds(0, 119000, 200), 100);
    });

    it('one credit short of the 100-hold threshold buys 99', () => {
        assert.equal(maxAffordableHolds(0, 118999, 200), 99);
    });

    it('starting at 50, 630,800 credits buys exactly 200 more (to 250) at B=164', () => {
        assert.equal(maxAffordableHolds(50, 630800, 164), 200);
    });
});

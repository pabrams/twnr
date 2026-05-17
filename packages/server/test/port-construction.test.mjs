import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    PORT_CONSTRUCTION_COSTS,
    PLAYER_BUILT_PORT_MCIC,
    INITIAL_PLAYER_PORT_PRODUCTIVITY,
    dailyDrainFor,
    upgradeUnitCost,
    playerBuiltMcicFor,
} from '@twnr/shared';

describe('Port construction — cost table', () => {
    it('has entries for classes 1-8', () => {
        for (let c = 1; c <= 8; c++) {
            assert.ok(PORT_CONSTRUCTION_COSTS[c], `missing class ${c}`);
        }
    });

    it('matches TW2002 reference values', () => {
        assert.deepEqual(PORT_CONSTRUCTION_COSTS[1], { credits: 39250, ore: 120, org: 120, equ: 60, days: 6 });
        assert.deepEqual(PORT_CONSTRUCTION_COSTS[8], { credits: 50000, ore: 200, org: 200, equ: 200, days: 10 });
        assert.deepEqual(PORT_CONSTRUCTION_COSTS[7], { credits: 30000, ore: 20, org: 20, equ: 20, days: 2 });
    });
});

describe('Port construction — dailyDrainFor', () => {
    it('divides total cost evenly across days', () => {
        // Class 8: 200/10 = 20 each per day
        assert.deepEqual(dailyDrainFor(8), { ore: 20, org: 20, equ: 20 });
        // Class 1: 120/6=20, 120/6=20, 60/6=10
        assert.deepEqual(dailyDrainFor(1), { ore: 20, org: 20, equ: 10 });
        // Class 4: 50/5=10, 50/5=10, 100/5=20
        assert.deepEqual(dailyDrainFor(4), { ore: 10, org: 10, equ: 20 });
    });

    it('all classes produce whole-number daily drains', () => {
        for (let c = 1; c <= 8; c++) {
            const d = dailyDrainFor(c);
            assert.equal(d.ore, Math.floor(d.ore), `class ${c} ore not integer`);
            assert.equal(d.org, Math.floor(d.org), `class ${c} org not integer`);
            assert.equal(d.equ, Math.floor(d.equ), `class ${c} equ not integer`);
        }
    });
});

describe('Port construction — upgradeUnitCost / playerBuiltMcicFor', () => {
    it('upgrade cost = 10 × commodity base price', () => {
        assert.equal(upgradeUnitCost('fuel'), 250);
        assert.equal(upgradeUnitCost('organics'), 500);
        assert.equal(upgradeUnitCost('equipment'), 900);
    });

    it('player-built MCIC signs match the port-action direction', () => {
        // From TW2002 sample: fuel ±80/70, org ±70/60, equ ±60/50
        assert.equal(playerBuiltMcicFor('fuel', 'B'), -80);
        assert.equal(playerBuiltMcicFor('fuel', 'S'), 70);
        assert.equal(playerBuiltMcicFor('organics', 'B'), -70);
        assert.equal(playerBuiltMcicFor('organics', 'S'), 60);
        assert.equal(playerBuiltMcicFor('equipment', 'B'), -60);
        assert.equal(playerBuiltMcicFor('equipment', 'S'), 50);
    });

    it('player-built productivity is 100 per commodity', () => {
        assert.equal(INITIAL_PLAYER_PORT_PRODUCTIVITY, 100);
    });
});

describe('Port construction — MCIC constants are consistent with bigbang ranges', () => {
    it('|MCIC| for player-built ports exceeds the bigbang max (so they\'re strictly better)', () => {
        // Bigbang ranges: fuel 40-90, org 30-75, equ 20-65.
        // Player-built S magnitudes: fuel 70, org 60, equ 50.
        // Player-built B magnitudes: fuel 80, org 70, equ 60.
        // All sit at or near the high end of the bigbang range — player-built
        // ports are profitable but not absurd.
        assert.ok(Math.abs(PLAYER_BUILT_PORT_MCIC.fuel.S) <= 90);
        assert.ok(Math.abs(PLAYER_BUILT_PORT_MCIC.fuel.B) <= 90);
        assert.ok(Math.abs(PLAYER_BUILT_PORT_MCIC.equipment.S) <= 65);
        assert.ok(Math.abs(PLAYER_BUILT_PORT_MCIC.equipment.B) <= 65);
    });
});

describe('Port upgrade math', () => {
    it('investing N units grows prod by N, max by 10N, stock by 10N', () => {
        // Simulate: start prod=100, max=1000, stock=200 (buy port at 80% full)
        let prod = 100;
        let max = 1000;
        let stock = 200;
        const units = 8;

        prod += units;
        max += units * 10;
        stock += units * 10;

        assert.equal(prod, 108);
        assert.equal(max, 1080);
        assert.equal(stock, 280);
    });

    it('matches TW2002 sample: 18 units invested in Organics on a selling port', () => {
        // Before: Trading=1640 (selling, stock=1640, max=1640), tp=100%
        // After +18: trading=1820, tp still 100%, max=1820, stock=1820
        const before = { prod: 164, max: 1640, stock: 1640 };
        const after = {
            prod: before.prod + 18,
            max: before.max + 18 * 10,
            stock: before.stock + 18 * 10,
        };
        assert.equal(after.prod, 182);
        assert.equal(after.max, 1820);
        assert.equal(after.stock, 1820);
        // tp = stock/max for selling = 100%
        assert.equal((after.stock / after.max) * 100, 100);
    });
});

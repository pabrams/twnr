import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    COMMODITY_PRICING,
    priceAt100FromMcic,
    computeUnitPrice,
    computeUnitPriceWithXp,
    xpPriceMultiplier,
    tradingDisplayed,
    tradingPercentDisplay,
    upgradeUnitCost,
} from '@twnr/shared';

describe('Port pricing — priceAt100', () => {
    it('returns base price when |MCIC| = 0', () => {
        for (const c of ['fuel', 'organics', 'equipment']) {
            assert.equal(priceAt100FromMcic(c, 0), COMMODITY_PRICING[c].base);
        }
    });

    it('grows linearly with |MCIC| at the documented slopes', () => {
        assert.equal(priceAt100FromMcic('fuel', 50), 35);
        assert.equal(priceAt100FromMcic('organics', -60), 74);
        assert.equal(priceAt100FromMcic('equipment', 40), 118);
    });
});

describe('Port pricing — computeUnitPrice (selling port)', () => {
    it('returns base when tp <= floorTp', () => {
        // selling port: tp = stock/max. stock=5, max=100 → 5% < floor 10%
        assert.equal(computeUnitPrice('fuel', 5, 100, 50, 'S'), COMMODITY_PRICING.fuel.base);
        // edge: tp = floorTp → base
        assert.equal(computeUnitPrice('fuel', 10, 100, 50, 'S'), COMMODITY_PRICING.fuel.base);
    });

    it('reaches priceAt100 when stock == max (tp=100)', () => {
        assert.equal(computeUnitPrice('fuel', 1000, 1000, 50, 'S'), 35);
        assert.equal(computeUnitPrice('organics', 2000, 2000, 60, 'S'), 74);
        assert.equal(computeUnitPrice('equipment', 500, 500, 40, 'S'), 118);
    });

    it('floors interpolated values', () => {
        // fuel S-port at tp=55%, MCIC=50: 25 + 10*(55-10)/90 = 30. Floored = 30.
        assert.equal(computeUnitPrice('fuel', 55, 100, 50, 'S'), 30);
        // tp=54%: 25 + 10*(54-10)/90 = 29.888... Floored = 29.
        assert.equal(computeUnitPrice('fuel', 54, 100, 50, 'S'), 29);
    });
});

describe('Port pricing — computeUnitPrice (buying port)', () => {
    it('tp uses (max-stock)/max for buying ports', () => {
        // buying port at stock=0, max=1000 → tp=100% → priceAt100
        assert.equal(computeUnitPrice('fuel', 0, 1000, -50, 'B'), 35);
        // buying port at stock=max → tp=0% < floor → base
        assert.equal(computeUnitPrice('fuel', 1000, 1000, -50, 'B'), 25);
    });

    it('drops below 100% as the port fills from selling', () => {
        // tp=55% buying = stock at 45% of max
        assert.equal(computeUnitPrice('fuel', 45, 100, -50, 'B'), 30);
    });
});

describe('Port pricing — tradingDisplayed (legacy-style)', () => {
    it('selling: shows stock', () => {
        assert.equal(tradingDisplayed('S', 1640, 1640), 1640);
        assert.equal(tradingDisplayed('S', 800, 1000), 800);
    });
    it('buying: shows max - stock', () => {
        // Real sample: max=1240, stock=285 → trading shown = 955
        assert.equal(tradingDisplayed('B', 285, 1240), 955);
        assert.equal(tradingDisplayed('B', 0, 1240), 1240); // freshly spawned
    });
    it('floors fractional stock', () => {
        assert.equal(tradingDisplayed('B', 285.7, 1240), 954);
        assert.equal(tradingDisplayed('S', 1639.9, 1640), 1639);
    });
});

describe('Port pricing — tradingPercentDisplay', () => {
    it('matches legacy floor convention', () => {
        // Real sample: max=1240, stock=285 → trading%=77 (floor of 77.02%)
        assert.equal(tradingPercentDisplay('B', 285, 1240), 77);
        // After upgrade: max=1320, stock=365 → 72% (floor of 72.35%)
        assert.equal(tradingPercentDisplay('B', 365, 1320), 72);
        // Selling at 100%
        assert.equal(tradingPercentDisplay('S', 1640, 1640), 100);
    });
});

describe('Port pricing — upgradeUnitCost', () => {
    it('matches the legacy $250/$500/$900 pricing', () => {
        assert.equal(upgradeUnitCost('fuel'), 250);
        assert.equal(upgradeUnitCost('organics'), 500);
        assert.equal(upgradeUnitCost('equipment'), 900);
    });
});

describe('Port pricing — xpPriceMultiplier', () => {
    it('is 1.0 at xp=0', () => {
        assert.equal(xpPriceMultiplier(0, 'S'), 1);
        assert.equal(xpPriceMultiplier(0, 'B'), 1);
    });

    it('plateaus at 1000 xp', () => {
        assert.equal(xpPriceMultiplier(1000, 'S'), 0.72);
        assert.equal(xpPriceMultiplier(1000, 'B'), 1.07);
        assert.equal(xpPriceMultiplier(5000, 'S'), 0.72);
    });

    it('is linear between 0 and 1000', () => {
        assert.equal(xpPriceMultiplier(500, 'S'), 1 - 0.28 * 0.5);
        assert.equal(xpPriceMultiplier(500, 'B'), 1 + 0.07 * 0.5);
    });
});

describe('Port pricing — computeUnitPriceWithXp', () => {
    it('applies xp multiplier and floors', () => {
        const raw = computeUnitPrice('fuel', 1000, 1000, 50, 'S'); // 35
        const withXp = computeUnitPriceWithXp('fuel', 1000, 1000, 50, 1000, 'S');
        assert.equal(withXp, Math.floor(raw * 0.72));
    });
});

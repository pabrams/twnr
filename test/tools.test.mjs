import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getRandomInt } from '../dist/tools.js';

describe('getRandomInt', () => {
  it('returns a number between min and max (inclusive)', () => {
    const result = getRandomInt(1, 10);
    assert.ok(result >= 1 && result <= 10);
  });

  it('returns min when min equals max', () => {
    const result = getRandomInt(5, 5);
    assert.equal(result, 5);
  });

  it('throws when min is NaN', () => {
    assert.throws(() => getRandomInt(NaN, 10), /Both min and max must be numbers/);
  });

  it('throws when max is NaN', () => {
    assert.throws(() => getRandomInt(1, NaN), /Both min and max must be numbers/);
  });

  it('throws when min is greater than max', () => {
    assert.throws(() => getRandomInt(10, 1), /min should be less than or equal to max/);
  });
});

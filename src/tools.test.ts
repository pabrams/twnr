import { getRandomInt } from './tools';

describe('getRandomInt', () => {
  it('should generate a number between min and max (inclusive)', () => {
    const min = 1;
    const max = 10;
    const result = getRandomInt(min, max);
    expect(result).toBeGreaterThanOrEqual(min);
    expect(result).toBeLessThanOrEqual(max);
  });
});

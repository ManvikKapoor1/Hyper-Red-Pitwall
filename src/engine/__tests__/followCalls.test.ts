/**
 * Follow the calls: the real car burns more or less than the plan assumed and
 * the pitwall does exactly what STINT's top call says (box / change mode).
 * The car must never run out of fuel or energy while a stop was possible.
 */
import { describe, expect, test } from 'vitest';
import { followRace } from './helpers';

describe('following the calls keeps the car running', () => {
  for (const [fb, eb] of [
    [0, 0],
    [0.03, 0],
    [0, 0.03],
    [-0.04, -0.04],
    [0.06, 0.05],
    [0.1, 0.1],
    [0.15, 0],
    [0, 0.12],
  ]) {
    test(`fuel ${fb >= 0 ? '+' : ''}${fb * 100}% · energy ${eb >= 0 ? '+' : ''}${eb * 100}% vs plan`, () => {
      const out: string[] = [];
      let raced = 0;
      for (let seed = 1; seed <= 300 && raced < 40; seed++) {
        const r = followRace(seed, fb, eb);
        if (!r) continue;
        raced++;
        if (r.length) out.push(`seed ${seed}: ${r[0]}`);
      }
      expect(raced).toBeGreaterThan(15);
      expect(out.slice(0, 8)).toEqual([]);
    });
  }
});

/**
 * Property tests: random races, cars and plans must always produce a
 * self-consistent simulation (conservation of fuel / energy / time,
 * contiguous laps and stints, pit timing that matches the pit model).
 */
import { describe, expect, test } from 'vitest';
import { buildPlan } from '../planner';
import { calculateStrategy } from '../simulate';
import { checkResult, randomCase } from './helpers';

describe('simulation invariants (random races)', () => {
  test('800 random plans stay self-consistent', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 800; seed++) {
      const c = randomCase(seed);
      const res = calculateStrategy(c.race, c.setup, c.plan, c.drivers, c.opts);
      const bad = checkResult(c, res);
      if (bad.length) failures.push(`${c.label}: ${bad.slice(0, 4).join(' | ')}`);
    }
    expect(failures.slice(0, 15)).toEqual([]);
  });
});

describe('the invariant checker itself', () => {
  test('catches tampered results', () => {
    const c = randomCase(7);
    const res = calculateStrategy(c.race, c.setup, c.plan, c.drivers, c.opts);
    expect(checkResult(c, res)).toEqual([]);
    const t1 = structuredClone(res);
    t1.stints[0].fuelEndL += 1;
    expect(checkResult(c, t1).length).toBeGreaterThan(0);
    const t2 = structuredClone(res);
    if (t2.stops[0]) t2.stops[0].totalLossSec += 1;
    else t2.laps[0].lapMs += 1000;
    expect(checkResult(c, t2).length).toBeGreaterThan(0);
    const t3 = structuredClone(res);
    t3.laps.pop();
    expect(checkResult(c, t3).length).toBeGreaterThan(0);
  });
});

describe('auto-build', () => {
  test('built plans fit every stint inside fuel, energy, tire and driver limits', () => {
    const faults = new Set(['FUEL_OUT', 'ENERGY_OUT', 'STINT_BEYOND_SAFE', 'DRIVER_MAX', 'TIRE_OVER_MAX', 'TANK_TOO_SMALL']);
    const bad: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const c = randomCase(seed);
      for (const distribution of ['even', 'maxFirst'] as const) {
        const plan = buildPlan(c.race, c.setup, c.drivers, { tireEvery: 1, driverOrder: c.drivers.map((d) => d.id), compound: 'HARD', distribution });
        const res = calculateStrategy(c.race, c.setup, plan, c.drivers);
        const f = res.issues.filter((i) => faults.has(i.code));
        if (f.length) bad.push(`seed ${seed} ${distribution}: ${f[0].message}`);
      }
    }
    expect(bad.slice(0, 8)).toEqual([]);
  });
});

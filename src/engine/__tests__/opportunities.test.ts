/**
 * Where to gain: a prediction is only worth showing if applying it gives
 * exactly the race it promised. Drive random races to mid-race, scan the
 * options, apply each one the way the UI does and compare the live
 * projection with the prediction.
 */
import { describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../factory';
import { projectLive } from '../live';
import { applyQuickUpdate, prepareGrid, recordPitStop, startRaceLive } from '../liveOps';
import { findOpportunities } from '../opportunities';
import { autoBalance, buildPlan, clonePlan } from '../planner';
import { liveSimOptions } from '../live';
import { calculateStrategy } from '../simulate';
import type { CarEntry, Race } from '../types';
import { randomCase } from './helpers';

const settings = DEFAULT_SETTINGS;

function midRace(seed: number, share: number): { race: Race; car: CarEntry } | null {
  const c = randomCase(seed);
  const truth = calculateStrategy(c.race, c.setup, c.plan, c.drivers, c.opts);
  if (!truth.feasible || truth.totalLaps > 220 || truth.stops.length < 2) return null;
  const car: CarEntry = { id: 'car', number: '1', teamName: 'T', setup: c.setup, drivers: c.drivers, plan: c.plan, planDirty: false, versions: [], live: undefined as unknown as CarEntry['live'] };
  const race: Race = { id: 'r', params: c.race, status: 'LIVE', isDemo: false, sample: false, cars: [car], activeCarId: 'car', events: c.opts.events ?? [], plannedEvents: [], clock: { running: false, anchorRaceSec: 0, anchorEpochMs: 0, speed: 1 }, createdAt: '', updatedAt: '' };
  car.live = startRaceLive(prepareGrid(race, car, settings));
  const stopAt = new Map(truth.stops.map((s) => [s.lap, s]));
  const until = Math.max(3, Math.floor(truth.totalLaps * share));
  for (const lap of truth.laps) {
    if (lap.lap > until) break;
    const stop = stopAt.get(lap.lap);
    if (stop) {
      car.live = recordPitStop(car, { inLap: lap.lap, inLapMs: lap.lapMs, fuelAddedL: stop.fuelAddedL, energyAfterPct: c.setup.energyEnabled ? lap.energyAfterPct + stop.energyAddedPct : undefined, changeTires: stop.changeTires, compound: stop.compound, toDriverId: stop.toDriverId, stationarySec: stop.stationarySec, totalLossSec: stop.totalLossSec }, lap.endSec, settings);
    } else {
      car.live = applyQuickUpdate(car, { lapsCompleted: lap.lap, raceTimeSec: lap.endSec, fuelL: lap.fuelAfterL, energyPct: c.setup.energyEnabled ? lap.energyAfterPct : undefined, tireAge: lap.tireAge, lastLapMs: lap.lapMs }, lap.endSec, settings, race.events);
    }
  }
  return { race, car };
}

describe('where to gain', () => {
  test('applying an option gives the projection it predicted', () => {
    const out: string[] = [];
    let scanned = 0;
    let options = 0;
    for (let seed = 1; seed <= 200 && scanned < 40; seed++) {
      for (const share of [0.2, 0.55]) {
        const s = midRace(seed, share);
        if (!s) continue;
        const scan = findOpportunities(s.race, s.car, settings);
        if (!scan) continue;
        scanned++;
        // the current plan row is the live projection
        const now = projectLive(s.race, s.car, settings, s.car.live.lastLapEndSec);
        if (now.totalLaps !== scan.base.totalLaps || Math.abs(now.finishSec - scan.base.finishSec) > 1e-6)
          out.push(`seed ${seed}@${share}: base ${scan.base.totalLaps}/${scan.base.finishSec.toFixed(2)} vs live ${now.totalLaps}/${now.finishSec.toFixed(2)}`);
        for (const o of scan.list.filter((x) => x.risk !== 'HIGH')) {
          options++;
          const live = { ...s.car.live, pitLapOverrides: { ...(o.option.simOverrides ?? s.car.live.pitLapOverrides) } };
          const car = { ...s.car, plan: clonePlan(o.option.plan), live };
          const race = { ...s.race, cars: [car] };
          const p = projectLive(race, car, settings, live.lastLapEndSec);
          if (p.totalLaps !== o.metrics.totalLaps || Math.abs(p.finishSec - o.metrics.finishSec) > 1e-6)
            out.push(`seed ${seed}@${share} "${o.title}": predicted ${o.metrics.totalLaps} laps/${o.metrics.finishSec.toFixed(2)} s, applied ${p.totalLaps}/${p.finishSec.toFixed(2)}`);
          if (p.sim.stops.map((x) => x.lap).join() !== o.metrics.result.stops.map((x) => x.lap).join())
            out.push(`seed ${seed}@${share} "${o.title}": stops ${p.sim.stops.map((x) => x.lap).join()} vs predicted ${o.metrics.result.stops.map((x) => x.lap).join()}`);
          if (!Number.isFinite(o.gainSec) || !Number.isFinite(o.gainLaps)) out.push(`seed ${seed}: non-finite gain`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(20);
    expect(options).toBeGreaterThan(20);
    expect(out.slice(0, 10)).toEqual([]);
  });
});

describe('mid-race auto-build', () => {
  const faults = new Set(['FUEL_OUT', 'ENERGY_OUT', 'STINT_BEYOND_SAFE', 'DRIVER_MAX', 'TIRE_OVER_MAX', 'TANK_TOO_SMALL']);
  test('rebuilds only the stints after the current one and they fit the limits', () => {
    const out: string[] = [];
    let built = 0;
    for (let seed = 1; seed <= 200 && built < 40; seed++) {
      const s = midRace(seed, 0.4);
      if (!s) continue;
      built++;
      const { race, car } = s;
      const keepFirst = car.live.stintIndex + 1;
      const sim = liveSimOptions(race, car, settings);
      for (const distribution of ['even', 'maxFirst'] as const) {
        const plan = buildPlan(race.params, car.setup, car.drivers, { tireEvery: 2, driverOrder: car.drivers.map((d) => d.id), compound: car.live.compound, distribution, base: car.plan, keepFirst, sim });
        const kept = JSON.stringify(plan.stints.slice(0, keepFirst - 1).map((x) => [x.driverId, x.targetLaps, x.mode]));
        if (kept !== JSON.stringify(car.plan.stints.slice(0, keepFirst - 1).map((x) => [x.driverId, x.targetLaps, x.mode]))) out.push(`seed ${seed}: completed stints changed`);
        const res = calculateStrategy(race.params, car.setup, plan, car.drivers, sim);
        const bad = res.issues.filter((i) => faults.has(i.code) && (i.stint == null || i.stint >= keepFirst));
        if (bad.length) out.push(`seed ${seed} ${distribution}: ${bad[0].message}`);
        // re-balance keeps the structure and stays within limits
        const rb = autoBalance(race.params, car.setup, car.drivers, plan, keepFirst, { distribution, sim });
        if (rb.stints.length !== plan.stints.length) out.push(`seed ${seed}: re-balance changed stint count`);
        const rbRes = calculateStrategy(race.params, car.setup, rb, car.drivers, sim);
        const rbBad = rbRes.issues.filter((i) => faults.has(i.code) && (i.stint == null || i.stint >= keepFirst));
        if (rbBad.length) out.push(`seed ${seed} ${distribution} re-balance: ${rbBad[0].message}`);
      }
    }
    expect(built).toBeGreaterThan(20);
    expect(out.slice(0, 10)).toEqual([]);
  });
});

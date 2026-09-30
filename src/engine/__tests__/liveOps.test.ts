import { describe, expect, test } from 'vitest';
import { createDemoRace } from '../../data/samples';
import { DEFAULT_SETTINGS } from '../factory';
import { measureFuelPerLap, projectLive, referenceLapMs } from '../live';
import { applyQuickUpdate, checkFlag, recordPitStop } from '../liveOps';
import { validateRaceData } from '../validate';
import { generateRaceCalls } from '../calls';

const race = createDemoRace();
const car = race.cars[0];
const L = car.live;

describe('quick update', () => {
  test('one lap with everything entered', () => {
    const live = applyQuickUpdate(car, { lapsCompleted: L.lapsCompleted + 1, raceTimeSec: L.lastLapEndSec + 96, fuelL: L.fuelL - 2.9, energyPct: L.energyPct - 3.9, tireAge: L.tireAge + 1, lastLapMs: 96000 }, L.lastLapEndSec + 96, DEFAULT_SETTINGS);
    const rec = live.laps[live.laps.length - 1];
    expect(rec.lap).toBe(L.lapsCompleted + 1);
    expect(rec.fuelUsedL).toBeCloseTo(2.9, 9);
    expect(rec.energyUsedPct).toBeCloseTo(3.9, 9);
    expect(rec.tireAge).toBe(L.tireAge + 1);
    expect(rec.estimated).toBe(false);
    expect(live.fuelL).toBeCloseTo(L.fuelL - 2.9, 9);
    expect(live.lastLapMs).toBe(96000);
  });
  test('three laps at once split evenly and keep ages consistent', () => {
    const live = applyQuickUpdate(car, { lapsCompleted: L.lapsCompleted + 3, raceTimeSec: L.lastLapEndSec + 288, fuelL: L.fuelL - 9, tireAge: L.tireAge + 3 }, L.lastLapEndSec + 288, DEFAULT_SETTINGS);
    const recs = live.laps.slice(-3);
    expect(recs.map((r) => r.lap)).toEqual([L.lapsCompleted + 1, L.lapsCompleted + 2, L.lapsCompleted + 3]);
    recs.forEach((r) => expect(r.fuelUsedL).toBeCloseTo(3, 9));
    expect(recs.map((r) => r.tireAge)).toEqual([L.tireAge + 1, L.tireAge + 2, L.tireAge + 3]);
    expect(recs[2].fuelAfterL).toBeCloseTo(L.fuelL - 9, 9);
    expect(recs[2].endSec).toBeCloseTo(L.lastLapEndSec + 288, 9);
    expect(recs.every((r) => r.estimated)).toBe(true);
    // an average over three laps is not a lap time
    expect(live.lastLapMs).toBe(L.lastLapMs);
    expect(live.bestLapMs).toBe(L.bestLapMs);
  });
  test('entered tire age defines every lap of the update', () => {
    const live = applyQuickUpdate(car, { lapsCompleted: L.lapsCompleted + 2, tireAge: 5 }, L.lastLapEndSec + 190, DEFAULT_SETTINGS);
    expect(live.laps.slice(-2).map((r) => r.tireAge)).toEqual([4, 5]);
    expect(live.tireAge).toBe(5);
  });
  test('fuel used instead of fuel remaining', () => {
    const live = applyQuickUpdate(car, { lapsCompleted: L.lapsCompleted + 1, fuelUsedL: 2.95 }, L.lastLapEndSec + 96, DEFAULT_SETTINGS);
    expect(live.fuelL).toBeCloseTo(L.fuelL - 2.95, 9);
    expect(live.laps[live.laps.length - 1].fuelUsedL).toBeCloseTo(2.95, 9);
  });
  test('lap correction drops later laps', () => {
    const live = applyQuickUpdate(car, { lapsCompleted: L.lapsCompleted - 2 }, L.lastLapEndSec, DEFAULT_SETTINGS);
    expect(live.lapsCompleted).toBe(L.lapsCompleted - 2);
    expect(live.laps[live.laps.length - 1].lap).toBe(L.lapsCompleted - 2);
  });
  test('laps under a scenario are tagged', () => {
    const ev = { id: 'e', type: 'SAFETY_CAR' as const, label: 'SC', startSec: L.lastLapEndSec - 10, durationSec: 600, lapDeltaSec: 30, fuelReductionPct: 20, energyReductionPct: 20, pitOpen: true };
    const live = applyQuickUpdate(car, { lapsCompleted: L.lapsCompleted + 1, fuelL: L.fuelL - 2.3, lastLapMs: 126000 }, L.lastLapEndSec + 126, DEFAULT_SETTINGS, [ev]);
    expect(live.laps[live.laps.length - 1].event).toBe('SAFETY_CAR');
    expect(live.bestLapMs).toBe(L.bestLapMs);
  });
});

describe('input checks after stops and cautions', () => {
  const green = referenceLapMs(car);
  const ev = { id: 'e', type: 'SAFETY_CAR' as const, label: 'SC', startSec: L.lastLapEndSec, durationSec: 3 * (green / 1000 + 35) + 1, lapDeltaSec: 35, fuelReductionPct: 25, energyReductionPct: 20, pitOpen: true };
  test('normal lap after a pit stop is not questioned', () => {
    const live = recordPitStop(
      car,
      { inLap: L.lapsCompleted + 1, inLapMs: green + 62000, fuelAddedL: 40, changeTires: true, compound: car.live.compound, toDriverId: car.live.driverId, stationarySec: 40, totalLossSec: 62 },
      L.lastLapEndSec + (green + 62000) / 1000,
      DEFAULT_SETTINGS,
    );
    const c = { ...car, live };
    const w = validateRaceData(c, { lapsCompleted: live.lapsCompleted + 1, raceTimeSec: live.lastLapEndSec + green / 1000, lastLapMs: green, tireAge: 1 }, DEFAULT_SETTINGS);
    expect(w.map((x) => x.code)).toEqual([]);
  });
  test('laps under a safety car expect the caution pace and fuel', () => {
    const w = validateRaceData(car, { lapsCompleted: L.lapsCompleted + 1, raceTimeSec: L.lastLapEndSec + green / 1000 + 35, lastLapMs: green + 35000 }, DEFAULT_SETTINGS, [ev]);
    expect(w.map((x) => x.code)).toEqual([]);
  });
  test('green lap after safety-car laps is not questioned', () => {
    let c = car;
    let t = L.lastLapEndSec;
    for (let k = 1; k <= 3; k++) {
      t += green / 1000 + 35;
      c = { ...c, live: applyQuickUpdate(c, { lapsCompleted: L.lapsCompleted + k, raceTimeSec: t, lastLapMs: green + 35000 }, t, DEFAULT_SETTINGS, [ev]) };
    }
    const w = validateRaceData(c, { lapsCompleted: L.lapsCompleted + 4, raceTimeSec: t + green / 1000, lastLapMs: green }, DEFAULT_SETTINGS, [ev]);
    expect(w.map((x) => x.code)).toEqual([]);
  });
  test('first caution lap may still burn green-flag fuel', () => {
    const rate = measureFuelPerLap(car, DEFAULT_SETTINGS).value;
    const w = validateRaceData(car, { lapsCompleted: L.lapsCompleted + 1, raceTimeSec: L.lastLapEndSec + green / 1000, fuelL: L.fuelL - rate, lastLapMs: green }, DEFAULT_SETTINGS, [ev]);
    expect(w.map((x) => x.code)).toEqual([]);
    const typo = validateRaceData(car, { lapsCompleted: L.lapsCompleted + 1, fuelL: L.fuelL - rate * 2 }, DEFAULT_SETTINGS, [ev]);
    expect(typo.map((x) => x.code)).toContain('FUEL_RATE_CHANGE');
  });
  test('lap during which the caution ends is not questioned', () => {
    const mixed = green + 20000;
    const w = validateRaceData(car, { lapsCompleted: L.lapsCompleted + 1, raceTimeSec: L.lastLapEndSec + mixed / 1000, lastLapMs: mixed }, DEFAULT_SETTINGS, [{ ...ev, durationSec: 60 }]);
    expect(w.map((x) => x.code)).toEqual([]);
  });
  test('normal pace after a few confirmed slow laps is not questioned', () => {
    let c = car;
    let t = L.lastLapEndSec;
    for (let k = 1; k <= 3; k++) {
      t += green / 1000 + 30;
      c = { ...c, live: applyQuickUpdate(c, { lapsCompleted: L.lapsCompleted + k, raceTimeSec: t, lastLapMs: green + 30000 }, t, DEFAULT_SETTINGS) };
    }
    const w = validateRaceData(c, { lapsCompleted: L.lapsCompleted + 4, raceTimeSec: t + green / 1000, lastLapMs: green }, DEFAULT_SETTINGS);
    expect(w.map((x) => x.code)).toEqual([]);
  });
  test('a mistyped lap time is still flagged', () => {
    const w = validateRaceData(car, { lapsCompleted: L.lapsCompleted + 1, lastLapMs: green + 60000 }, DEFAULT_SETTINGS);
    expect(w.map((x) => x.code)).toContain('LAP_TIME_OUTLIER');
  });
});

describe('chequered flag', () => {
  test('timed race ends on the first lap completed after the clock', () => {
    const params = { ...race.params, lengthMode: 'time' as const, durationSec: L.lastLapEndSec + 30 };
    expect(checkFlag(params, L)).toBe(L);
    const live = applyQuickUpdate(car, { lapsCompleted: L.lapsCompleted + 1, raceTimeSec: L.lastLapEndSec + 96 }, L.lastLapEndSec + 96, DEFAULT_SETTINGS);
    const done = checkFlag(params, live);
    expect(done.phase).toBe('finished');
    expect(done.calls[done.calls.length - 1].text).toBe('CHEQUERED FLAG');
    // nothing left to drive in the projection
    const p = projectLive({ ...race, params, cars: [{ ...car, live: done }] }, { ...car, live: done }, DEFAULT_SETTINGS, done.lastLapEndSec);
    expect(p.sim.laps).toHaveLength(0);
    expect(p.currentLap).toBe(done.lapsCompleted);
    expect(p.fuelSavePct).toBe(0);
    expect(p.energySavePct).toBe(0);
    expect(p.fuelToFinishRaceL).toBe(0);
  });
  test('lap race ends on the last lap', () => {
    const params = { ...race.params, lengthMode: 'laps' as const, laps: L.lapsCompleted + 2 };
    const one = applyQuickUpdate(car, { lapsCompleted: L.lapsCompleted + 1 }, L.lastLapEndSec + 96, DEFAULT_SETTINGS);
    expect(checkFlag(params, one).phase).toBe('racing');
    const two = applyQuickUpdate({ ...car, live: one }, { lapsCompleted: L.lapsCompleted + 2 }, L.lastLapEndSec + 192, DEFAULT_SETTINGS);
    expect(checkFlag(params, two).phase).toBe('finished');
  });
});

describe('strategist overrides', () => {
  test('box-lap override moves the next stop and the rest of the plan follows', () => {
    const p0 = projectLive(race, car, DEFAULT_SETTINGS, L.lastLapEndSec);
    const target = Math.max(p0.currentLap, p0.window.target - 3);
    const c = { ...car, live: { ...L, pitLapOverrides: { ...L.pitLapOverrides, [L.stintIndex]: target } } };
    const p1 = projectLive({ ...race, cars: [c] }, c, DEFAULT_SETTINGS, L.lastLapEndSec);
    expect(p1.sim.stops[0].lap).toBe(target);
    expect(p1.window.target).toBe(target);
    // still covers the race
    expect(p1.finishSec).toBeGreaterThanOrEqual(race.params.durationSec);
  });
  test('an override past the fuel range is reported, not silently accepted', () => {
    const p0 = projectLive(race, car, DEFAULT_SETTINGS, L.lastLapEndSec);
    const c = { ...car, live: { ...L, pitLapOverrides: { ...L.pitLapOverrides, [L.stintIndex]: p0.currentLap + Math.ceil(p0.fuelRange.theoretical) + 3 } } };
    const p1 = projectLive({ ...race, cars: [c] }, c, DEFAULT_SETTINGS, L.lastLapEndSec);
    expect(p1.sim.issues.some((i) => i.code === 'FUEL_OUT' || i.code === 'STINT_BEYOND_SAFE')).toBe(true);
    const calls = generateRaceCalls({ ...race, cars: [c] }, c, p1, DEFAULT_SETTINGS);
    // box before the range ends; never ask for a saving the save mode cannot give
    expect(calls[0].text).toMatch(/^BOX/);
    expect(calls[0].boxLap!).toBeLessThanOrEqual(p0.currentLap + Math.ceil(p0.fuelRange.theoretical));
    expect(calls.some((x) => /SAVE/.test(x.text) && x.action?.type === 'mode')).toBe(false);
  });
});

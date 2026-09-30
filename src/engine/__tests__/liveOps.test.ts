import { describe, expect, test } from 'vitest';
import { createDemoRace } from '../../data/samples';
import { DEFAULT_SETTINGS } from '../factory';
import { applyQuickUpdate } from '../liveOps';

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

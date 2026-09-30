import { describe, expect, test } from 'vitest';
import { createDemoRace } from '../../data/samples';
import { generateRaceCalls } from '../calls';
import { DEFAULT_SETTINGS } from '../factory';
import { projectLive } from '../live';
import { calculateFuelRemainingLaps, calculatePitLoss } from '../model';
import { calculateStrategy } from '../simulate';
import { lapTrace, sliceTrace } from '../trace';
import { validateRaceData } from '../validate';
import { formatClock, formatLapMs, parseLapTime } from '../format';

describe('model', () => {
  test('fuel range distinguishes theoretical and safe laps', () => {
    const r = calculateFuelRemainingLaps(18.4, 2.82, 0.5);
    expect(r.theoretical).toBeCloseTo(6.52, 2);
    expect(r.safe).toBeCloseTo(6.02, 2);
    expect(r.safeWhole).toBe(6);
  });
  test('pit loss respects service concurrency', () => {
    const race = createDemoRace();
    const setup = { ...race.cars[0].setup, refuelRateLps: 2, tireChangeSec: 14, driverChangeSec: 20, pitLaneLossSec: 25 };
    const par = calculatePitLoss({ ...setup, concurrency: 'fuelDriverThenTires' }, { fuelAddedL: 60, changeTires: true, driverChange: true });
    expect(par.stationarySec).toBeCloseTo(44);
    expect(par.totalSec).toBeCloseTo(69);
    const seq = calculatePitLoss({ ...setup, concurrency: 'sequential' }, { fuelAddedL: 60, changeTires: true, driverChange: true });
    expect(seq.stationarySec).toBeCloseTo(64);
  });
});

describe('format', () => {
  test('lap times and clocks', () => {
    expect(formatLapMs(95212)).toBe('1:35.212');
    expect(parseLapTime('1:35.212')).toBe(95212);
    expect(formatClock(13288)).toBe('3:41:28');
  });
});

describe('strategy & live', () => {
  const race = createDemoRace();
  const car = race.cars[0];
  test('pre-race plan covers the race with 8 stops and no critical issues', () => {
    const res = calculateStrategy(race.params, car.setup, car.plan, car.drivers);
    expect(res.stops).toHaveLength(8);
    expect(res.finishSec).toBeGreaterThanOrEqual(race.params.durationSec);
    expect(res.issues.filter((i) => i.severity === 'critical')).toHaveLength(0);
  });
  test('live projection starts from the current lap and yields a call', () => {
    const p = projectLive(race, car, DEFAULT_SETTINGS, race.clock.anchorRaceSec);
    expect(p.currentLap).toBe(car.live.lapsCompleted + 1);
    expect(p.window.target).toBeGreaterThanOrEqual(p.currentLap);
    const calls = generateRaceCalls(race, car, p, DEFAULT_SETTINGS);
    expect(calls.length).toBeGreaterThan(0);
  });
  test('validation flags suspicious manual input', () => {
    const w = validateRaceData(car, { lapsCompleted: car.live.lapsCompleted - 2, fuelL: car.live.fuelL + 30, tireAge: 0 }, DEFAULT_SETTINGS);
    const codes = w.map((x) => x.code);
    expect(codes).toContain('LAP_DECREASED');
    expect(codes).toContain('FUEL_INCREASED');
    expect(codes).toContain('TIRE_AGE_DECREASED');
  });
});

describe('lap trace', () => {
  const race = createDemoRace();
  const car = race.cars[0];
  const trace = lapTrace(car, race.events);
  test('pairs every recorded lap with a plan assumption', () => {
    expect(trace).toHaveLength(car.live.laps.length);
    for (const t of trace) {
      expect(t.assumedLapMs).toBeGreaterThan(0);
      expect(t.assumedFuelL).toBeGreaterThan(0);
    }
  });
  test('pit and scenario laps are not green', () => {
    const pit = trace.find((t) => t.pitIn);
    expect(pit?.green).toBe(false);
  });
  test('slices by stint and window', () => {
    expect(sliceTrace(trace, 'last30', car.live.stintIndex).length).toBe(Math.min(30, trace.length));
    expect(sliceTrace(trace, 'stint', car.live.stintIndex).every((t) => t.stint === car.live.stintIndex)).toBe(true);
  });
});

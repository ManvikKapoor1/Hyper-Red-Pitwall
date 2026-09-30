/**
 * Virtual pitwall: drive complete races through the live inputs exactly like
 * a strategist would (quick update every lap, record each pit stop). When the
 * car behaves exactly as the plan assumed, every live projection must agree
 * with the pre-race plan: same laps, same stop laps, same finish.
 */
import { describe, expect, test } from 'vitest';
import { generateRaceCalls } from '../calls';
import { DEFAULT_SETTINGS } from '../factory';
import { projectLive } from '../live';
import { applyQuickUpdate, prepareGrid, recordPitStop, startRaceLive } from '../liveOps';
import { calculateStrategy, type StrategyResult } from '../simulate';
import type { CarEntry, Race } from '../types';
import { checkResult, randomCase, type Case } from './helpers';

const settings = DEFAULT_SETTINGS;

function raceFor(c: Case, truth: StrategyResult): { race: Race; car: CarEntry } {
  const car: CarEntry = { id: 'car', number: '1', teamName: 'T', setup: c.setup, drivers: c.drivers, plan: c.plan, planDirty: false, versions: [], live: undefined as unknown as CarEntry['live'] };
  const race: Race = {
    id: 'r',
    params: c.race,
    status: 'LIVE',
    isDemo: false,
    sample: false,
    cars: [car],
    activeCarId: 'car',
    events: c.opts.events ?? [],
    plannedEvents: [],
    clock: { running: false, anchorRaceSec: 0, anchorEpochMs: 0, speed: 1 },
    createdAt: '',
    updatedAt: '',
  };
  car.live = startRaceLive(prepareGrid(race, car, settings));
  void truth;
  return { race, car };
}

interface RunReport {
  problems: string[];
  steps: number;
}

/** Plays the truth laps into the live state, checking the projection after every input. */
function playRace(c: Case, exact: boolean): RunReport {
  const truth = calculateStrategy(c.race, c.setup, c.plan, c.drivers, c.opts);
  const problems: string[] = [];
  const { race, car } = raceFor(c, truth);
  let steps = 0;
  const stopAt = new Map(truth.stops.map((s) => [s.lap, s]));
  for (const lap of truth.laps) {
    const stop = stopAt.get(lap.lap);
    if (stop) {
      car.live = recordPitStop(
        car,
        {
          inLap: lap.lap,
          inLapMs: lap.lapMs,
          fuelAddedL: stop.fuelAddedL,
          energyAfterPct: c.setup.energyEnabled ? Math.max(0, lap.energyAfterPct) + stop.energyAddedPct : undefined,
          changeTires: stop.changeTires,
          compound: stop.compound,
          toDriverId: stop.toDriverId,
          stationarySec: stop.stationarySec,
          totalLossSec: stop.totalLossSec,
          stationaryTimed: true,
          totalTimed: true,
          underEvent: stop.underEvent,
        },
        lap.endSec,
        settings,
      );
      // the pitwall confirms the fuel it sees after the stop
      car.live = applyQuickUpdate(car, { fuelL: Math.max(0, lap.fuelAfterL) + stop.fuelAddedL }, lap.endSec, settings, race.events);
    } else {
      car.live = applyQuickUpdate(
        car,
        {
          lapsCompleted: lap.lap,
          raceTimeSec: lap.endSec,
          fuelL: lap.fuelAfterL,
          energyPct: c.setup.energyEnabled ? lap.energyAfterPct : undefined,
          tireAge: lap.tireAge,
          lastLapMs: lap.lapMs,
        },
        lap.endSec,
        settings,
        race.events,
      );
    }
    steps++;
    const done = c.race.lengthMode === 'laps' ? lap.lap >= c.race.laps : lap.endSec >= c.race.durationSec;
    if (done) break;
    const p = projectLive(race, car, settings, car.live.lastLapEndSec);
    const where = `lap ${lap.lap}`;
    // the projection is a valid simulation from the live state
    const bad = checkResult(c, p.sim);
    if (bad.length) problems.push(`${where}: ${bad.slice(0, 3).join(' | ')}`);
    if (p.sim.startLap !== car.live.lapsCompleted + 1) problems.push(`${where}: projection starts on ${p.sim.startLap}`);
    // exact inputs → the projection reproduces the plan
    if (exact) {
      if (p.totalLaps !== truth.totalLaps) problems.push(`${where}: projected ${p.totalLaps} laps vs plan ${truth.totalLaps}`);
      if (Math.abs(p.finishSec - truth.finishSec) > 0.001) problems.push(`${where}: finish ${p.finishSec.toFixed(2)} vs plan ${truth.finishSec.toFixed(2)}`);
      const futurePlanned = truth.stops.filter((s) => s.lap > lap.lap).map((s) => s.lap);
      const futureLive = p.sim.stops.map((s) => s.lap);
      if (futurePlanned.join() !== futureLive.join()) problems.push(`${where}: stops ${futureLive.join(',')} vs plan ${futurePlanned.join(',')}`);
      // the displayed rate is what the car burns now (current driver & mode)
      const nextLap = truth.laps.find((l) => l.lap === lap.lap + 1);
      if (nextLap && !nextLap.event && p.fuelRate.measured && Math.abs(p.fuelRate.value - nextLap.fuelUsedL) > 1e-6)
        problems.push(`${where}: fuel rate ${p.fuelRate.value.toFixed(4)} vs next lap ${nextLap.fuelUsedL.toFixed(4)}`);
    }
    // call texts are readable
    for (const call of generateRaceCalls(race, car, p, settings)) {
      const txt = `${call.text} ${call.reasons.join(' ')} ${call.alternative ?? ''}`;
      if (/NaN|undefined|Infinity|null/.test(txt)) problems.push(`${where}: call "${txt}"`);
    }
    if (problems.length > 6) break;
  }
  // live record matches what happened
  const L = car.live;
  L.laps.forEach((l, i) => {
    if (l.lap !== i + 1) problems.push(`live lap numbering ${l.lap} at ${i}`);
  });
  if (L.stops.length !== truth.stops.filter((s) => s.lap <= L.lapsCompleted).length) problems.push(`live stops ${L.stops.length}`);
  return { problems, steps };
}

describe('virtual pitwall', () => {
  test('exact inputs: live projections reproduce the plan all race long', () => {
    const out: string[] = [];
    let raced = 0;
    for (let seed = 1; seed <= 260 && raced < 60; seed++) {
      const c = randomCase(seed);
      const pre = calculateStrategy(c.race, c.setup, c.plan, c.drivers, c.opts);
      if (!pre.feasible || pre.totalLaps > 260 || (c.opts.events ?? []).length) continue;
      raced++;
      const r = playRace(c, true);
      if (r.problems.length) out.push(`seed ${seed}: ${r.problems.slice(0, 3).join(' || ')}`);
    }
    expect(raced).toBeGreaterThan(20);
    expect(out.slice(0, 10)).toEqual([]);
  });
  test('races with scenarios: projections stay valid and calls readable', () => {
    const out: string[] = [];
    let raced = 0;
    for (let seed = 1; seed <= 400 && raced < 40; seed++) {
      const c = randomCase(seed);
      if (!(c.opts.events ?? []).length) continue;
      const pre = calculateStrategy(c.race, c.setup, c.plan, c.drivers, c.opts);
      if (pre.totalLaps > 260) continue;
      raced++;
      const r = playRace(c, false);
      if (r.problems.length) out.push(`seed ${seed}: ${r.problems.slice(0, 3).join(' || ')}`);
    }
    expect(raced).toBeGreaterThan(10);
    expect(out.slice(0, 10)).toEqual([]);
  });
});

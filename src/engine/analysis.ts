/**
 * Post-race analysis — planned (first saved version) vs actual (live record).
 */
import { calculateStrategy, type StrategyResult } from './simulate';
import type { CarEntry, ID, Race } from './types';

export interface ActualStint {
  index: number;
  driverId: ID;
  startLap: number;
  endLap: number;
  laps: number;
  startSec: number;
  endSec: number;
  fuelUsedL: number;
  fuelPerLapL: number;
  energyUsedPct: number;
  avgLapMs: number;
  bestLapMs: number;
  compound: string;
  tireAgeEnd: number;
}

export interface StintComparison {
  index: number;
  planned?: StrategyResult['stints'][number];
  actual?: ActualStint;
  pitLapDelta: number | null;
}

export interface PostRaceSummary {
  durationSec: number;
  lapsCompleted: number;
  stops: number;
  totalPitSec: number;
  totalStationarySec: number;
  fuelUsedL: number;
  avgFuelPerLapL: number;
  energyUsedPct: number;
  tireSets: number;
  driverStints: Record<ID, { stints: number; laps: number; timeSec: number; bestLapMs: number; avgLapMs: number }>;
  strategyChanges: number;
  calls: number;
  majorDecisions: { lap: number; raceTimeSec: number; text: string; source: string }[];
  stints: ActualStint[];
  comparison: StintComparison[];
  planned: StrategyResult;
  plannedVersion: string;
  deviations: string[];
  projectedLaps: number;
  projectedFinishSec: number;
  finished: boolean;
}

export function actualStints(car: CarEntry): ActualStint[] {
  const out: ActualStint[] = [];
  const by = new Map<number, typeof car.live.laps>();
  for (const l of car.live.laps) {
    const arr = by.get(l.stint) ?? [];
    arr.push(l);
    by.set(l.stint, arr);
  }
  let prevEnd = 0;
  for (const [idx, laps] of [...by.entries()].sort((a, b) => a[0] - b[0])) {
    const green = laps.filter((l) => !l.pitIn && !l.event);
    const fuel = laps.reduce((a, l) => a + (l.fuelUsedL ?? 0), 0);
    const fuelN = laps.filter((l) => l.fuelUsedL != null).length;
    out.push({
      index: idx,
      driverId: laps[0].driverId,
      startLap: laps[0].lap,
      endLap: laps[laps.length - 1].lap,
      laps: laps.length,
      startSec: prevEnd,
      endSec: laps[laps.length - 1].endSec,
      fuelUsedL: fuel,
      fuelPerLapL: fuelN ? fuel / fuelN : 0,
      energyUsedPct: laps.reduce((a, l) => a + (l.energyUsedPct ?? 0), 0),
      avgLapMs: green.length ? green.reduce((a, l) => a + l.lapMs, 0) / green.length : 0,
      bestLapMs: green.length ? Math.min(...green.map((l) => l.lapMs)) : 0,
      compound: laps[laps.length - 1].compound,
      tireAgeEnd: laps[laps.length - 1].tireAge,
    });
    prevEnd = laps[laps.length - 1].endSec;
  }
  return out;
}

export function postRaceSummary(race: Race, car: CarEntry): PostRaceSummary {
  const base = car.versions[0];
  const planned = calculateStrategy(race.params, base?.setup ?? car.setup, base?.plan ?? car.plan, car.drivers);
  const stints = actualStints(car);
  const live = car.live;
  const laps = live.laps;
  const fuelLaps = laps.filter((l) => l.fuelUsedL != null);
  const fuelUsedL = fuelLaps.reduce((a, l) => a + (l.fuelUsedL ?? 0), 0);
  const drivers: PostRaceSummary['driverStints'] = {};
  for (const s of stints) {
    const d = (drivers[s.driverId] ??= { stints: 0, laps: 0, timeSec: 0, bestLapMs: 0, avgLapMs: 0 });
    d.stints++;
    d.laps += s.laps;
    d.timeSec += s.endSec - s.startSec;
    if (s.bestLapMs && (!d.bestLapMs || s.bestLapMs < d.bestLapMs)) d.bestLapMs = s.bestLapMs;
  }
  for (const id of Object.keys(drivers)) {
    const g = laps.filter((l) => l.driverId === id && !l.pitIn && !l.event);
    drivers[id].avgLapMs = g.length ? g.reduce((a, l) => a + l.lapMs, 0) / g.length : 0;
  }
  const n = Math.max(planned.stints.length, stints.length);
  const comparison: StintComparison[] = Array.from({ length: n }, (_, i) => {
    const p = planned.stints[i];
    const a = stints.find((s) => s.index === i);
    return { index: i, planned: p, actual: a, pitLapDelta: p && a && !p.final ? a.endLap - p.endLap : null };
  });
  const deviations: string[] = [];
  comparison.forEach((c) => {
    if (c.pitLapDelta != null && c.pitLapDelta !== 0 && c.actual && live.stops.some((s) => s.lap === c.actual!.endLap))
      deviations.push(`Stop ${c.index + 1}: lap ${c.actual.endLap} vs planned ${c.planned!.endLap} (${c.pitLapDelta > 0 ? '+' : ''}${c.pitLapDelta})`);
  });
  if (live.stops.length !== planned.stops.length && live.phase === 'finished')
    deviations.push(`Stops: ${live.stops.length} actual vs ${planned.stops.length} planned`);
  live.stops.forEach((s) => {
    if (s.underEvent) deviations.push(`Stop ${s.index + 1} taken under ${s.underEvent.replace('_', ' ')}`);
  });
  const majorDecisions = live.calls
    .filter((c) => c.source === 'override' || c.priority === 'CRITICAL' || c.status === 'CHANGED')
    .map((c) => ({ lap: c.lap, raceTimeSec: c.raceTimeSec, text: c.text, source: c.source }));
  const last = laps[laps.length - 1];
  return {
    durationSec: last?.endSec ?? 0,
    lapsCompleted: live.lapsCompleted,
    stops: live.stops.length,
    totalPitSec: live.stops.reduce((a, s) => a + s.totalLossSec, 0),
    totalStationarySec: live.stops.reduce((a, s) => a + s.stationarySec, 0),
    fuelUsedL,
    avgFuelPerLapL: fuelLaps.length ? fuelUsedL / fuelLaps.length : 0,
    energyUsedPct: laps.reduce((a, l) => a + (l.energyUsedPct ?? 0), 0),
    tireSets: 1 + live.stops.filter((s) => s.changeTires).length,
    driverStints: drivers,
    strategyChanges: Math.max(0, car.versions.length - 1),
    calls: live.calls.length,
    majorDecisions,
    stints,
    comparison,
    planned,
    plannedVersion: base?.version ?? 'current',
    deviations,
    projectedLaps: planned.totalLaps,
    projectedFinishSec: planned.finishSec,
    finished: live.phase === 'finished',
  };
}

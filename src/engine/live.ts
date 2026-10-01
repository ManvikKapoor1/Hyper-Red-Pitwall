/**
 * Live projection — combines the human-entered race state with the plan and
 * re-runs the strategy from the current lap.
 */
import {
  activeEventAt,
  calculateFuelRemainingLaps,
  driverFuelFactor,
  getCompound,
  netEnergyPerLap,
  predictLapMs,
  requiredFuelPerLap,
} from './model';
import { calculateStrategy, type SimOptions, type SimStint, type SimStop, type StrategyResult } from './simulate';
import type { CarEntry, CarSetup, Confidence, DriveMode, FuelMethod, LapRecord, Race, RaceClock, ScenarioEvent, Settings } from './types';

export interface MeasuredRate {
  /** Rate for the current driver in the current drive mode (what the car uses now). */
  value: number;
  /** Car-level rate: normal mode, reference driver — the simulation's base input. */
  base: number;
  source: string;
  samples: number;
  confidence: Confidence;
  measured: boolean;
  spread: number; // coefficient of variation (0–1)
}

export type RaceStateName =
  | 'PRE-RACE'
  | 'GRID'
  | 'START'
  | 'STINT'
  | 'PIT WINDOW'
  | 'PIT ENTRY'
  | 'PIT STOP'
  | 'PIT EXIT'
  | 'NEW STINT'
  | 'WEATHER'
  | 'INCIDENT'
  | 'STRATEGY CHANGE'
  | 'FINISH';

export const RACE_STATES: RaceStateName[] = [
  'PRE-RACE',
  'GRID',
  'START',
  'STINT',
  'PIT WINDOW',
  'PIT ENTRY',
  'PIT STOP',
  'PIT EXIT',
  'NEW STINT',
  'WEATHER',
  'INCIDENT',
  'STRATEGY CHANGE',
  'FINISH',
];

export type WindowState = 'CLOSED' | 'OPEN' | 'CLOSING' | 'MISSED' | 'FINAL';

export interface LiveProjection {
  raceTimeSec: number;
  remainingSec: number;
  currentLap: number;
  lapsCompleted: number;
  stintIndex: number;
  stintLap: number; // laps completed in this stint
  totalStints: number;
  fuelRate: MeasuredRate;
  energyRate: MeasuredRate;
  pace: { avgMs: number; lastMs: number | null; bestMs: number | null; biasMs: number; samples: number; modelMs: number; predictedMs: number };
  sim: StrategyResult;
  current?: SimStint;
  nextStint?: SimStint;
  nextStop?: SimStop;
  totalLaps: number;
  finishSec: number;
  fuelRange: ReturnType<typeof calculateFuelRemainingLaps>;
  energyRange: { theoretical: number; safe: number; safeWhole: number };
  window: { earliest: number; latest: number; target: number; state: WindowState; etaSec: number; lapsTo: number };
  fuelAtPitL: number;
  fuelAtPitLaps: number;
  energyAtPitPct: number;
  tireAgeAtPit: number;
  fuelToFinishStintL: number;
  fuelToFinishRaceL: number;
  fuelRequiredPerLap: number; // to reach target with reserve
  fuelSavePct: number; // % reduction needed (0 when none)
  energyRequiredPerLap: number;
  energySavePct: number;
  energyTargetPct: number | null; // energy that should remain now per the stint budget
  isFinalStint: boolean;
  activeEvent?: ScenarioEvent;
  state: RaceStateName;
  dataAgeLaps: number;
  extendLaps: number;
}

export function raceNowSec(clock: RaceClock, nowMs = Date.now()): number {
  if (!clock.running) return clock.anchorRaceSec;
  return clock.anchorRaceSec + ((nowMs - clock.anchorEpochMs) / 1000) * clock.speed;
}

function confidenceFrom(samples: number, spread: number, stale: boolean): Confidence {
  let c: Confidence = samples >= 5 ? 'HIGH' : samples >= 2 ? 'MEDIUM' : 'LOW';
  if (spread > 0.08 && c === 'HIGH') c = 'MEDIUM';
  if (stale) c = c === 'HIGH' ? 'MEDIUM' : 'LOW';
  return c;
}

function stats(values: number[]) {
  if (!values.length) return { mean: 0, cv: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
  return { mean, cv: mean > 0 ? sd / mean : 0 };
}

function greenLaps(laps: LapRecord[]): LapRecord[] {
  return laps.filter((l) => !l.pitIn && !l.event);
}

function selectLaps(car: CarEntry, method: FuelMethod, lastN: number): { laps: LapRecord[]; label: string } {
  const g = greenLaps(car.live.laps);
  switch (method) {
    case 'stint':
      return { laps: g.filter((l) => l.stint === car.live.stintIndex), label: 'Current stint average' };
    case 'race':
      return { laps: g, label: 'Race average' };
    case 'lastN':
    default:
      return { laps: g.slice(-lastN), label: `Last ${lastN} laps` };
  }
}

const modeFuelFactor = (setup: CarSetup, mode: DriveMode) => 1 + (setup.modes[mode]?.fuelPct ?? 0) / 100;
const modeEnergyFactor = (setup: CarSetup, mode: DriveMode) => 1 + (setup.modes[mode]?.energyPct ?? 0) / 100;

/**
 * calculateFuelPerLap (measured) — chooses the strategist's calculation method.
 * Every lap is normalised by the driver and drive mode it was driven with, so a
 * window that spans a driver change or a fuel-save phase still measures the car.
 */
export function measureFuelPerLap(car: CarEntry, settings: Settings): MeasuredRate {
  const { live, setup, drivers } = car;
  const dmap = new Map(drivers.map((d) => [d.id, d]));
  const nowFactor = driverFuelFactor(setup, dmap.get(live.driverId)) * modeFuelFactor(setup, live.driveMode);
  const stale = live.lapsCompleted - live.lastUpdateLap >= settings.alerts.staleDataLaps;
  if (live.fuelMethod === 'user' && live.userFuelPerLapL) {
    return { value: live.userFuelPerLapL, base: live.userFuelPerLapL / nowFactor, source: 'User-defined value', samples: 0, confidence: 'MEDIUM', measured: false, spread: 0 };
  }
  const { laps, label } = selectLaps(car, live.fuelMethod, live.lastN);
  const vals = laps
    .filter((l) => l.fuelUsedL != null && l.fuelUsedL > 0)
    .map((l) => l.fuelUsedL! / (driverFuelFactor(setup, dmap.get(l.driverId)) * modeFuelFactor(setup, l.mode ?? live.driveMode)));
  if (!vals.length) {
    return { value: setup.fuelPerLapL * nowFactor, base: setup.fuelPerLapL, source: 'Initial estimate (assumption)', samples: 0, confidence: 'LOW', measured: false, spread: 0 };
  }
  const { mean, cv } = stats(vals);
  return { value: mean * nowFactor, base: mean, source: `${label} · ${vals.length} lap${vals.length > 1 ? 's' : ''}`, samples: vals.length, confidence: confidenceFrom(vals.length, cv, stale), measured: true, spread: cv };
}

export function measureEnergyPerLap(car: CarEntry, settings: Settings): MeasuredRate {
  const { live, setup } = car;
  const nowFactor = modeEnergyFactor(setup, live.driveMode);
  const stale = live.lapsCompleted - live.lastUpdateLap >= settings.alerts.staleDataLaps;
  if (!setup.energyEnabled) return { value: 0, base: 0, source: 'Energy disabled', samples: 0, confidence: 'LOW', measured: false, spread: 0 };
  const method = live.fuelMethod === 'user' ? 'lastN' : live.fuelMethod;
  const { laps, label } = selectLaps(car, method, live.lastN);
  const vals = laps.filter((l) => l.energyUsedPct != null && l.energyUsedPct > 0).map((l) => l.energyUsedPct! / modeEnergyFactor(setup, l.mode ?? live.driveMode));
  if (!vals.length) {
    const net = netEnergyPerLap(setup);
    return { value: net * nowFactor, base: net, source: 'Initial estimate (assumption)', samples: 0, confidence: 'LOW', measured: false, spread: 0 };
  }
  const { mean, cv } = stats(vals);
  return { value: mean * nowFactor, base: mean, source: `${label} · ${vals.length} lap${vals.length > 1 ? 's' : ''}`, samples: vals.length, confidence: confidenceFrom(vals.length, cv, stale), measured: true, spread: cv };
}

/**
 * Expected green-flag time of the lap now being driven: the lap model for the
 * current driver, mode, tire age and fuel load, corrected by how the timed
 * green laps so far compared with the model. Falls back to the setup pace.
 */
export function referenceLapMs(car: CarEntry): number {
  const ms = measurePace(car, 5).predictedMs;
  return Number.isFinite(ms) && ms > 0 ? ms : car.setup.racePaceMs;
}

export function measurePace(car: CarEntry, lastN: number) {
  const { live, setup, drivers } = car;
  const g = greenLaps(live.laps).filter((l) => !l.estimated || live.laps.length < 3);
  const recent = g.slice(-lastN);
  const dmap = new Map(drivers.map((d) => [d.id, d]));
  let bias = 0;
  if (recent.length) {
    const diffs = recent.map((l) => {
      const pred = predictLapMs({
        setup,
        driver: dmap.get(l.driverId),
        compound: getCompound(setup, l.compound),
        tireAge: Math.max(0, l.tireAge - 1),
        mode: l.mode ?? live.driveMode,
        fuelL: l.fuelAfterL + (l.fuelUsedL ?? 0),
      });
      return l.lapMs - pred;
    });
    // median: one lap in traffic or an untagged slow lap does not move the pace
    const d = diffs.sort((a, b) => a - b);
    const m = d.length >> 1;
    bias = d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2;
  }
  const avg = recent.length ? recent.reduce((a, l) => a + l.lapMs, 0) / recent.length : 0;
  const predictedMs = predictLapMs({
    setup,
    driver: dmap.get(live.driverId),
    compound: getCompound(setup, live.compound),
    tireAge: live.tireAge,
    mode: live.driveMode,
    fuelL: live.fuelL,
  });
  return { avgMs: avg, lastMs: live.lastLapMs, bestMs: live.bestLapMs, biasMs: bias, samples: recent.length, modelMs: predictedMs, predictedMs: predictedMs + bias };
}

export function deriveRaceState(race: Race, car: CarEntry, windowState: WindowState, nowSec: number): RaceStateName {
  const { live } = car;
  if (live.phase === 'pre') return 'PRE-RACE';
  if (live.phase === 'grid') return 'GRID';
  if (live.phase === 'finished') return 'FINISH';
  if (live.pitPhase === 'entry') return 'PIT ENTRY';
  if (live.pitPhase === 'stationary') return 'PIT STOP';
  if (live.pitPhase === 'exit') return 'PIT EXIT';
  const ev = activeEventAt(race.events, nowSec);
  if (ev) return ev.type === 'CUSTOM' ? 'INCIDENT' : 'WEATHER';
  if (live.lapsCompleted < 1 && live.stintIndex === 0) return 'START';
  if (live.strategyChangedLap != null && live.lapsCompleted + 1 - live.strategyChangedLap <= 1) return 'STRATEGY CHANGE';
  if (live.stintIndex > 0 && live.lapsCompleted + 1 - live.stintStartLap < 2) return 'NEW STINT';
  if (windowState === 'OPEN' || windowState === 'CLOSING' || windowState === 'MISSED') return 'PIT WINDOW';
  return 'STINT';
}

/** Simulation options that project the plan from the live state with measured rates. */
export function liveSimOptions(
  race: Race,
  car: CarEntry,
  settings: Settings,
  m?: { fuelRate: MeasuredRate; energyRate: MeasuredRate; pace: ReturnType<typeof measurePace> },
): SimOptions {
  const { live, setup, plan } = car;
  const fuelRate = m?.fuelRate ?? measureFuelPerLap(car, settings);
  const energyRate = m?.energyRate ?? measureEnergyPerLap(car, settings);
  const pace = m?.pace ?? measurePace(car, live.lastN);
  const racing = live.phase === 'racing' || live.phase === 'finished';
  return {
    initial: racing
      ? {
          lap: live.lapsCompleted + 1,
          timeSec: live.lastLapEndSec,
          stintIndex: Math.min(live.stintIndex, plan.stints.length - 1),
          stintStartLap: live.stintStartLap,
          fuelL: live.fuelL,
          energyPct: live.energyPct,
          compound: live.compound,
          tireAge: live.tireAge,
          driverId: live.driverId,
          mode: live.driveMode,
        }
      : undefined,
    fuelPerLapL: fuelRate.base,
    energyPerLapPct: setup.energyEnabled ? energyRate.base : undefined,
    paceBiasMs: pace.samples >= 2 ? pace.biasMs : undefined,
    events: race.events,
    pitLapOverrides: live.pitLapOverrides,
    earlyThresholdLaps: settings.defaults.earlyPitThresholdLaps,
  };
}

export function projectLive(race: Race, car: CarEntry, settings: Settings, nowSec: number): LiveProjection {
  const { live, setup, plan, drivers } = car;
  const fuelRate = measureFuelPerLap(car, settings);
  const energyRate = measureEnergyPerLap(car, settings);
  const pace = measurePace(car, live.lastN);
  const racing = live.phase === 'racing' || live.phase === 'finished';
  const simOpts = liveSimOptions(race, car, settings, { fuelRate, energyRate, pace });
  const sim = calculateStrategy(race.params, setup, plan, drivers, simOpts);

  const current = sim.stints[0];
  const nextStint = sim.stints[1];
  const nextStop = sim.stops[0];
  // after the flag the last lap driven is the current one and nothing is left to plan
  const finished = live.phase === 'finished';
  const currentLap = finished ? live.lapsCompleted : racing ? live.lapsCompleted + 1 : 0;
  const isFinalStint = !nextStop;

  const liveFpl = fuelRate.value;
  const liveEpl = energyRate.value;
  // safe ranges allow for the lap-to-lap scatter of the measurement (one standard deviation)
  const fuelTheo = calculateFuelRemainingLaps(live.fuelL, liveFpl, setup.fuelSafetyMarginLaps);
  const fuelSafe = calculateFuelRemainingLaps(live.fuelL, liveFpl * (1 + fuelRate.spread), setup.fuelSafetyMarginLaps);
  const fuelRange = { theoretical: fuelTheo.theoretical, safe: fuelSafe.safe, safeWhole: fuelSafe.safeWhole };
  const eTheo = setup.energyEnabled && liveEpl > 0 ? live.energyPct / liveEpl : Infinity;
  const eSafe = setup.energyEnabled && liveEpl > 0 ? (live.energyPct - setup.energyReservePct) / (liveEpl * (1 + energyRate.spread)) : Infinity;
  const energyRange = { theoretical: eTheo, safe: eSafe, safeWhole: Math.max(0, Math.floor(eSafe + 1e-9)) };

  const target = current ? current.endLap : currentLap;
  const lapsTo = target - Math.max(currentLap, 1);
  const lapsInclCurrent = Math.max(1, lapsTo + 1);
  const earliest = current?.window.earliest ?? currentLap;
  const latestByCurrent = currentLap + Math.min(fuelRange.safeWhole, setup.energyEnabled ? energyRange.safeWhole : Infinity, current ? current.maxLaps.tire : Infinity, current ? current.maxLaps.driver : Infinity) - 1;
  const latest = Math.max(currentLap - 1, latestByCurrent);

  let wstate: WindowState = 'CLOSED';
  if (isFinalStint) wstate = 'FINAL';
  else if (currentLap > latest) wstate = 'MISSED';
  else if (currentLap >= earliest && latest - currentLap <= settings.alerts.pitWindowWarnLaps) wstate = 'CLOSING';
  else if (currentLap >= earliest) wstate = 'OPEN';

  // ETA to the in-lap completing (race clock)
  const inLap = sim.laps.find((l) => l.lap === target);
  const etaSec = inLap ? Math.max(0, (nextStop ? nextStop.entrySec : inLap.endSec) - nowSec) : 0;

  const fuelAtPitL = current ? current.fuelEndL : live.fuelL;
  const fuelAtPitLaps = liveFpl > 0 ? fuelAtPitL / liveFpl : Infinity;
  const energyAtPitPct = current ? current.energyEndPct : live.energyPct;
  const tireAgeAtPit = current ? current.tireAgeEnd : live.tireAge;
  const fuelToFinishStintL = finished ? 0 : liveFpl * lapsInclCurrent;
  const lapsToFinish = finished ? 0 : Math.max(0, sim.totalLaps - currentLap + 1);
  const fuelToFinishRaceL = liveFpl * lapsToFinish;

  const reqFpl = requiredFuelPerLap(live.fuelL, lapsInclCurrent, setup.fuelSafetyMarginLaps, liveFpl);
  const fuelSavePct = !finished && liveFpl > 0 && reqFpl < liveFpl ? (1 - reqFpl / liveFpl) * 100 : 0;
  const reqEpl = setup.energyEnabled ? Math.max(0, live.energyPct - setup.energyReservePct) / lapsInclCurrent : Infinity;
  const energySavePct = !finished && setup.energyEnabled && liveEpl > 0 && reqEpl < liveEpl ? (1 - reqEpl / liveEpl) * 100 : 0;
  const planStint = plan.stints[live.stintIndex];
  let energyTargetPct: number | null = null;
  if (setup.energyEnabled && racing && !finished) {
    const stintLaps = Math.max(1, (current ? current.endLap : target) - live.stintStartLap + 1);
    const budget = planStint?.energyTargetPct ?? Math.max(0, live.stintStartEnergyPct - setup.energyReservePct);
    const doneLaps = Math.max(0, currentLap - live.stintStartLap);
    energyTargetPct = live.stintStartEnergyPct - (budget / stintLaps) * doneLaps;
  }

  const activeEvent = activeEventAt(race.events, nowSec);
  const remainingSec =
    race.params.lengthMode === 'time' ? Math.max(0, race.params.durationSec - nowSec) : Math.max(0, sim.finishSec - nowSec);
  const state = deriveRaceState(race, car, wstate, nowSec);
  const extendLaps = isFinalStint ? 0 : Math.max(0, latest - target);

  return {
    raceTimeSec: nowSec,
    remainingSec,
    currentLap,
    lapsCompleted: live.lapsCompleted,
    stintIndex: live.stintIndex,
    stintLap: racing ? live.lapsCompleted + 1 - live.stintStartLap : 0,
    totalStints: plan.stints.length,
    fuelRate,
    energyRate,
    pace,
    sim,
    current,
    nextStint,
    nextStop,
    totalLaps: sim.totalLaps,
    finishSec: sim.finishSec,
    fuelRange,
    energyRange,
    window: { earliest, latest, target, state: wstate, etaSec, lapsTo },
    fuelAtPitL,
    fuelAtPitLaps,
    energyAtPitPct,
    tireAgeAtPit,
    fuelToFinishStintL,
    fuelToFinishRaceL,
    fuelRequiredPerLap: reqFpl,
    fuelSavePct,
    energyRequiredPerLap: reqEpl,
    energySavePct,
    energyTargetPct,
    isFinalStint,
    activeEvent,
    state,
    dataAgeLaps: live.lapsCompleted - live.lastUpdateLap,
    extendLaps,
  };
}

/** Energy remaining (%) after n laps at a rate. */
export function calculateEnergyRemaining(energyPct: number, perLapPct: number, laps: number): number {
  return energyPct - perLapPct * laps;
}

/** Stint energy budget: allocation, per-lap allowance and projected end. */
export function calculateEnergyBudget(startPct: number, reservePct: number, laps: number, perLapPct: number) {
  const usable = Math.max(0, startPct - reservePct);
  const allowancePerLap = laps > 0 ? usable / laps : 0;
  const projectedEnd = startPct - perLapPct * laps;
  return { usable, allowancePerLap, projectedEnd, delta: allowancePerLap - perLapPct };
}

/** Pit window for a stint (in-lap numbers). */
export function calculatePitWindow(p: LiveProjection) {
  return p.window;
}

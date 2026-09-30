/**
 * Pure reducers for the live race state. The store calls these; they never
 * touch the UI and are easy to unit-test.
 */
import { measureEnergyPerLap, measureFuelPerLap } from './live';
import { uid } from './planner';
import { calculateStrategy } from './simulate';
import type { QuickUpdateInput } from './validate';
import type { ActualStop, CallLogEntry, CallPriority, CallStatus, CarEntry, CarLive, LapRecord, Race, Settings } from './types';

export function cloneLive(live: CarLive): CarLive {
  return {
    ...live,
    laps: [...live.laps],
    stops: [...live.stops],
    calls: [...live.calls],
    inputs: [...live.inputs],
    pitLapOverrides: { ...live.pitLapOverrides },
  };
}

export function emptyLive(car: Pick<CarEntry, 'setup' | 'plan' | 'drivers'>, settings: Settings): CarLive {
  const s0 = car.plan.stints[0];
  const fuel = car.plan.startFuel === 'full' || car.plan.startFuel === 'auto' ? car.setup.fuelCapacityL : car.plan.startFuel;
  return {
    phase: 'pre',
    pitPhase: null,
    lapsCompleted: 0,
    lastLapEndSec: 0,
    stintIndex: 0,
    stintStartLap: 1,
    stintStartFuelL: fuel,
    stintStartEnergyPct: car.plan.startEnergyPct,
    driverId: s0?.driverId ?? car.drivers[0]?.id ?? '',
    fuelL: fuel,
    energyPct: car.setup.energyEnabled ? car.plan.startEnergyPct : 0,
    compound: car.plan.startCompound,
    tireAge: car.plan.startTireAge,
    lastLapMs: null,
    bestLapMs: null,
    gapAheadSec: null,
    gapBehindSec: null,
    position: null,
    traffic: 'clear',
    weather: 'Dry',
    driveMode: 'normal',
    fuelMethod: settings.defaults.fuelMethod,
    lastN: settings.defaults.lastN,
    userFuelPerLapL: null,
    laps: [],
    stops: [],
    pitLapOverrides: {},
    calls: [],
    inputs: [],
    lastUpdateLap: 0,
    strategyChangedLap: null,
  };
}

/** Sets grid state from the plan's projected start (fuel as planned). */
export function prepareGrid(race: Race, car: CarEntry, settings: Settings): CarLive {
  const live = emptyLive(car, settings);
  const sim = calculateStrategy(race.params, car.setup, car.plan, car.drivers);
  const s0 = sim.stints[0];
  if (s0) {
    live.fuelL = s0.fuelStartL;
    live.stintStartFuelL = s0.fuelStartL;
    live.energyPct = s0.energyStartPct;
    live.stintStartEnergyPct = s0.energyStartPct;
  }
  live.phase = 'grid';
  return live;
}

export function startRaceLive(live: CarLive): CarLive {
  return { ...cloneLive(live), phase: 'racing', lapsCompleted: 0, lastLapEndSec: 0, stintStartLap: 1 };
}

export function applyQuickUpdate(car: CarEntry, input: QuickUpdateInput, nowSec: number, settings: Settings): CarLive {
  const live = cloneLive(car.live);
  const prev = live.lapsCompleted;
  const next = input.lapsCompleted ?? prev;
  const delta = next - prev;
  const fields: string[] = [];

  if (delta < 0) {
    // confirmed lap correction — drop records beyond the new lap
    live.laps = live.laps.filter((l) => l.lap <= next);
    live.lapsCompleted = next;
    const last = live.laps[live.laps.length - 1];
    live.lastLapEndSec = input.raceTimeSec ?? last?.endSec ?? 0;
    fields.push('lap');
  } else if (delta > 0) {
    fields.push('lap');
    const fuelRate = measureFuelPerLap(car, settings).value;
    const energyRate = measureEnergyPerLap(car, settings).value;
    const expectedMs = live.lastLapMs && live.lastLapMs < car.setup.racePaceMs * 1.5 ? live.lastLapMs : car.setup.racePaceMs;
    const clockEnd = input.raceTimeSec ?? nowSec;
    let totalMs = (clockEnd - live.lastLapEndSec) * 1000;
    const timeKnown = totalMs > expectedMs * delta * 0.5;
    if (!timeKnown) totalMs = (input.lastLapMs ?? expectedMs) + expectedMs * (delta - 1);
    const endSec = timeKnown ? clockEnd : live.lastLapEndSec + totalMs / 1000;
    const fuelKnown = input.fuelL != null && input.fuelL <= live.fuelL;
    const fuelAfter = input.fuelL ?? Math.max(0, live.fuelL - fuelRate * delta);
    const fuelUsedTotal = input.fuelUsedL ?? live.fuelL - fuelAfter;
    const energyKnown = input.energyPct != null && input.energyPct <= live.energyPct;
    const energyAfter = input.energyPct ?? Math.max(0, live.energyPct - energyRate * delta);
    const energyUsedTotal = live.energyPct - energyAfter;
    const tireStart = input.tireAge != null && input.tireAge < live.tireAge ? input.tireAge - delta : live.tireAge;
    const lastMs = input.lastLapMs;
    const otherMs = lastMs && delta > 1 ? (totalMs - lastMs) / (delta - 1) : totalMs / delta;
    let t = live.lastLapEndSec;
    for (let k = 1; k <= delta; k++) {
      const lapMs = k === delta && lastMs ? lastMs : otherMs;
      t += lapMs / 1000;
      const rec: LapRecord = {
        lap: prev + k,
        stint: live.stintIndex,
        driverId: live.driverId,
        lapMs,
        endSec: k === delta ? endSec : t,
        fuelUsedL: fuelKnown ? fuelUsedTotal / delta : null,
        fuelAfterL: live.fuelL - (fuelUsedTotal / delta) * k,
        energyUsedPct: energyKnown ? energyUsedTotal / delta : null,
        energyAfterPct: live.energyPct - (energyUsedTotal / delta) * k,
        tireAge: Math.max(0, tireStart) + k,
        compound: input.compound ?? live.compound,
        estimated: delta > 1 || !timeKnown,
      };
      live.laps.push(rec);
    }
    live.lapsCompleted = next;
    live.lastLapEndSec = endSec;
    live.fuelL = fuelAfter;
    live.energyPct = energyAfter;
    live.tireAge = input.tireAge ?? live.tireAge + delta;
    live.lastLapMs = lastMs ?? (timeKnown ? otherMs : live.lastLapMs);
    if (live.lastLapMs && (!live.bestLapMs || live.lastLapMs < live.bestLapMs)) live.bestLapMs = live.lastLapMs;
  }

  if (delta <= 0) {
    if (input.fuelL != null) live.fuelL = input.fuelL;
    if (input.energyPct != null) live.energyPct = input.energyPct;
    if (input.tireAge != null) live.tireAge = input.tireAge;
    if (input.lastLapMs != null) {
      live.lastLapMs = input.lastLapMs;
      const last = live.laps[live.laps.length - 1];
      if (last) live.laps[live.laps.length - 1] = { ...last, lapMs: input.lastLapMs, estimated: false };
      if (!live.bestLapMs || input.lastLapMs < live.bestLapMs) live.bestLapMs = input.lastLapMs;
    }
  }
  if (input.fuelL != null) fields.push('fuel');
  if (input.energyPct != null) fields.push('energy');
  if (input.tireAge != null) fields.push('tires');
  if (input.lastLapMs != null) fields.push('lap time');
  if (input.raceTimeSec != null) fields.push('race time');
  if (input.compound) {
    live.compound = input.compound;
    fields.push('compound');
  }
  if (input.bestLapMs != null) live.bestLapMs = input.bestLapMs;
  if (input.gapAheadSec !== undefined) live.gapAheadSec = input.gapAheadSec;
  if (input.gapBehindSec !== undefined) live.gapBehindSec = input.gapBehindSec;
  if (input.position !== undefined) live.position = input.position;
  if (input.traffic) live.traffic = input.traffic;
  if (input.weather) live.weather = input.weather;
  live.lastUpdateLap = live.lapsCompleted;
  live.inputs.push({
    id: uid('in'),
    raceTimeSec: input.raceTimeSec ?? nowSec,
    lap: live.lapsCompleted + 1,
    fields,
    summary: fields.length ? `Updated ${fields.join(', ')}` : 'No changes',
    createdAt: new Date().toISOString(),
  });
  if (live.inputs.length > 400) live.inputs = live.inputs.slice(-400);
  return live;
}

export interface PitStopInput {
  inLap: number;
  fuelAddedL: number;
  energyAfterPct?: number;
  changeTires: boolean;
  compound: string;
  toDriverId: string;
  stationarySec: number;
  totalLossSec: number;
  note?: string;
  underEvent?: ActualStop['underEvent'];
  inLapMs?: number;
  stationaryTimed?: boolean;
  totalTimed?: boolean;
}

export function recordPitStop(car: CarEntry, input: PitStopInput, nowSec: number, settings: Settings): CarLive {
  let live = cloneLive(car.live);
  // complete the in-lap if it has not been counted yet
  if (input.inLap === live.lapsCompleted + 1) {
    const fuelRate = measureFuelPerLap(car, settings).value;
    const energyRate = measureEnergyPerLap(car, settings).value;
    const expected = (live.lastLapMs ?? car.setup.racePaceMs) + input.totalLossSec * 1000;
    const measured = (nowSec - live.lastLapEndSec) * 1000;
    const lapMs = input.inLapMs ?? (measured > expected * 0.6 ? measured : expected);
    const endSec = live.lastLapEndSec + lapMs / 1000;
    live.laps.push({
      lap: input.inLap,
      stint: live.stintIndex,
      driverId: live.driverId,
      lapMs,
      endSec,
      fuelUsedL: null,
      fuelAfterL: Math.max(0, live.fuelL - fuelRate),
      energyUsedPct: null,
      energyAfterPct: Math.max(0, live.energyPct - energyRate),
      tireAge: live.tireAge + 1,
      compound: live.compound,
      pitIn: true,
      estimated: input.inLapMs == null,
    });
    live.fuelL = Math.max(0, live.fuelL - fuelRate);
    live.energyPct = Math.max(0, live.energyPct - energyRate);
    live.tireAge += 1;
    live.lapsCompleted = input.inLap;
    live.lastLapEndSec = endSec;
    live.lastLapMs = lapMs;
  } else {
    const idx = live.laps.findIndex((l) => l.lap === input.inLap);
    if (idx >= 0) live.laps[idx] = { ...live.laps[idx], pitIn: true };
  }
  const stop: ActualStop = {
    index: live.stops.length,
    lap: input.inLap,
    raceTimeSec: live.lastLapEndSec,
    fuelAddedL: Math.min(input.fuelAddedL, Math.max(0, car.setup.fuelCapacityL - live.fuelL)),
    energyAddedPct: input.energyAfterPct != null ? Math.max(0, input.energyAfterPct - live.energyPct) : 0,
    changeTires: input.changeTires,
    compound: input.changeTires ? input.compound : live.compound,
    fromDriverId: live.driverId,
    toDriverId: input.toDriverId,
    stationarySec: input.stationarySec,
    totalLossSec: input.totalLossSec,
    underEvent: input.underEvent,
    note: input.note,
    stationaryTimed: input.stationaryTimed,
    totalTimed: input.totalTimed,
  };
  live.stops.push(stop);
  live.fuelL = Math.min(car.setup.fuelCapacityL, live.fuelL + stop.fuelAddedL);
  if (input.energyAfterPct != null) live.energyPct = input.energyAfterPct;
  if (input.changeTires) {
    live.compound = input.compound;
    live.tireAge = 0;
  }
  live.driverId = input.toDriverId;
  live.stintIndex = Math.min(live.stintIndex + 1, Math.max(0, car.plan.stints.length - 1) + 50);
  live.stintStartLap = input.inLap + 1;
  live.stintStartFuelL = live.fuelL;
  live.stintStartEnergyPct = live.energyPct;
  live.pitPhase = null;
  live.driveMode = 'normal';
  live.lastUpdateLap = live.lapsCompleted;
  live = { ...live };
  return live;
}

export function makeCall(
  live: CarLive,
  nowSec: number,
  text: string,
  priority: CallPriority,
  reason: string,
  status: CallStatus,
  source: CallLogEntry['source'],
): CallLogEntry {
  return {
    id: uid('call'),
    raceTimeSec: nowSec,
    lap: live.lapsCompleted + 1,
    text,
    priority,
    reason,
    status,
    source,
    createdAt: new Date().toISOString(),
  };
}

/**
 * DEMO MODE lap engine. Stands in for the humans typing numbers during a race
 * so the product can be demonstrated. All values are SAMPLE DATA with seeded
 * noise — not LMU physics.
 */
import { activeEventAt, calculateEnergyPerLap, calculateFuelPerLap, driverFuelFactor, getCompound, netEnergyPerLap, predictLapMs } from './model';
import { cloneLive, makeCall, recordPitStop } from './liveOps';
import { projectLive } from './live';
import { TEMPLATE_LABEL } from './model';
import type { CarEntry, CarLive, Race, Settings } from './types';

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface DemoLapOptions {
  logCalls?: boolean; // write simulated pitwall history (used when seeding)
}

/** Simulates one lap for a demo car and returns the new live state. */
export function demoAdvanceLap(race: Race, car: CarEntry, settings: Settings, o: DemoLapOptions = {}): CarLive {
  const live0 = car.live;
  if (live0.phase !== 'racing') return live0;
  const demo = car.demo ?? { seed: 1, fuelBias: 0, energyBias: 0, paceBias: 0 };
  const lap = live0.lapsCompleted + 1;
  const rng = mulberry32(demo.seed * 7919 + lap * 104729);
  const t0 = live0.lastLapEndSec;
  const p = projectLive(race, car, settings, t0);
  const ev = activeEventAt(race.events, t0);
  const driver = car.drivers.find((d) => d.id === live0.driverId);
  const spec = getCompound(car.setup, live0.compound);

  let live = cloneLive(live0);

  // ── calls the simulated pitwall would make (history seeding only) ────────
  if (o.logCalls && !p.isFinalStint) {
    if (p.window.target === lap + 1)
      live.calls.push(makeCall(live, t0, 'BOX NEXT LAP', 'ACTION', 'Target stint length', 'COMPLETED', 'system'));
  }

  const pitThisLap = !p.isFinalStint && lap >= p.window.target;

  let lapMs = predictLapMs({
    setup: car.setup,
    driver,
    compound: spec,
    tireAge: live.tireAge,
    mode: live.driveMode,
    fuelL: live.fuelL,
    event: ev,
    paceBiasMs: demo.paceBias,
  });
  lapMs += gauss(rng) * 280;
  if (!ev && rng() < 0.12) lapMs += 400 + rng() * 1600; // traffic
  if (lap === 1) lapMs += 4200; // standing-start / formation effects (sample)

  const fpl = calculateFuelPerLap(car.setup.fuelPerLapL * (1 + demo.fuelBias), car.setup, live.driveMode, ev, driverFuelFactor(car.setup, driver)) * (1 + gauss(rng) * 0.012);
  const epl = calculateEnergyPerLap(netEnergyPerLap(car.setup) * (1 + demo.energyBias), car.setup, live.driveMode, ev) * (1 + gauss(rng) * 0.012);

  if (pitThisLap && p.nextStop) {
    const s = p.nextStop;
    const stationary = s.stationarySec + gauss(rng) * 0.6;
    const total = s.laneSec + stationary;
    const inLapMs = lapMs + total * 1000;
    if (o.logCalls) {
      live.calls.push(makeCall(live, t0, 'BOX THIS LAP', 'CRITICAL', s.reason, 'COMPLETED', 'system'));
      if (s.driverChange) {
        const to = car.drivers.find((d) => d.id === s.toDriverId)?.name ?? '';
        live.calls.push(makeCall(live, t0 + lapMs / 1000, `DRIVER CHANGE CONFIRMED → ${to.toUpperCase()}`, 'UPCOMING', 'Scheduled', 'CONFIRMED', 'system'));
      }
      live.calls.push(makeCall(live, t0 + lapMs / 1000, s.changeTires ? `TAKE TIRES — ${s.compound}` : 'NO TIRE CHANGE', 'UPCOMING', TEMPLATE_LABEL[s.template], 'CONFIRMED', 'system'));
    }
    // pre-stop: consume the in-lap fuel, then service
    live.fuelL = Math.max(0, live.fuelL - fpl);
    live.energyPct = Math.max(0, live.energyPct - epl);
    live.laps.push({
      lap,
      stint: live.stintIndex,
      driverId: live.driverId,
      lapMs: inLapMs,
      endSec: t0 + inLapMs / 1000,
      fuelUsedL: fpl,
      fuelAfterL: live.fuelL,
      energyUsedPct: epl,
      energyAfterPct: live.energyPct,
      tireAge: live.tireAge + 1,
      compound: live.compound,
      mode: live.driveMode,
      pitIn: true,
      event: ev?.type,
    });
    live.tireAge += 1;
    live.lapsCompleted = lap;
    live.lastLapEndSec = t0 + inLapMs / 1000;
    live.lastLapMs = inLapMs;
    const energyAfter = Math.min(car.setup.energyCapacityPct, live.energyPct + s.energyAddedPct);
    const tmp: CarEntry = { ...car, live };
    live = recordPitStop(
      tmp,
      {
        inLap: lap,
        fuelAddedL: s.fuelAddedL,
        energyAfterPct: car.setup.energyEnabled ? energyAfter : undefined,
        changeTires: s.changeTires,
        compound: s.compound,
        toDriverId: s.toDriverId,
        stationarySec: stationary,
        totalLossSec: total,
        underEvent: ev?.type,
        note: 'Demo feed',
        stationaryTimed: true,
        totalTimed: true,
      },
      live.lastLapEndSec,
      settings,
    );
    if (o.logCalls) live.calls.push(makeCall(live, live.lastLapEndSec, `STINT ${live.stintIndex + 1} STARTED`, 'INFO', `Out-lap ${lap + 1}`, 'LOGGED', 'event'));
  } else {
    live.fuelL = live.fuelL - fpl;
    live.energyPct = live.energyPct - epl;
    live.tireAge += 1;
    live.laps.push({
      lap,
      stint: live.stintIndex,
      driverId: live.driverId,
      lapMs,
      endSec: t0 + lapMs / 1000,
      fuelUsedL: fpl,
      fuelAfterL: live.fuelL,
      energyUsedPct: epl,
      energyAfterPct: live.energyPct,
      tireAge: live.tireAge,
      compound: live.compound,
      mode: live.driveMode,
      event: ev?.type,
    });
    live.lapsCompleted = lap;
    live.lastLapEndSec = t0 + lapMs / 1000;
    live.lastLapMs = lapMs;
    if (!ev && lap > 1 && (!live.bestLapMs || lapMs < live.bestLapMs)) live.bestLapMs = lapMs;
  }
  live.lastUpdateLap = live.lapsCompleted;
  // gaps: gentle random walk (sample)
  live.gapAheadSec = Math.max(0.2, (live.gapAheadSec ?? 4.2) + gauss(rng) * 0.25);
  live.gapBehindSec = Math.max(0.2, (live.gapBehindSec ?? 6.8) + gauss(rng) * 0.25);
  live.traffic = rng() < 0.15 ? 'heavy' : rng() < 0.4 ? 'light' : 'clear';

  const done = race.params.lengthMode === 'laps' ? live.lapsCompleted >= race.params.laps : live.lastLapEndSec >= race.params.durationSec;
  if (done) live.phase = 'finished';
  return live;
}

/** Next lap end time without mutating state (for clock-driven auto laps). */
export function demoNextLapEnd(race: Race, car: CarEntry, settings: Settings): number {
  const next = demoAdvanceLap(race, car, settings);
  return next.lastLapEndSec;
}

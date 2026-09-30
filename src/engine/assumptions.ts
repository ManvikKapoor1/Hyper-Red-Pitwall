/**
 * Entered assumptions next to what the recorded race data measured.
 *
 * Laps are compared with the plan's own per-lap assumption (lapTrace), so
 * driver factors, drive modes, tire wear, fuel load and scenarios cancel out:
 * the measured value is the car-level input that would have predicted the
 * recorded laps. Only green, non-estimated laps count, and pit timing only
 * uses stops whose times were actually entered (not the setup estimate).
 */
import { netEnergyPerLap } from './model';
import { lapTrace } from './trace';
import type { CarEntry, CarSetup, Confidence, Driver, ID, LapRecord, ScenarioEvent } from './types';

export type AssumptionKey = 'fuelPerLapL' | 'energyPerLapPct' | 'racePaceMs' | 'pitLaneLossSec' | 'refuelRateLps';

export interface AssumptionRow {
  key: AssumptionKey;
  label: string;
  entered: number;
  measured: number | null;
  samples: number;
  confidence: Confidence;
  basis: string;
}

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
const mean = (v: number[]) => (v.length ? sum(v) / v.length : NaN);
const conf = (n: number): Confidence => (n >= 8 ? 'HIGH' : n >= 3 ? 'MEDIUM' : 'LOW');

export function cleanLaps(laps: LapRecord[]): LapRecord[] {
  return laps.filter((l) => !l.pitIn && !l.event && !l.estimated);
}

export function assumptionRows(car: CarEntry, events: ScenarioEvent[] = []): AssumptionRow[] {
  const { setup, live } = car;
  const trace = lapTrace(car, events).filter((t) => t.green && !t.estimated);
  const fuel = trace.filter((t) => t.fuelUsedL != null && t.fuelUsedL > 0 && t.assumedFuelL > 0);
  const energy = trace.filter((t) => t.energyUsedPct != null && t.energyUsedPct > 0 && t.assumedEnergyPct > 0);
  const lane = live.stops.filter((s) => s.stationaryTimed && s.totalTimed && !s.underEvent).map((s) => s.totalLossSec - s.stationarySec);
  const refuel = live.stops
    .filter((s) => s.stationaryTimed && !s.changeTires && s.fromDriverId === s.toDriverId && s.stationarySec > 0 && s.fuelAddedL > 0)
    .map((s) => s.fuelAddedL / s.stationarySec);

  const row = (key: AssumptionKey, label: string, entered: number, measured: number, samples: number, basis: string): AssumptionRow => ({
    key,
    label,
    entered,
    measured: samples > 0 && isFinite(measured) ? measured : null,
    samples,
    confidence: conf(samples),
    basis,
  });
  const fuelRatio = sum(fuel.map((t) => t.fuelUsedL!)) / sum(fuel.map((t) => t.assumedFuelL));
  const energyRatio = sum(energy.map((t) => t.energyUsedPct!)) / sum(energy.map((t) => t.assumedEnergyPct));
  const paceBias = mean(trace.map((t) => t.lapMs - t.assumedLapMs));
  const rows = [
    row('fuelPerLapL', 'Fuel per lap', setup.fuelPerLapL, setup.fuelPerLapL * fuelRatio, fuel.length, `${fuel.length} green laps vs plan assumption (driver & mode normalised)`),
    row('racePaceMs', 'Race pace', setup.racePaceMs, setup.racePaceMs + paceBias, trace.length, `${trace.length} green laps vs predicted (driver, tires, fuel normalised)`),
    row('pitLaneLossSec', 'Pit-lane loss', setup.pitLaneLossSec, mean(lane), lane.length, `${lane.length} timed green-flag stops (total − stationary)`),
    row('refuelRateLps', 'Refuel rate', setup.refuelRateLps, mean(refuel), refuel.length, `${refuel.length} timed fuel-only stops`),
  ];
  if (setup.energyEnabled) rows.splice(1, 0, row('energyPerLapPct', 'Energy per lap (net)', netEnergyPerLap(setup), netEnergyPerLap(setup) * energyRatio, energy.length, `${energy.length} green laps vs plan assumption`));
  return rows;
}

/**
 * Setup patch + drivers that adopt a measured value. Driver-specific fuel and
 * pace keep their offsets to the car value, so the whole car shifts together.
 */
export function adoptMeasured(car: CarEntry, row: AssumptionRow): { setup: Partial<CarSetup>; drivers: Driver[] } | null {
  const m = row.measured;
  if (m == null) return null;
  const { setup, drivers } = car;
  switch (row.key) {
    case 'fuelPerLapL': {
      const ratio = setup.fuelPerLapL > 0 ? m / setup.fuelPerLapL : 1;
      return { setup: { fuelPerLapL: m }, drivers: drivers.map((d) => (d.fuelPerLapL ? { ...d, fuelPerLapL: d.fuelPerLapL * ratio } : d)) };
    }
    case 'racePaceMs': {
      const delta = Math.round(m) - setup.racePaceMs;
      return { setup: { racePaceMs: Math.round(m) }, drivers: drivers.map((d) => (d.paceMs ? { ...d, paceMs: d.paceMs + delta } : d)) };
    }
    case 'energyPerLapPct':
      return { setup: { energyPerLapPct: m + setup.energyRecoveryPerLapPct }, drivers };
    case 'pitLaneLossSec':
      return { setup: { pitLaneLossSec: m }, drivers };
    case 'refuelRateLps':
      return { setup: { refuelRateLps: m }, drivers };
  }
}

export interface DriverStats {
  driverId: ID;
  laps: number;
  greenLaps: number;
  avgLapMs: number | null;
  bestLapMs: number | null;
  fuelPerLapL: number | null;
  energyPerLapPct: number | null;
}

export function driverStats(car: CarEntry): DriverStats[] {
  return car.drivers.map((d) => {
    const all = car.live.laps.filter((l) => l.driverId === d.id);
    const g = cleanLaps(all);
    const f = g.map((l) => l.fuelUsedL).filter((v): v is number => v != null && v > 0);
    const e = g.map((l) => l.energyUsedPct).filter((v): v is number => v != null && v > 0);
    return {
      driverId: d.id,
      laps: all.length,
      greenLaps: g.length,
      avgLapMs: g.length ? mean(g.map((l) => l.lapMs)) : null,
      bestLapMs: g.length ? Math.min(...g.map((l) => l.lapMs)) : null,
      fuelPerLapL: f.length ? mean(f) : null,
      energyPerLapPct: e.length ? mean(e) : null,
    };
  });
}

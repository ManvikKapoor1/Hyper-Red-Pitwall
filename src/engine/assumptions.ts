/**
 * Entered assumptions next to what the recorded race data measured.
 * Only green-flag, non-estimated laps count; stops are used only when their
 * work isolates the quantity (e.g. refuel rate from fuel-only stops).
 */
import { netEnergyPerLap } from './model';
import type { CarEntry, CarSetup, Confidence, ID, LapRecord } from './types';

export type AssumptionKey = 'fuelPerLapL' | 'energyPerLapPct' | 'racePaceMs' | 'pitLaneLossSec' | 'refuelRateLps';

export interface AssumptionRow {
  key: AssumptionKey;
  label: string;
  entered: number;
  measured: number | null;
  samples: number;
  confidence: Confidence;
  basis: string;
  /** Setup patch that adopts the measured value (keeps derived inputs consistent). */
  adopt?: Partial<CarSetup>;
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);
const conf = (n: number): Confidence => (n >= 8 ? 'HIGH' : n >= 3 ? 'MEDIUM' : 'LOW');

export function cleanLaps(laps: LapRecord[]): LapRecord[] {
  return laps.filter((l) => !l.pitIn && !l.event && !l.estimated);
}

export function assumptionRows(car: CarEntry): AssumptionRow[] {
  const { setup, live } = car;
  const green = cleanLaps(live.laps);
  const fuel = green.map((l) => l.fuelUsedL).filter((v): v is number => v != null && v > 0);
  const energy = green.map((l) => l.energyUsedPct).filter((v): v is number => v != null && v > 0);
  const pace = green.map((l) => l.lapMs);
  const lane = live.stops.filter((s) => !s.underEvent).map((s) => s.totalLossSec - s.stationarySec);
  const refuel = live.stops.filter((s) => !s.changeTires && s.fromDriverId === s.toDriverId && s.stationarySec > 0 && s.fuelAddedL > 0).map((s) => s.fuelAddedL / s.stationarySec);
  const row = (key: AssumptionKey, label: string, entered: number, values: number[], basis: string, adopt: (m: number) => Partial<CarSetup>): AssumptionRow => {
    const m = mean(values);
    const measured = isFinite(m) ? m : null;
    return { key, label, entered, measured, samples: values.length, confidence: conf(values.length), basis, adopt: measured != null ? adopt(measured) : undefined };
  };
  const rows = [
    row('fuelPerLapL', 'Fuel per lap', setup.fuelPerLapL, fuel, `${fuel.length} green laps (all drivers)`, (m) => ({ fuelPerLapL: m })),
    row('racePaceMs', 'Race pace', setup.racePaceMs, pace, `${pace.length} green laps (all drivers)`, (m) => ({ racePaceMs: Math.round(m) })),
    row('pitLaneLossSec', 'Pit-lane loss', setup.pitLaneLossSec, lane, `${lane.length} green-flag stops (total − stationary)`, (m) => ({ pitLaneLossSec: m })),
    row('refuelRateLps', 'Refuel rate', setup.refuelRateLps, refuel, `${refuel.length} fuel-only stops`, (m) => ({ refuelRateLps: m })),
  ];
  if (setup.energyEnabled)
    rows.splice(1, 0, row('energyPerLapPct', 'Energy per lap (net)', netEnergyPerLap(setup), energy, `${energy.length} green laps`, (m) => ({ energyPerLapPct: m + setup.energyRecoveryPerLapPct })));
  return rows;
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

/**
 * Manual-input validation. Humans type race numbers under pressure; the system
 * must never silently accept values that look inconsistent.
 */
import { measureFuelPerLap } from './live';
import { formatLapMs, fuelRateText, fuelText } from './format';
import type { CarEntry, Settings, TrafficLevel } from './types';

export interface QuickUpdateInput {
  lapsCompleted?: number; // current lap − 1
  raceTimeSec?: number;
  fuelL?: number;
  energyPct?: number;
  tireAge?: number;
  compound?: string;
  lastLapMs?: number;
  bestLapMs?: number;
  gapAheadSec?: number | null;
  gapBehindSec?: number | null;
  position?: number | null;
  traffic?: TrafficLevel;
  weather?: string;
  fuelUsedL?: number; // optional explicit fuel used since previous update
}

export type WarningCode =
  | 'LAP_DECREASED'
  | 'LAP_JUMP'
  | 'TIME_DECREASED'
  | 'TIME_LAP_MISMATCH'
  | 'FUEL_INCREASED'
  | 'FUEL_OVER_CAPACITY'
  | 'FUEL_RATE_CHANGE'
  | 'FUEL_NEGATIVE'
  | 'TIRE_AGE_DECREASED'
  | 'TIRE_AGE_JUMP'
  | 'ENERGY_INCREASED'
  | 'ENERGY_RANGE'
  | 'LAP_TIME_OUTLIER';

export interface ValidationWarning {
  code: WarningCode;
  field: keyof QuickUpdateInput;
  severity: 'warning' | 'critical';
  message: string;
  suggestsPit?: boolean;
  suggestsTireChange?: boolean;
}

export function validateRaceData(car: CarEntry, input: QuickUpdateInput, settings: Settings): ValidationWarning[] {
  const w: ValidationWarning[] = [];
  const { live, setup } = car;
  const fu = settings.units.fuel;
  const prevLap = live.lapsCompleted + 1;
  const newCompleted = input.lapsCompleted ?? live.lapsCompleted;
  const newLap = newCompleted + 1;
  const lapDelta = newCompleted - live.lapsCompleted;

  if (input.lapsCompleted != null) {
    if (lapDelta < 0)
      w.push({ code: 'LAP_DECREASED', field: 'lapsCompleted', severity: 'critical', message: `Current lap changed from ${prevLap} to ${newLap}. Confirm race state.` });
    else if (lapDelta > 5)
      w.push({ code: 'LAP_JUMP', field: 'lapsCompleted', severity: 'warning', message: `Current lap jumped by ${lapDelta} laps (${prevLap} → ${newLap}). Intermediate laps will be interpolated.` });
  }

  if (input.raceTimeSec != null) {
    if (input.raceTimeSec < live.lastLapEndSec - 1)
      w.push({ code: 'TIME_DECREASED', field: 'raceTimeSec', severity: 'critical', message: `Race time is earlier than the last recorded lap end. Confirm race clock.` });
    else if (lapDelta > 0) {
      const perLap = (input.raceTimeSec - live.lastLapEndSec) / lapDelta;
      const ref = (live.lastLapMs ?? setup.racePaceMs) / 1000;
      if (perLap < ref * 0.6 || perLap > ref * 3)
        w.push({ code: 'TIME_LAP_MISMATCH', field: 'raceTimeSec', severity: 'warning', message: `Race time implies ${perLap.toFixed(1)} s/lap over ${lapDelta} lap(s) — expected ≈ ${ref.toFixed(1)} s. Verify lap or clock.` });
    }
  }

  if (input.fuelL != null) {
    if (input.fuelL < 0) w.push({ code: 'FUEL_NEGATIVE', field: 'fuelL', severity: 'critical', message: 'Fuel cannot be negative.' });
    if (input.fuelL > setup.fuelCapacityL + 0.05)
      w.push({ code: 'FUEL_OVER_CAPACITY', field: 'fuelL', severity: 'critical', message: `Fuel ${fuelText(input.fuelL, fu)} exceeds tank capacity ${fuelText(setup.fuelCapacityL, fu)}.` });
    const diff = input.fuelL - live.fuelL;
    if (diff > 0.5)
      w.push({ code: 'FUEL_INCREASED', field: 'fuelL', severity: 'warning', message: `Fuel increased by ${fuelText(diff, fu)} without a recorded pit stop. Was a pit stop completed?`, suggestsPit: true });
    else if (lapDelta > 0) {
      const used = input.fuelUsedL ?? live.fuelL - input.fuelL;
      const perLap = used / lapDelta;
      const avg = measureFuelPerLap(car, settings).value;
      if (avg > 0 && Math.abs(perLap - avg) / avg > settings.alerts.consumptionChangePct / 100)
        w.push({ code: 'FUEL_RATE_CHANGE', field: 'fuelL', severity: 'warning', message: `Fuel consumption changed from ${fuelRateText(avg, fu)} to ${fuelRateText(perLap, fu)}. Verify input.` });
    }
  }

  if (input.tireAge != null) {
    if (input.tireAge < live.tireAge)
      w.push({ code: 'TIRE_AGE_DECREASED', field: 'tireAge', severity: 'warning', message: `Tire age decreased from ${live.tireAge} laps to ${input.tireAge} laps. Confirm tire change.`, suggestsTireChange: true });
    else if (lapDelta >= 0 && input.tireAge - live.tireAge > lapDelta + 1)
      w.push({ code: 'TIRE_AGE_JUMP', field: 'tireAge', severity: 'warning', message: `Tire age increased by ${input.tireAge - live.tireAge} laps but lap advanced by ${lapDelta}.` });
  }

  if (input.energyPct != null && setup.energyEnabled) {
    if (input.energyPct < 0 || input.energyPct > setup.energyCapacityPct)
      w.push({ code: 'ENERGY_RANGE', field: 'energyPct', severity: 'critical', message: `Energy ${input.energyPct}% is outside 0–${setup.energyCapacityPct}%.` });
    else if (input.energyPct - live.energyPct > 0.5)
      w.push({ code: 'ENERGY_INCREASED', field: 'energyPct', severity: 'warning', message: `Energy increased by ${(input.energyPct - live.energyPct).toFixed(1)}% without a recorded pit stop.`, suggestsPit: true });
  }

  if (input.lastLapMs != null) {
    const ref = live.lastLapMs && live.lastLapMs > 0 ? live.lastLapMs : setup.racePaceMs;
    const dev = Math.abs(input.lastLapMs - ref) / ref;
    if (dev > settings.alerts.lapTimeDeviationPct / 100)
      w.push({ code: 'LAP_TIME_OUTLIER', field: 'lastLapMs', severity: 'warning', message: `Lap time ${formatLapMs(input.lastLapMs)} differs ${(dev * 100).toFixed(0)}% from reference ${formatLapMs(ref)}. Verify input.` });
  }
  return w;
}

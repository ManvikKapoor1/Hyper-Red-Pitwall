/**
 * Manual-input validation. Humans type race numbers under pressure; the system
 * must never silently accept values that look inconsistent.
 */
import { measureFuelPerLap, measurePace, referenceLapMs } from './live';
import { activeEventAt } from './model';
import { formatLapMs, fuelRateText, fuelText } from './format';
import type { CarEntry, ScenarioEvent, Settings, TrafficLevel } from './types';

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

/**
 * `events` (safety car, slow zone …) raise the expected lap time by their lap
 * delta, so a slow lap under a caution is not flagged as a typo.
 */
export function validateRaceData(car: CarEntry, input: QuickUpdateInput, settings: Settings, events: ScenarioEvent[] = []): ValidationWarning[] {
  const w: ValidationWarning[] = [];
  const { live, setup } = car;
  // green lap (no pit loss, no caution): between the lap model and the model
  // corrected by the laps timed so far — either is a plausible pace
  const green = referenceLapMs(car);
  const pace = measurePace(car, 5);
  const ok = (x: number) => Number.isFinite(x) && x > 0;
  const lo = Math.min(...[pace.modelMs, green].filter(ok));
  const hi = Math.max(...[pace.modelMs, green].filter(ok));
  const caution = (sec: number) => (activeEventAt(events, sec)?.lapDeltaSec ?? 0) * 1000;
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
      const ref = green / 1000;
      if (perLap < (lo / 1000) * 0.6 || perLap > ((hi + caution(live.lastLapEndSec)) / 1000) * 3)
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
      const greenRate = measureFuelPerLap(car, settings).value;
      // a lap touching a caution burns anywhere from the reduced to the green rate
      const lapSec = input.raceTimeSec != null ? Math.max(0, input.raceTimeSec - live.lastLapEndSec) / lapDelta : referenceLapMs(car) / 1000;
      let low = 0;
      for (let k = 0; k < lapDelta; k++) {
        const t0 = live.lastLapEndSec + k * lapSec;
        const red = Math.max(activeEventAt(events, t0)?.fuelReductionPct ?? 0, activeEventAt(events, t0 + lapSec - 0.001)?.fuelReductionPct ?? 0);
        low += greenRate * (1 - red / 100);
      }
      const avg = Math.min(Math.max(perLap, low / lapDelta), greenRate);
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
    // the entered lap is the last one completed: it started one lap time before the reported race time
    const end = lapDelta > 0 ? (input.raceTimeSec ?? live.lastLapEndSec + (lapDelta * green) / 1000) : live.lastLapEndSec;
    // a caution during any part of the lap: anything from green to full caution pace is plausible
    const slow = Math.max(caution(Math.max(0, end - input.lastLapMs / 1000)), caution(Math.max(0, end - 0.001)));
    const ref = Math.min(Math.max(input.lastLapMs, lo), hi + slow);
    const dev = Math.abs(input.lastLapMs - ref) / ref;
    if (dev > settings.alerts.lapTimeDeviationPct / 100)
      w.push({ code: 'LAP_TIME_OUTLIER', field: 'lastLapMs', severity: 'warning', message: `Lap time ${formatLapMs(input.lastLapMs)} differs ${(dev * 100).toFixed(0)}% from reference ${formatLapMs(ref)}. Verify input.` });
  }
  return w;
}

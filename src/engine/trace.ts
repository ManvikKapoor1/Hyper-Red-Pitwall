/**
 * Lap traces — recorded laps paired with what the plan assumed for that lap.
 *
 * The assumption uses the plan stint's drive mode and overrides, the lap's
 * actual driver / compound / tire age / fuel load and any scenario that was
 * active, so the gap between the two lines is exactly the measurement error
 * of the entered assumptions.
 */
import {
  activeEventAt,
  calculateEnergyPerLap,
  calculateFuelPerLap,
  driverFuelFactor,
  getCompound,
  netEnergyPerLap,
  predictLapMs,
} from './model';
import type { CarEntry, LapRecord, ScenarioEvent, ScenarioType } from './types';

export interface TracePoint {
  lap: number;
  stint: number;
  driverId: string;
  lapMs: number;
  fuelUsedL: number | null;
  energyUsedPct: number | null;
  assumedLapMs: number;
  assumedFuelL: number;
  assumedEnergyPct: number;
  /** Pit in-laps and scenario laps are not representative green-flag laps. */
  green: boolean;
  pitIn: boolean;
  event?: ScenarioType;
  estimated: boolean;
}

export function lapTrace(car: CarEntry, events: ScenarioEvent[] = []): TracePoint[] {
  const { setup, plan, drivers } = car;
  const dmap = new Map(drivers.map((d) => [d.id, d]));
  return car.live.laps.map((l: LapRecord) => {
    const sp = plan.stints[Math.min(l.stint, plan.stints.length - 1)];
    const mode = sp?.mode ?? 'normal';
    const driver = dmap.get(l.driverId);
    const ev = l.event ? activeEventAt(events, l.endSec - l.lapMs / 2000) : undefined;
    const assumedLapMs = predictLapMs({
      setup,
      driver,
      compound: getCompound(setup, l.compound),
      tireAge: Math.max(0, l.tireAge - 1),
      mode,
      fuelL: l.fuelAfterL + (l.fuelUsedL ?? 0),
      event: ev,
      lapOverrideMs: sp?.lapTimeOverrideMs,
    });
    const assumedFuelL = sp?.fuelPerLapOverrideL
      ? sp.fuelPerLapOverrideL * (ev ? 1 - ev.fuelReductionPct / 100 : 1)
      : calculateFuelPerLap(setup.fuelPerLapL, setup, mode, ev, driverFuelFactor(setup, driver));
    const assumedEnergyPct = calculateEnergyPerLap(netEnergyPerLap(setup), setup, mode, ev);
    return {
      lap: l.lap,
      stint: l.stint,
      driverId: l.driverId,
      lapMs: l.lapMs,
      fuelUsedL: l.fuelUsedL,
      energyUsedPct: setup.energyEnabled ? l.energyUsedPct : null,
      assumedLapMs,
      assumedFuelL,
      assumedEnergyPct,
      green: !l.pitIn && !l.event,
      pitIn: !!l.pitIn,
      event: l.event,
      estimated: !!l.estimated,
    };
  });
}

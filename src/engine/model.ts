/**
 * Per-lap model primitives. Every number here derives from user-entered setup
 * values — nothing is assumed about LMU physics.
 */
import type {
  CarSetup,
  CompoundSpec,
  Driver,
  DriveMode,
  PitStopConfig,
  PitTemplate,
  ScenarioEvent,
  ServiceConcurrency,
} from './types';

export const FALLBACK_COMPOUND: CompoundSpec = {
  name: 'MEDIUM',
  paceOffsetSec: 0,
  degSecPerLap: 0,
  targetLife: 999,
  maxLife: 999,
  cliffSecPerLap: 0,
};

export function getCompound(setup: CarSetup, name: string): CompoundSpec {
  return setup.compounds.find((c) => c.name === name) ?? setup.compounds[0] ?? FALLBACK_COMPOUND;
}

/** Pace loss (s) for a tire of a given age, from the compound's degradation assumptions. */
export function calculateTirePerformance(spec: CompoundSpec, age: number): number {
  const linear = spec.degSecPerLap * age;
  const cliff = Math.max(0, age - spec.targetLife) * spec.cliffSecPerLap;
  return linear + cliff;
}

/** Tire age after `laps` more laps, resetting when a change occurs. */
export function calculateTireAge(currentAge: number, laps: number, changed = false): number {
  return (changed ? 0 : currentAge) + laps;
}

export function driverFuelFactor(setup: CarSetup, driver?: Driver): number {
  if (!driver?.fuelPerLapL || setup.fuelPerLapL <= 0) return 1;
  return driver.fuelPerLapL / setup.fuelPerLapL;
}

export function driverPaceOffsetMs(setup: CarSetup, driver?: Driver): number {
  if (!driver?.paceMs) return 0;
  return driver.paceMs - setup.racePaceMs;
}

export function netEnergyPerLap(setup: CarSetup): number {
  return Math.max(0, setup.energyPerLapPct - setup.energyRecoveryPerLapPct);
}

export function eventActiveAt(ev: ScenarioEvent, t: number): boolean {
  const end = ev.endedSec ?? ev.startSec + ev.durationSec;
  return t >= ev.startSec && t < end;
}

export function activeEventAt(events: ScenarioEvent[] | undefined, t: number): ScenarioEvent | undefined {
  if (!events) return undefined;
  for (let i = events.length - 1; i >= 0; i--) if (eventActiveAt(events[i], t)) return events[i];
  return undefined;
}

export interface LapContext {
  setup: CarSetup;
  driver?: Driver;
  compound: CompoundSpec;
  tireAge: number;
  mode: DriveMode;
  fuelL: number;
  event?: ScenarioEvent;
  lapOverrideMs?: number;
  paceBiasMs?: number;
}

/** Expected lap time (ms) from the assumption stack. */
export function predictLapMs(ctx: LapContext): number {
  const { setup, compound, tireAge, mode, fuelL, event } = ctx;
  const base = ctx.lapOverrideMs ?? setup.racePaceMs + driverPaceOffsetMs(setup, ctx.driver);
  let ms = base + (ctx.paceBiasMs ?? 0);
  ms += compound.paceOffsetSec * 1000;
  ms += calculateTirePerformance(compound, tireAge) * 1000;
  ms += (setup.modes[mode]?.lapSec ?? 0) * 1000;
  ms += setup.fuelEffectSecPerL * Math.max(0, fuelL) * 1000;
  if (event) ms += event.lapDeltaSec * 1000;
  return ms;
}

/** Fuel used per lap (L) for given conditions. */
export function calculateFuelPerLap(
  baseL: number,
  setup: CarSetup,
  mode: DriveMode,
  event?: ScenarioEvent,
  driverFactor = 1,
): number {
  const m = 1 + (setup.modes[mode]?.fuelPct ?? 0) / 100;
  const e = event ? 1 - event.fuelReductionPct / 100 : 1;
  return Math.max(0, baseL * driverFactor * m * e);
}

export function calculateEnergyPerLap(
  basePct: number,
  setup: CarSetup,
  mode: DriveMode,
  event?: ScenarioEvent,
): number {
  if (!setup.energyEnabled) return 0;
  const m = 1 + (setup.modes[mode]?.energyPct ?? 0) / 100;
  const e = event ? 1 - event.energyReductionPct / 100 : 1;
  return Math.max(0, basePct * m * e);
}

// ────────────────────────────────────────────────────────────────────────────
// Fuel
// ────────────────────────────────────────────────────────────────────────────

export interface FuelRange {
  theoretical: number; // laps (fractional)
  safe: number; // theoretical − safety margin
  safeWhole: number; // whole laps that can be completed safely
}

export function calculateFuelRemainingLaps(fuelL: number, perLapL: number, safetyMarginLaps: number): FuelRange {
  if (perLapL <= 0) return { theoretical: Infinity, safe: Infinity, safeWhole: Infinity };
  const theoretical = fuelL / perLapL;
  const safe = theoretical - safetyMarginLaps;
  return { theoretical, safe, safeWhole: Math.max(0, Math.floor(safe + 1e-9)) };
}

/** Fuel margin (L and laps) after completing `laps` more laps. */
export function calculateFuelMargin(fuelL: number, perLapL: number, laps: number) {
  const endL = fuelL - perLapL * laps;
  return { litres: endL, laps: perLapL > 0 ? endL / perLapL : Infinity };
}

/** Consumption needed to reach a lap target while keeping a reserve. */
export function requiredFuelPerLap(fuelL: number, laps: number, reserveLaps: number, currentPerLap: number): number {
  if (laps <= 0) return Infinity;
  // fuel − (reserveLaps × newRate) = laps × newRate  →  newRate = fuel / (laps + reserve)
  return fuelL / (laps + reserveLaps) || currentPerLap;
}

// ────────────────────────────────────────────────────────────────────────────
// Pit stop timing
// ────────────────────────────────────────────────────────────────────────────

export interface PitLossBreakdown {
  fuelSec: number;
  tireSec: number;
  driverSec: number;
  extraSec: number;
  stationarySec: number;
  laneSec: number;
  totalSec: number;
}

export function combineService(c: ServiceConcurrency, fuel: number, tires: number, driver: number): number {
  switch (c) {
    case 'sequential':
      return fuel + tires + driver;
    case 'parallel':
      return Math.max(fuel, tires, driver);
    case 'fuelDriverThenTires':
    default:
      return Math.max(fuel, driver) + tires;
  }
}

export function calculatePitLoss(
  setup: CarSetup,
  opts: { fuelAddedL: number; changeTires: boolean; driverChange: boolean; extraSec?: number; laneSecOverride?: number },
): PitLossBreakdown {
  const fuelSec = setup.refuelRateLps > 0 ? opts.fuelAddedL / setup.refuelRateLps : 0;
  const tireSec = opts.changeTires ? setup.tireChangeSec : 0;
  const driverSec = opts.driverChange ? setup.driverChangeSec : 0;
  const extraSec = opts.extraSec ?? 0;
  const stationarySec = combineService(setup.concurrency, fuelSec, tireSec, driverSec) + extraSec;
  const laneSec = opts.laneSecOverride ?? setup.pitLaneLossSec;
  return { fuelSec, tireSec, driverSec, extraSec, stationarySec, laneSec, totalSec: laneSec + stationarySec };
}

export function deriveTemplate(cfg: PitStopConfig, fuelAddedL: number, driverChange: boolean): PitTemplate {
  if (cfg.template === 'EMERGENCY' || cfg.template === 'CUSTOM') return cfg.template;
  const fuel = fuelAddedL > 0.05;
  const tires = cfg.changeTires;
  if (fuel && tires && driverChange) return 'FUEL_TIRES_DRIVER';
  if (fuel && tires) return 'FUEL_TIRES';
  if (fuel && driverChange) return 'FUEL_DRIVER';
  if (fuel) return 'FUEL_ONLY';
  if (driverChange && !tires) return 'DRIVER_ONLY';
  return 'CUSTOM';
}

export const TEMPLATE_LABEL: Record<PitTemplate, string> = {
  FUEL_ONLY: 'FUEL ONLY',
  FUEL_TIRES: 'FUEL + TIRES',
  FUEL_DRIVER: 'FUEL + DRIVER',
  FUEL_TIRES_DRIVER: 'FUEL + TIRES + DRIVER',
  DRIVER_ONLY: 'DRIVER ONLY',
  EMERGENCY: 'EMERGENCY',
  CUSTOM: 'CUSTOM',
};

export function describeStopReason(tpl: PitTemplate, cfgReason: string, driverChange: boolean, tires: boolean): string {
  if (cfgReason) return cfgReason;
  const parts: string[] = [];
  if (driverChange) parts.push('Driver change');
  if (tires) parts.push('tires');
  if (tpl !== 'DRIVER_ONLY') parts.push('fuel');
  const s = parts.join(' + ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

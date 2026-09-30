/**
 * What-if helpers — re-run the strategy with one entered assumption changed.
 * Nothing here is invented: every row is the same calculation with the
 * named input scaled, so the strategist sees how sensitive the plan is.
 */
import { netEnergyPerLap } from './model';
import { withTirePattern } from './planner';
import { calculateStrategy, type SimOptions, type StrategyResult } from './simulate';
import type { CarSetup, Driver, RaceParams, StrategyPlan } from './types';

export interface WhatIfRow {
  key: string;
  label: string;
  input: number;
  result: StrategyResult;
}

// the base is the entered value pre-race and the measured rate in a live projection
const pctLabel = (pct: number, measured: boolean) => (pct === 0 ? (measured ? 'As measured' : 'As entered') : `${pct > 0 ? '+' : ''}${pct}%`);

/**
 * Scale fuel per lap by each percentage (e.g. [-2, 0, 2, 5]). Scaling goes
 * through the simulation base rate, so per-driver consumption scales too.
 */
export function fuelSensitivity(race: RaceParams, setup: CarSetup, plan: StrategyPlan, drivers: Driver[], pcts: number[], sim?: SimOptions): WhatIfRow[] {
  const base = sim?.fuelPerLapL ?? setup.fuelPerLapL;
  return pcts.map((pct) => {
    const fpl = base * (1 + pct / 100);
    return { key: `fuel${pct}`, label: pctLabel(pct, sim?.fuelPerLapL != null), input: fpl, result: calculateStrategy(race, setup, plan, drivers, { ...sim, fuelPerLapL: fpl }) };
  });
}

/** Scale net energy per lap by each percentage. */
export function energySensitivity(race: RaceParams, setup: CarSetup, plan: StrategyPlan, drivers: Driver[], pcts: number[], sim?: SimOptions): WhatIfRow[] {
  const base = sim?.energyPerLapPct ?? netEnergyPerLap(setup);
  return pcts.map((pct) => {
    const epl = base * (1 + pct / 100);
    return { key: `energy${pct}`, label: pctLabel(pct, sim?.energyPerLapPct != null), input: epl, result: calculateStrategy(race, setup, plan, drivers, { ...sim, energyPerLapPct: epl }) };
  });
}

export interface TireOption {
  key: string;
  label: string;
  description: string;
  every: number | null; // null = the plan as entered
  plan: StrategyPlan;
  result: StrategyResult;
}

/** Option A = plan as entered; B/C/D = same stints with tires every / every 2nd / every 3rd stop. */
export function tireOptions(race: RaceParams, setup: CarSetup, plan: StrategyPlan, drivers: Driver[], sim?: SimOptions): TireOption[] {
  const variants: { every: number | null; description: string }[] = [
    { every: null, description: 'Plan as entered' },
    { every: 1, description: 'New tires at every stop' },
    { every: 2, description: 'Tires double-stinted' },
    { every: 3, description: 'Tires triple-stinted' },
  ];
  return variants.map((v, i) => {
    const p = v.every == null ? plan : withTirePattern(plan, v.every);
    return { key: `opt${i}`, label: `Option ${String.fromCharCode(65 + i)}`, description: v.description, every: v.every, plan: p, result: calculateStrategy(race, setup, p, drivers, sim) };
  });
}

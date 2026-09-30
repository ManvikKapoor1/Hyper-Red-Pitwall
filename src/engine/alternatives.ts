/**
 * Strategy alternatives & comparison. Never ranks a strategy as "best" — the
 * output is neutral, descriptive tags and the calculated consequences.
 */
import { buildPlan, clonePlan } from './planner';
import { calculateStrategy, type SimOptions, type StrategyResult } from './simulate';
import type { CarEntry, RaceParams, StrategyPlan } from './types';

export type StrategyTag =
  | 'CURRENT'
  | 'ALTERNATIVE'
  | 'LOWER PIT LOSS'
  | 'LOWER TIRE AGE'
  | 'HIGHER FUEL MARGIN'
  | 'HIGHER STRATEGY RISK'
  | 'FLEXIBLE';

export interface StrategyOption {
  id: string;
  name: string;
  description: string;
  plan: StrategyPlan;
  assumptions: string[];
  current: boolean;
  pitNow?: boolean;
  simOverrides?: Record<number, number>;
}

export interface StrategyMetrics {
  option: StrategyOption;
  result: StrategyResult;
  totalLaps: number;
  finishSec: number;
  deltaSameDistanceSec: number; // vs current, over the current plan's distance
  stops: number;
  pitLossSec: number;
  minFuelMarginLaps: number;
  maxTireAge: number;
  tireSets: number;
  avgPaceMs: number;
  windowWidth: number;
  risks: string[];
  tags: StrategyTag[];
}

function tireEveryOf(plan: StrategyPlan): number {
  const stops = plan.stints.slice(0, -1);
  const changes = stops.filter((s) => s.stop.changeTires).length;
  if (!changes) return 0;
  return Math.max(1, Math.round(stops.length / changes));
}

function driverOrder(plan: StrategyPlan, fallback: string[]): string[] {
  const seen: string[] = [];
  for (const s of plan.stints) if (s.driverId && !seen.includes(s.driverId)) seen.push(s.driverId);
  return seen.length ? seen : fallback;
}

export interface AltContext {
  race: RaceParams;
  car: CarEntry;
  sim?: SimOptions; // live: from current state
  keepFirst?: number; // live: stints already fixed (current stint included)
}

/** Generates neutral alternatives around the current plan. */
export function generateAlternatives(ctx: AltContext): StrategyOption[] {
  const { race, car } = ctx;
  const { setup, drivers, plan } = car;
  const order = driverOrder(plan, drivers.map((d) => d.id));
  const keep = ctx.keepFirst ?? 0;
  // stops param for buildPlan: pre-race = total stops; live = stints after the current one
  const stopsAfterKeep = keep ? plan.stints.length - keep : plan.stints.length - 1;
  const compound = plan.stints[Math.max(0, keep - 1)]?.stop.compound ?? plan.startCompound;
  const common = { race, setup, drivers, compound, order };
  const label = (n: number) => `${n + (keep ? keep - 1 : 0)} STOPS`;
  const mk = (id: string, name: string, description: string, assumptions: string[], o: { stops: number; tireEvery: number; mode?: 'normal' | 'fuelSave'; distribution?: 'even' | 'maxFirst' }): StrategyOption => ({
    id,
    name,
    description,
    assumptions,
    current: false,
    plan: buildPlan(common.race, common.setup, common.drivers, {
      stops: Math.max(0, o.stops),
      tireEvery: o.tireEvery,
      compound: common.compound,
      driverOrder: common.order,
      mode: o.mode,
      base: plan,
      keepFirst: keep,
      name,
      distribution: o.distribution,
      sim: ctx.sim,
    }),
  });

  const every = tireEveryOf(plan);
  const opts: StrategyOption[] = [
    { id: 'current', name: `CURRENT — ${plan.stints.length - 1} STOPS`, description: plan.name, plan: clonePlan(plan), assumptions: ['As planned'], current: true },
  ];
  const s = stopsAfterKeep;
  const sameCountPossible = !keep || s > 0;
  if (sameCountPossible && every !== 1)
    opts.push(mk('tires-every', `${label(s)} + NEW TIRES EVERY STOP`, 'Same stop count, fresh tires at every stop', [`Tire change ${setup.tireChangeSec}s per stop (entered)`], { stops: s, tireEvery: 1 }));
  if (sameCountPossible && every !== 2)
    opts.push(mk('double', `${label(s)} + DOUBLE-STINT TIRES`, 'Same stop count, tires changed every second stop', ['Tires run two stints'], { stops: s, tireEvery: 2 }));
  opts.push(mk('plus-one', `${label(s + 1)} + NEW TIRES`, 'One extra stop, shorter stints, fresh tires every stop', ['Extra stop pit loss', 'Lower fuel load per stint'], { stops: s + 1, tireEvery: 1 }));
  if (s >= (keep ? 2 : 1)) {
    opts.push(mk('minus-one', `${label(s - 1)} + EXTENDED STINTS`, 'One fewer stop — stints stretched to the safe limit', ['Stints at maximum safe length', 'Relies on fuel/energy estimates'], { stops: s - 1, tireEvery: every || 2, distribution: 'maxFirst' }));
    opts.push(mk('minus-one-save', `${label(s - 1)} + FUEL SAVE`, 'One fewer stop using the user-defined fuel-save mode', [`Fuel save: ${setup.modes.fuelSave.fuelPct}% fuel, +${setup.modes.fuelSave.lapSec}s/lap (entered)`], { stops: s - 1, tireEvery: every || 2, mode: 'fuelSave' }));
  }
  if (sameCountPossible)
    opts.push(mk('triple', `${label(s)} + EXTEND TIRES`, 'Tires run three stints to cut stationary time', ['Tires beyond target life — check degradation inputs'], { stops: s, tireEvery: 3 }));
  return opts;
}

/** Variant that pits on the current lap (live: safety-car / slow-zone opportunity). */
export function pitNowOption(ctx: AltContext & { currentLap: number; stintIndex: number }): StrategyOption {
  const { car } = ctx;
  const order = driverOrder(car.plan, car.drivers.map((d) => d.id));
  const remainingStints = car.plan.stints.length - 1 - ctx.stintIndex;
  const every = tireEveryOf(car.plan);
  const overrides = { ...(ctx.sim?.pitLapOverrides ?? {}), [ctx.stintIndex]: ctx.currentLap };
  const plan = buildPlan(ctx.race, car.setup, car.drivers, {
    stops: Math.max(1, remainingStints),
    tireEvery: every,
    compound: car.plan.stints[ctx.stintIndex]?.stop.compound ?? car.plan.startCompound,
    driverOrder: order,
    base: car.plan,
    keepFirst: ctx.stintIndex + 1,
    name: 'Pit now',
    sim: { ...ctx.sim, pitLapOverrides: overrides },
  });
  return {
    id: 'pit-now',
    name: `BOX LAP ${ctx.currentLap} — SAME STOP COUNT`,
    description: 'Take the stop now, re-balance remaining stints',
    plan,
    assumptions: ['Event pit loss as entered', 'Remaining stints re-balanced'],
    current: false,
    pitNow: true,
    simOverrides: overrides,
  };
}

/** Runs and compares options, returning metrics + neutral tags. */
export function compareStrategies(race: RaceParams, car: CarEntry, options: StrategyOption[], sim?: SimOptions): StrategyMetrics[] {
  const rows = options.map((option) => {
    const opts: SimOptions = { ...sim, pitLapOverrides: option.simOverrides ?? sim?.pitLapOverrides };
    const result = calculateStrategy(race, car.setup, option.plan, car.drivers, opts);
    return { option, result, opts };
  });
  const base = rows.find((r) => r.option.current) ?? rows[0];
  const dist = base.result.totalLaps;
  const metrics: StrategyMetrics[] = rows.map(({ option, result, opts }) => {
    const same = option.current ? result : calculateStrategy(race, car.setup, option.plan, car.drivers, { ...opts, lapsLimit: dist });
    const baseSame = race.lengthMode === 'laps' ? base.result : calculateStrategy(race, car.setup, base.option.plan, car.drivers, { ...base.opts, lapsLimit: dist });
    const nonFinal = result.stints.filter((s) => !s.final);
    const windowWidth = nonFinal.length ? nonFinal.reduce((a, s) => a + Math.max(0, s.window.latest - s.window.earliest), 0) / nonFinal.length : 0;
    const risks: string[] = [];
    result.issues.filter((i) => i.severity !== 'info').forEach((i) => risks.push(i.message));
    if (result.minFuelMarginLaps < 0.5 && result.minFuelMarginLaps >= 0) risks.push(`Fuel margin ${result.minFuelMarginLaps.toFixed(1)} laps`);
    return {
      option,
      result,
      totalLaps: result.totalLaps,
      finishSec: result.finishSec,
      deltaSameDistanceSec: same.finishSec - baseSame.finishSec,
      stops: result.stops.length,
      pitLossSec: result.totalPitLossSec,
      minFuelMarginLaps: result.minFuelMarginLaps,
      maxTireAge: result.maxTireAge,
      tireSets: result.tireSets,
      avgPaceMs: result.avgGreenLapMs,
      windowWidth,
      risks,
      tags: [],
    };
  });
  // neutral descriptive tags
  const pick = (fn: (m: StrategyMetrics) => number, dir: 'min' | 'max') => {
    const vals = metrics.map(fn).filter((v) => isFinite(v));
    if (!vals.length) return new Set<StrategyMetrics>();
    const target = dir === 'min' ? Math.min(...vals) : Math.max(...vals);
    const unique = metrics.filter((m) => Math.abs(fn(m) - target) < 1e-6);
    return new Set(unique.length === metrics.length ? [] : unique);
  };
  const lowPit = pick((m) => m.pitLossSec, 'min');
  const lowTire = pick((m) => m.maxTireAge, 'min');
  const hiFuel = pick((m) => m.minFuelMarginLaps, 'max');
  const flex = pick((m) => m.windowWidth, 'max');
  for (const m of metrics) {
    m.tags.push(m.option.current ? 'CURRENT' : 'ALTERNATIVE');
    if (lowPit.has(m)) m.tags.push('LOWER PIT LOSS');
    if (lowTire.has(m)) m.tags.push('LOWER TIRE AGE');
    if (hiFuel.has(m)) m.tags.push('HIGHER FUEL MARGIN');
    if (flex.has(m)) m.tags.push('FLEXIBLE');
    if (!m.result.feasible || m.risks.length > 0) m.tags.push('HIGHER STRATEGY RISK');
  }
  return metrics;
}

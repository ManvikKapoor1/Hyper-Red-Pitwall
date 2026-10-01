/**
 * Plan construction & editing helpers (pure functions → new plan objects).
 */
import { calculateEnergyPerLap, calculateFuelPerLap, driverFuelFactor, getCompound, netEnergyPerLap } from './model';
import { calculateRequiredStops, calculateStintLength, calculateStrategy, type SimOptions } from './simulate';
import type {
  CarSetup,
  Compound,
  Driver,
  DriveMode,
  PitStopConfig,
  PitTemplate,
  RaceParams,
  RefillAmount,
  StintPlan,
  StrategyPlan,
} from './types';

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

export function defaultStop(compound: Compound, changeTires = false): PitStopConfig {
  return { template: 'FUEL_ONLY', fuel: 'auto', energy: 'full', changeTires, compound, extraSec: 0, reason: '' };
}

export function makeStint(driverId: string, laps: number, compound: Compound, changeTires = false, mode: DriveMode = 'normal'): StintPlan {
  return { id: uid('st'), driverId, targetLaps: laps, mode, stop: defaultStop(compound, changeTires) };
}

export function clonePlan(plan: StrategyPlan): StrategyPlan {
  return JSON.parse(JSON.stringify(plan)) as StrategyPlan;
}

/** Rename a compound everywhere the plan references it. */
export function renameCompoundInPlan(plan: StrategyPlan, from: Compound, to: Compound): StrategyPlan {
  return {
    ...plan,
    startCompound: plan.startCompound === from ? to : plan.startCompound,
    stints: plan.stints.map((s) => (s.stop.compound === from ? { ...s, stop: { ...s.stop, compound: to } } : s)),
  };
}

/** True when the plan uses the compound (start set or any stop). */
export function planUsesCompound(plan: StrategyPlan, name: Compound): boolean {
  return plan.startCompound === name || plan.stints.some((s) => s.stop.changeTires && s.stop.compound === name);
}

export function addStint(plan: StrategyPlan, afterIndex = plan.stints.length - 1): StrategyPlan {
  const p = clonePlan(plan);
  const ref = p.stints[Math.max(0, Math.min(afterIndex, p.stints.length - 1))];
  const s = ref
    ? { ...clonePlan({ ...p, stints: [ref] }).stints[0], id: uid('st') }
    : makeStint('', 25, p.startCompound);
  p.stints.splice(afterIndex + 1, 0, s);
  return p;
}

export function deleteStint(plan: StrategyPlan, index: number): StrategyPlan {
  if (plan.stints.length <= 1) return plan;
  const p = clonePlan(plan);
  p.stints.splice(index, 1);
  return p;
}

export function duplicateStint(plan: StrategyPlan, index: number): StrategyPlan {
  const p = clonePlan(plan);
  const copy = { ...clonePlan({ ...p, stints: [p.stints[index]] }).stints[0], id: uid('st') };
  p.stints.splice(index + 1, 0, copy);
  return p;
}

export function moveStint(plan: StrategyPlan, from: number, to: number): StrategyPlan {
  if (from === to || to < 0 || to >= plan.stints.length) return plan;
  const p = clonePlan(plan);
  const [s] = p.stints.splice(from, 1);
  p.stints.splice(to, 0, s);
  return p;
}

export function updateStint(plan: StrategyPlan, index: number, patch: Partial<StintPlan>): StrategyPlan {
  const p = clonePlan(plan);
  p.stints[index] = { ...p.stints[index], ...patch };
  return p;
}

export function updateStop(plan: StrategyPlan, index: number, patch: Partial<PitStopConfig>): StrategyPlan {
  const p = clonePlan(plan);
  p.stints[index] = { ...p.stints[index], stop: { ...p.stints[index].stop, ...patch } };
  return p;
}

/** Apply a pit-stop template to the stop at the end of stint `index`. */
export function applyTemplate(plan: StrategyPlan, index: number, template: PitTemplate, drivers: Driver[]): StrategyPlan {
  let p = clonePlan(plan);
  const s = p.stints[index];
  const next = p.stints[index + 1];
  if (!s || !next) return p;
  const wantsTires = template === 'FUEL_TIRES' || template === 'FUEL_TIRES_DRIVER';
  const wantsDriver = template === 'FUEL_DRIVER' || template === 'FUEL_TIRES_DRIVER' || template === 'DRIVER_ONLY';
  const noFuel = template === 'DRIVER_ONLY';
  if (template === 'EMERGENCY' || template === 'CUSTOM') {
    s.stop = { ...s.stop, template, extraSec: template === 'EMERGENCY' && !s.stop.extraSec ? 10 : s.stop.extraSec };
    return p;
  }
  s.stop = { ...s.stop, template, changeTires: wantsTires, fuel: noFuel ? 0 : s.stop.fuel === 0 ? 'auto' : s.stop.fuel };
  if (wantsDriver && next.driverId === s.driverId && drivers.length > 1) {
    const i = drivers.findIndex((d) => d.id === s.driverId);
    next.driverId = drivers[(i + 1) % drivers.length].id;
  } else if (!wantsDriver && next.driverId !== s.driverId) {
    next.driverId = s.driverId;
  }
  p = { ...p };
  return p;
}

export type Distribution = 'even' | 'maxFirst';

export interface BuildOptions {
  stops?: number; // stops after the kept stints
  tireEvery: number; // change tires every N stops (1 = every stop, 2 = double stint, 0 = never)
  compound?: Compound;
  driverOrder: string[];
  driverBlock?: number; // consecutive stints per driver
  mode?: DriveMode;
  keepFirst?: number; // keep the first k stints from `base`
  base?: StrategyPlan;
  name?: string;
  distribution?: Distribution;
  sim?: SimOptions; // live: project from the current state
}

function startLapOf(res: ReturnType<typeof calculateStrategy>, plan: StrategyPlan, index: number): number {
  const prev = res.stints.find((s) => s.index === index - 1);
  if (prev) return prev.endLap + 1;
  const first = res.stints[0];
  if (first && first.index === index) return first.startLap;
  return plan.stints.slice(0, index).reduce((a, s) => a + s.targetLaps, 0) + 1;
}

/** Faults that mean a stint is longer than the car, tires or driver allow. */
const CAPACITY_FAULTS = new Set(['FUEL_OUT', 'ENERGY_OUT', 'STINT_BEYOND_SAFE', 'DRIVER_MAX', 'TIRE_OVER_MAX', 'TANK_TOO_SMALL']);

/**
 * Build a plan with generated stints after the kept ones. Lap counts come from
 * the simulation so the plan reflects the entered pace & pit losses. Without
 * an explicit stop count the builder starts from the minimum and adds stops
 * until every stint fits its fuel, energy, tire and driver limits.
 */
export function buildPlan(race: RaceParams, setup: CarSetup, drivers: Driver[], o: BuildOptions): StrategyPlan {
  const compound = o.compound ?? setup.compounds[1]?.name ?? setup.compounds[0]?.name ?? 'MEDIUM';
  const keep = o.base && o.keepFirst ? clonePlan(o.base).stints.slice(0, o.keepFirst) : [];
  const basePlan: StrategyPlan = o.base
    ? { ...clonePlan(o.base), id: uid('pl'), name: o.name ?? o.base.name }
    : { id: uid('pl'), name: o.name ?? 'Strategy', startCompound: compound, startTireAge: 0, startFuel: 'full', startEnergyPct: 100, stints: [] };

  const probePlan = { ...basePlan, stints: [...keep, makeStint(o.driverOrder[0] ?? '', 9999, compound)] };
  const probe = calculateStrategy(race, setup, probePlan, drivers, o.sim);
  const startLap = startLapOf(probe, probePlan, keep.length);
  const remaining = Math.max(1, probe.totalLaps - startLap + 1);
  const full = calculateStintLength(setup, o.sim?.fuelPerLapL, o.sim?.energyPerLapPct);
  const block = Math.max(1, o.driverBlock ?? 1);
  const lastKeptDriver = keep[keep.length - 1]?.driverId;
  const orderStart = lastKeptDriver ? Math.max(0, o.driverOrder.indexOf(lastKeptDriver)) : 0;

  const make = (stopsNew: number): StrategyPlan => {
    const n = Math.max(1, keep.length ? stopsNew : stopsNew + 1);
    const mk = (idx: number): StintPlan => {
      const slot = keep.length ? idx + 1 : idx; // continue the rotation after the kept stint
      const di = (orderStart + Math.floor(slot / block)) % Math.max(1, o.driverOrder.length);
      const stopNo = keep.length + idx + 1; // 1-based stop index at end of this stint
      const change = o.tireEvery > 0 && stopNo % o.tireEvery === 0;
      return makeStint(o.driverOrder[di] ?? '', Math.ceil(remaining / n), compound, change, o.mode ?? 'normal');
    };
    const kept = keep.map((k) => ({ ...k, stop: { ...k.stop } }));
    if (kept.length && o.tireEvery > 0) {
      const k = kept[kept.length - 1];
      k.stop = { ...k.stop, changeTires: kept.length % o.tireEvery === 0, compound };
    }
    let plan: StrategyPlan = { ...basePlan, stints: [...kept, ...Array.from({ length: n }, (_, i) => mk(i))] };
    plan = autoBalance(race, setup, drivers, plan, keep.length, { distribution: o.distribution ?? 'even', sim: o.sim });
    plan.stints.forEach((s, i) => {
      const next = plan.stints[i + 1];
      if (!next || i < keep.length - 1) return;
      if (s.stop.template !== 'EMERGENCY' && s.stop.template !== 'CUSTOM') s.stop.template = templateFor(s.stop.changeTires, next.driverId !== s.driverId);
    });
    return plan;
  };

  if (o.stops != null) return make(o.stops);
  let stops = calculateRequiredStops(remaining, full.overall);
  let plan = make(stops);
  for (let i = 0; i < 16; i++) {
    const res = calculateStrategy(race, setup, plan, drivers, o.sim);
    const faults = res.issues.some((x) => CAPACITY_FAULTS.has(x.code) && (x.stint == null || x.stint >= keep.length));
    if (!faults) break;
    // not enough room in the stints → jump by the missing laps; otherwise one more stop
    const caps = stintCaps(setup, plan, drivers, o.sim).slice(keep.length);
    const room = caps.reduce((a, c) => a + c, 0);
    const avg = room / Math.max(1, caps.length);
    const lapsLeft = res.totalLaps - startLap + 1;
    stops += room < lapsLeft ? Math.max(1, Math.ceil((lapsLeft - room) / Math.max(1, avg))) : 1;
    plan = make(stops);
  }
  return plan;
}

/** Template implied by the work done at a stop that takes fuel. */
export function templateFor(tires: boolean, driverChange: boolean): PitTemplate {
  return tires ? (driverChange ? 'FUEL_TIRES_DRIVER' : 'FUEL_TIRES') : driverChange ? 'FUEL_DRIVER' : 'FUEL_ONLY';
}

/**
 * Re-pattern tire changes without touching stint lengths or drivers.
 * every = 1 → every stop, 2 → double stints, 3 → triple stints, 0 → never.
 */
export function withTirePattern(plan: StrategyPlan, every: number): StrategyPlan {
  const p = clonePlan(plan);
  p.stints.forEach((s, i) => {
    const next = p.stints[i + 1];
    if (!next) return;
    const change = every > 0 && (i + 1) % every === 0;
    s.stop = { ...s.stop, changeTires: change };
    if (s.stop.template !== 'EMERGENCY' && s.stop.template !== 'CUSTOM' && s.stop.template !== 'DRIVER_ONLY') s.stop.template = templateFor(change, next.driverId !== s.driverId);
  });
  return p;
}

/**
 * Laps each stint can run between services: fuel and energy from a full
 * service (keeping the planning reserve / safety margin at the stop), the
 * driver's maximum stint, and the tire set's life shared by the stints that
 * run on it. Uses the stint's own driver factor, drive mode and overrides.
 */
export function stintCaps(setup: CarSetup, plan: StrategyPlan, drivers: Driver[], sim?: SimOptions): number[] {
  const dmap = new Map(drivers.map((d) => [d.id, d]));
  const baseFuel = sim?.fuelPerLapL ?? setup.fuelPerLapL;
  const baseEnergy = sim?.energyPerLapPct ?? netEnergyPerLap(setup);
  const keepLaps = Math.max(setup.fuelReserveLaps, setup.fuelSafetyMarginLaps);
  const fill = (req: RefillAmount, capacity: number, keep: number) => (typeof req === 'number' ? Math.min(capacity, req + keep) : capacity);
  const caps = plan.stints.map((s, i) => {
    const d = dmap.get(s.driverId);
    const fpl = s.fuelPerLapOverrideL ?? calculateFuelPerLap(baseFuel, setup, s.mode, undefined, driverFuelFactor(setup, d));
    const epl = calculateEnergyPerLap(baseEnergy, setup, s.mode);
    const prev = plan.stints[i - 1];
    const fuelStart = i === 0 ? fill(plan.startFuel === 'auto' ? 'full' : plan.startFuel, setup.fuelCapacityL, 0) : fill(prev.stop.fuel, setup.fuelCapacityL, keepLaps * fpl);
    const energyStart = i === 0 ? Math.min(setup.energyCapacityPct, plan.startEnergyPct) : fill(prev.stop.energy, setup.energyCapacityPct, setup.energyReservePct);
    const fuel = fpl > 0 ? Math.floor((fuelStart - keepLaps * fpl) / fpl + 1e-9) : Infinity;
    const energy = setup.energyEnabled && epl > 0 ? Math.floor((energyStart - setup.energyReservePct) / epl + 1e-9) : Infinity;
    return Math.max(1, Math.min(fuel, energy, d?.maxStintLaps ?? Infinity));
  });
  // tire sets: stints between tire changes share one set's life
  const init = sim?.initial;
  let groupStart = 0;
  for (let i = 0; i <= plan.stints.length; i++) {
    const ends = i === plan.stints.length || (i > 0 && plan.stints[i - 1].stop.changeTires);
    if (!ends || i === groupStart) continue;
    if (init && groupStart <= init.stintIndex && init.stintIndex < i) {
      // live: the set on the car is already worn and the current stint still uses part of it
      const cur = init.stintIndex;
      const plannedEnd = sim?.pitLapOverrides?.[cur] ?? init.stintStartLap + plan.stints[cur].targetLaps - 1;
      const stillToRun = Math.max(0, plannedEnd - init.lap + 1);
      const life = getCompound(setup, init.compound).maxLife - init.tireAge - stillToRun;
      const size = i - (cur + 1);
      for (let k = cur + 1; k < i; k++) caps[k] = Math.max(1, Math.min(caps[k], Math.floor(life / size)));
    } else {
      const compound = groupStart === 0 ? plan.startCompound : plan.stints[groupStart - 1].stop.compound;
      const life = getCompound(setup, compound).maxLife - (groupStart === 0 ? plan.startTireAge : 0);
      const size = i - groupStart;
      for (let k = groupStart; k < i; k++) caps[k] = Math.max(1, Math.min(caps[k], Math.floor(life / size)));
    }
    groupStart = i;
  }
  return caps;
}

/** Split `total` laps over stints, each at most its cap (even: as level as possible). */
function distribute(total: number, caps: number[], distribution: Distribution): number[] {
  const n = caps.length;
  if (!n) return [];
  if (distribution === 'maxFirst') {
    let left = total;
    return caps.map((cap, i) => {
      const isLast = i === n - 1;
      const laps = isLast ? Math.max(1, left) : Math.max(1, Math.min(cap, left - (n - 1 - i)));
      left -= laps;
      return laps;
    });
  }
  // water-filling: raise a common level until the stints hold `total` laps
  const room = caps.reduce((a, c) => a + c, 0);
  if (room <= total) {
    const out = [...caps];
    out[n - 1] += total - room; // not enough room: the last stint takes the rest (the check flags it)
    return out;
  }
  let lo = 0;
  let hi = Math.max(...caps);
  while (hi - lo > 1e-6) {
    const mid = (lo + hi) / 2;
    if (caps.reduce((a, c) => a + Math.min(c, mid), 0) >= total) hi = mid;
    else lo = mid;
  }
  const out = caps.map((c) => Math.min(c, Math.floor(hi)));
  let extra = total - out.reduce((a, b) => a + b, 0);
  for (let i = 0; extra > 0 && i < n * 2; i++) {
    const k = i % n;
    if (out[k] < caps[k]) {
      out[k]++;
      extra--;
    }
  }
  return out.map((v) => Math.max(1, v));
}

/**
 * Distribute the remaining race laps across stints from `fromIndex`.
 *  even     → stints as equal as their limits allow
 *  maxFirst → every stint at its limit, final stint takes the remainder
 * Earlier stints are left untouched.
 */
export function autoBalance(
  race: RaceParams,
  setup: CarSetup,
  drivers: Driver[],
  plan: StrategyPlan,
  fromIndex = 0,
  opts: { distribution?: Distribution; sim?: SimOptions } = {},
): StrategyPlan {
  let p = clonePlan(plan);
  if (!p.stints.length || fromIndex >= p.stints.length) return p;
  for (let iter = 0; iter < 6; iter++) {
    const res = calculateStrategy(race, setup, p, drivers, opts.sim);
    const startLap = startLapOf(res, p, fromIndex);
    const n = p.stints.length - fromIndex;
    const remaining = Math.max(n, res.totalLaps - startLap + 1);
    const caps = stintCaps(setup, p, drivers, opts.sim).slice(fromIndex);
    const laps = distribute(remaining, caps, opts.distribution ?? 'even');
    const next = clonePlan(p);
    laps.forEach((l, k) => (next.stints[fromIndex + k].targetLaps = l));
    const same = next.stints.every((s, i) => s.targetLaps === p.stints[i].targetLaps);
    p = next;
    if (same) break;
  }
  return p;
}

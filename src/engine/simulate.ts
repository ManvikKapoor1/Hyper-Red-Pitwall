/**
 * Strategy simulation — lap-by-lap projection of a StrategyPlan.
 *
 * The same engine powers pre-race planning (from the grid) and live
 * re-projection (from the current lap with measured rates).
 */
import {
  activeEventAt,
  calculateEnergyPerLap,
  calculateFuelPerLap,
  calculatePitLoss,
  deriveTemplate,
  describeStopReason,
  driverFuelFactor,
  getCompound,
  netEnergyPerLap,
  predictLapMs,
} from './model';
import type {
  CarSetup,
  Compound,
  Driver,
  DriveMode,
  ID,
  PitTemplate,
  RaceParams,
  RefillAmount,
  ScenarioEvent,
  ScenarioType,
  StrategyPlan,
} from './types';

export interface SimInitial {
  lap: number; // lap about to be driven (1-based)
  timeSec: number; // race time at the start of that lap
  stintIndex: number;
  stintStartLap: number;
  fuelL: number;
  energyPct: number;
  compound: Compound;
  tireAge: number;
  driverId?: ID;
  mode?: DriveMode;
}

export interface SimOptions {
  initial?: SimInitial;
  /** Measured base rates (normal mode, current driver neutralised). */
  fuelPerLapL?: number;
  energyPerLapPct?: number;
  paceBiasMs?: number;
  events?: ScenarioEvent[];
  /** Force a distance-limited race of N laps (used for like-for-like comparisons). */
  lapsLimit?: number;
  pitLapOverrides?: Record<number, number>;
  earlyThresholdLaps?: number;
}

export type Limiter = 'FUEL' | 'ENERGY' | 'TIRES' | 'DRIVER' | 'NONE';
export type PitFlag = 'EARLY' | 'OPTIMAL' | 'LATE' | 'FINAL';

export interface SimLap {
  lap: number;
  stint: number;
  driverId: ID;
  startSec: number;
  endSec: number;
  lapMs: number;
  fuelUsedL: number;
  fuelAfterL: number;
  energyUsedPct: number;
  energyAfterPct: number;
  tireAge: number; // age after this lap
  compound: Compound;
  pitIn: boolean;
  event?: ScenarioType;
}

export interface SimStint {
  index: number;
  driverId: ID;
  mode: DriveMode;
  startLap: number;
  endLap: number;
  laps: number;
  plannedLaps: number;
  fromLap: number; // first simulated lap (≠ startLap when projecting mid-stint)
  startSec: number;
  endSec: number;
  fuelStartL: number;
  fuelAddedL: number;
  fuelEndL: number;
  fuelUsedL: number;
  fuelPerLapL: number;
  energyStartPct: number;
  energyAddedPct: number;
  energyEndPct: number;
  energyUsedPct: number;
  energyPerLapPct: number;
  energyTargetPct?: number;
  compound: Compound;
  tireAgeStart: number;
  tireAgeEnd: number;
  newTires: boolean;
  avgLapMs: number;
  maxLaps: { fuel: number; energy: number; tire: number; driver: number; overall: number };
  limiter: Limiter;
  fuelMarginLaps: number;
  energyMarginLaps: number;
  window: { earliest: number; latest: number; target: number };
  flag: PitFlag;
  final: boolean;
  overridden: boolean;
}

export interface SimStop {
  index: number; // 0-based stop number
  afterStint: number;
  lap: number; // in-lap
  entrySec: number;
  exitSec: number;
  fuelAddedL: number;
  energyAddedPct: number;
  changeTires: boolean;
  compound: Compound;
  driverChange: boolean;
  fromDriverId: ID;
  toDriverId: ID;
  fuelSec: number;
  tireSec: number;
  driverSec: number;
  extraSec: number;
  stationarySec: number;
  laneSec: number;
  totalLossSec: number;
  template: PitTemplate;
  reason: string;
  underEvent?: ScenarioType;
}

export type IssueSeverity = 'critical' | 'warning' | 'info';
export interface SimIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  stint?: number;
  lap?: number;
}

export interface StrategyResult {
  totalLaps: number;
  finishSec: number;
  startLap: number;
  startSec: number;
  stints: SimStint[];
  stops: SimStop[];
  laps: SimLap[];
  totalPitLossSec: number;
  fuelUsedL: number;
  fuelAddedL: number;
  energyUsedPct: number;
  tireSets: number;
  driverTimeSec: Record<ID, number>;
  avgGreenLapMs: number;
  minFuelMarginLaps: number;
  minEnergyMarginLaps: number;
  maxTireAge: number;
  issues: SimIssue[];
  feasible: boolean;
  unusedStints: number;
  fullStintMaxLaps: number;
}

const MAX_LAPS = 4000;

function resolveRefill(req: RefillAmount, needed: number, remaining: number, capacity: number): number {
  const room = Math.max(0, capacity - remaining);
  if (req === 'full') return room;
  if (req === 'auto') return Math.min(room, Math.max(0, needed - remaining));
  return Math.min(room, Math.max(0, req));
}

/** Number of race laps a plan covers (time races: first lap completed after the clock expires). */
export function calculateRaceLaps(race: RaceParams, setup: CarSetup, plan: StrategyPlan, drivers: Driver[]): number {
  return calculateStrategy(race, setup, plan, drivers).totalLaps;
}

/** Simple estimate used before a plan exists: laps ≈ duration / (pace + pit overhead). */
export function estimateRaceLaps(race: RaceParams, setup: CarSetup, avgPitPerLapSec = 0): number {
  if (race.lengthMode === 'laps') return race.laps;
  const lap = setup.racePaceMs / 1000 + avgPitPerLapSec;
  return lap > 0 ? Math.ceil(race.durationSec / lap) : 0;
}

/** Longest safe stint on a full tank / full energy / fresh tires (used for window + stop counts). */
export function calculateStintLength(setup: CarSetup, fuelPerLapL = setup.fuelPerLapL, energyPerLapPct = netEnergyPerLap(setup), compound?: string, driver?: Driver) {
  const fuel = fuelPerLapL > 0 ? Math.floor((setup.fuelCapacityL - setup.fuelSafetyMarginLaps * fuelPerLapL) / fuelPerLapL) : Infinity;
  const energy =
    setup.energyEnabled && energyPerLapPct > 0
      ? Math.floor((setup.energyCapacityPct - setup.energyReservePct) / energyPerLapPct)
      : Infinity;
  const tire = compound ? getCompound(setup, compound).maxLife : Infinity;
  const drv = driver?.maxStintLaps ?? Infinity;
  const overall = Math.max(1, Math.min(fuel, energy, tire, drv));
  return { fuel, energy, tire, driver: drv, overall };
}

/** Minimum stops needed to cover `laps` with a given max stint length. */
export function calculateRequiredStops(laps: number, maxStintLaps: number): number {
  if (maxStintLaps <= 0 || !isFinite(laps)) return 0;
  return Math.max(0, Math.ceil(laps / maxStintLaps) - 1);
}

function simulateOnce(
  race: RaceParams,
  setup: CarSetup,
  plan: StrategyPlan,
  drivers: Driver[],
  opts: SimOptions,
  estTotalLaps: number,
): StrategyResult {
  const driverMap = new Map(drivers.map((d) => [d.id, d]));
  const events = opts.events ?? [];
  const lapsMode = opts.lapsLimit != null || race.lengthMode === 'laps';
  const lapsTarget = opts.lapsLimit ?? race.laps;
  const baseFuel = opts.fuelPerLapL ?? setup.fuelPerLapL;
  const baseEnergy = opts.energyPerLapPct ?? netEnergyPerLap(setup);
  const overrides = opts.pitLapOverrides ?? {};
  const earlyThr = opts.earlyThresholdLaps ?? 3;
  const init = opts.initial;

  const issues: SimIssue[] = [];
  const laps: SimLap[] = [];
  const stints: SimStint[] = [];
  const stops: SimStop[] = [];
  const driverTimeSec: Record<ID, number> = {};

  let lap = init?.lap ?? 1;
  let t = init?.timeSec ?? 0;
  const startLap = lap;
  const startSec = t;
  let fuel =
    init?.fuelL ??
    (plan.startFuel === 'full'
      ? setup.fuelCapacityL
      : plan.startFuel === 'auto'
        ? setup.fuelCapacityL
        : Math.min(setup.fuelCapacityL, plan.startFuel));
  let energy = init?.energyPct ?? (setup.energyEnabled ? Math.min(setup.energyCapacityPct, plan.startEnergyPct) : 0);
  let compound = init?.compound ?? plan.startCompound;
  let tireAge = init?.tireAge ?? plan.startTireAge;
  let finished = false;
  let fuelAddedTotal = 0;
  let tireSets = 1;

  const firstStint = init?.stintIndex ?? 0;
  const lastIdx = plan.stints.length - 1;
  const fullStint = calculateStintLength(setup, baseFuel, baseEnergy);

  // "auto" start fuel: fill for the first stint only
  if (!init && plan.startFuel === 'auto' && plan.stints[0]) {
    const s0 = plan.stints[0];
    const d0 = driverMap.get(s0.driverId);
    const fpl = s0.fuelPerLapOverrideL ?? calculateFuelPerLap(baseFuel, setup, s0.mode, undefined, driverFuelFactor(setup, d0));
    const n = lastIdx === 0 ? estTotalLaps : s0.targetLaps;
    fuel = Math.min(setup.fuelCapacityL, fpl * (n + setup.fuelReserveLaps));
  }

  let prevFuelAdded = 0;
  let prevEnergyAdded = 0;
  let prevNewTires = false;

  for (let si = firstStint; si <= lastIdx && !finished; si++) {
    const sp0 = plan.stints[si];
    // live: the current stint runs in the mode the pitwall has instructed
    const sp = si === firstStint && init?.mode ? { ...sp0, mode: init.mode } : sp0;
    const driver = driverMap.get(sp.driverId);
    const dFactor = driverFuelFactor(setup, driver);
    const isFinalPlanned = si === lastIdx;
    const stintStartLap = si === firstStint && init ? init.stintStartLap : lap;
    const plannedEnd = overrides[si] ?? stintStartLap + sp.targetLaps - 1;
    const overridden = overrides[si] != null;
    let endLap = isFinalPlanned ? Infinity : Math.max(plannedEnd, lap); // never end before the lap being driven
    if (lapsMode) endLap = Math.min(endLap, lapsTarget);

    const cspec = getCompound(setup, compound);
    const nominalFpl = sp.fuelPerLapOverrideL ?? calculateFuelPerLap(baseFuel, setup, sp.mode, undefined, dFactor);
    const nominalEpl = calculateEnergyPerLap(baseEnergy, setup, sp.mode);

    const fuelStart = fuel;
    const energyStart = energy;
    const ageStart = tireAge;
    const fromLap = lap;
    const sStartSec = t;
    let fuelUsed = 0;
    let energyUsed = 0;
    let greenMs = 0;
    let greenN = 0;

    // capacity-based limits from the current state
    const fuelSafe =
      nominalFpl > 0 ? Math.floor((fuelStart - setup.fuelSafetyMarginLaps * nominalFpl) / nominalFpl + 1e-9) : Infinity;
    const energySafe =
      setup.energyEnabled && nominalEpl > 0
        ? Math.floor((energyStart - setup.energyReservePct) / nominalEpl + 1e-9)
        : Infinity;
    const tireLeft = cspec.maxLife - ageStart;
    const driverLeft = (driver?.maxStintLaps ?? Infinity) - (fromLap - stintStartLap);
    const overallLeft = Math.min(fuelSafe, energySafe, tireLeft, driverLeft);
    const limiter: Limiter =
      overallLeft === Infinity
        ? 'NONE'
        : overallLeft === fuelSafe
          ? 'FUEL'
          : overallLeft === energySafe
            ? 'ENERGY'
            : overallLeft === tireLeft
              ? 'TIRES'
              : 'DRIVER';

    while (lap <= endLap && !finished && laps.length < MAX_LAPS) {
      const ev = activeEventAt(events, t);
      const fpl = sp.fuelPerLapOverrideL
        ? sp.fuelPerLapOverrideL * (ev ? 1 - ev.fuelReductionPct / 100 : 1)
        : calculateFuelPerLap(baseFuel, setup, sp.mode, ev, dFactor);
      const epl = calculateEnergyPerLap(baseEnergy, setup, sp.mode, ev);
      const lapMs = predictLapMs({
        setup,
        driver,
        compound: cspec,
        tireAge,
        mode: sp.mode,
        fuelL: fuel,
        event: ev,
        lapOverrideMs: sp.lapTimeOverrideMs,
        paceBiasMs: opts.paceBiasMs,
      });
      if (!ev) {
        greenMs += lapMs;
        greenN++;
      }
      fuel -= fpl;
      energy -= epl;
      fuelUsed += fpl;
      energyUsed += epl;
      tireAge += 1;
      const lapStart = t;
      t += lapMs / 1000;
      driverTimeSec[sp.driverId] = (driverTimeSec[sp.driverId] ?? 0) + lapMs / 1000;

      const raceDone = lapsMode ? lap >= lapsTarget : t >= race.durationSec;
      const pitIn = !raceDone && lap === endLap && !isFinalPlanned;
      laps.push({
        lap,
        stint: si,
        driverId: sp.driverId,
        startSec: lapStart,
        endSec: t,
        lapMs,
        fuelUsedL: fpl,
        fuelAfterL: fuel,
        energyUsedPct: epl,
        energyAfterPct: energy,
        tireAge,
        compound,
        pitIn,
        event: ev?.type,
      });
      if (fuel < 0 && !issues.some((i) => i.code === 'FUEL_OUT' && i.stint === si)) {
        issues.push({
          severity: 'critical',
          code: 'FUEL_OUT',
          message: `Stint ${si + 1}: fuel runs out on lap ${lap}`,
          stint: si,
          lap,
        });
      }
      if (setup.energyEnabled && energy < 0 && !issues.some((i) => i.code === 'ENERGY_OUT' && i.stint === si)) {
        issues.push({
          severity: 'critical',
          code: 'ENERGY_OUT',
          message: `Stint ${si + 1}: virtual energy exhausted on lap ${lap}`,
          stint: si,
          lap,
        });
      }
      if (raceDone) finished = true;
      lap++;
    }

    const stintEndLap = lap - 1;
    const stintLaps = stintEndLap - stintStartLap + 1;
    const simulatedLaps = stintEndLap - fromLap + 1;
    const final = finished || isFinalPlanned;

    // window
    const latest = fromLap + overallLeft - 1;
    const remainingStintsAfter = Math.max(0, lastIdx - si);
    const totalForWindow = lapsMode ? lapsTarget : estTotalLaps;
    const minLaps = driver?.minStintLaps ?? 1;
    let earliest = Math.max(stintStartLap + minLaps - 1, totalForWindow - remainingStintsAfter * fullStint.overall, fromLap);
    earliest = Math.min(earliest, latest);

    let flag: PitFlag = 'OPTIMAL';
    if (final) flag = 'FINAL';
    else if (stintEndLap > latest) flag = 'LATE';
    else if (stintEndLap < latest - earlyThr) flag = 'EARLY';

    const avgFpl = simulatedLaps > 0 ? fuelUsed / simulatedLaps : nominalFpl;
    const avgEpl = simulatedLaps > 0 ? energyUsed / simulatedLaps : nominalEpl;

    const stint: SimStint = {
      index: si,
      driverId: sp.driverId,
      mode: sp.mode,
      startLap: stintStartLap,
      endLap: stintEndLap,
      laps: stintLaps,
      plannedLaps: isFinalPlanned ? stintLaps : plannedEnd - stintStartLap + 1,
      fromLap,
      startSec: sStartSec,
      endSec: t,
      fuelStartL: fuelStart,
      fuelAddedL: si === firstStint ? (init ? 0 : fuelStart) : prevFuelAdded,
      fuelEndL: fuel,
      fuelUsedL: fuelUsed,
      fuelPerLapL: avgFpl,
      energyStartPct: energyStart,
      energyAddedPct: si === firstStint ? 0 : prevEnergyAdded,
      energyEndPct: energy,
      energyUsedPct: energyUsed,
      energyPerLapPct: avgEpl,
      energyTargetPct: sp.energyTargetPct,
      compound,
      tireAgeStart: ageStart,
      tireAgeEnd: tireAge,
      newTires: si === firstStint ? !init && plan.startTireAge === 0 : prevNewTires,
      avgLapMs: greenN > 0 ? greenMs / greenN : 0,
      maxLaps: { fuel: fuelSafe, energy: energySafe, tire: tireLeft, driver: driverLeft, overall: overallLeft },
      limiter,
      fuelMarginLaps: avgFpl > 0 ? fuel / avgFpl : Infinity,
      energyMarginLaps: setup.energyEnabled && avgEpl > 0 ? energy / avgEpl : Infinity,
      window: { earliest, latest, target: stintEndLap },
      flag,
      final,
      overridden,
    };
    stints.push(stint);

    if (tireAge > cspec.maxLife) {
      issues.push({
        severity: 'critical',
        code: 'TIRE_OVER_MAX',
        message: `Stint ${si + 1}: ${compound} reaches ${tireAge} laps (max ${cspec.maxLife})`,
        stint: si,
      });
    } else if (tireAge > cspec.targetLife) {
      issues.push({
        severity: 'warning',
        code: 'TIRE_OVER_TARGET',
        message: `Stint ${si + 1}: ${compound} at ${tireAge} laps exceeds target life ${cspec.targetLife}`,
        stint: si,
      });
    }
    if (driver?.maxStintLaps && stintLaps > driver.maxStintLaps) {
      issues.push({
        severity: 'warning',
        code: 'DRIVER_MAX',
        message: `Stint ${si + 1}: ${driver.name} exceeds max stint (${stintLaps}/${driver.maxStintLaps} laps)`,
        stint: si,
      });
    }
    if (sp.energyTargetPct != null && setup.energyEnabled && energyUsed > sp.energyTargetPct + 0.05) {
      issues.push({
        severity: 'warning',
        code: 'ENERGY_TARGET',
        message: `Stint ${si + 1}: energy use ${energyUsed.toFixed(1)}% exceeds stint target ${sp.energyTargetPct}%`,
        stint: si,
      });
    }
    if (!final && flag === 'LATE' && !issues.some((i) => i.stint === si && (i.code === 'FUEL_OUT' || i.code === 'ENERGY_OUT'))) {
      issues.push({
        severity: 'warning',
        code: 'STINT_BEYOND_SAFE',
        message: `Stint ${si + 1}: planned to lap ${stintEndLap}, safe limit lap ${latest} (${limiter})`,
        stint: si,
      });
    }

    if (finished || si === lastIdx) break;

    // ── pit stop at the end of this stint ───────────────────────────────────
    const next = plan.stints[si + 1];
    const nextDriver = driverMap.get(next.driverId);
    const cfg = sp.stop;
    const nextIsFinal = si + 1 === lastIdx;
    const nextLaps = nextIsFinal
      ? Math.max(1, (lapsMode ? lapsTarget : estTotalLaps) - stintEndLap)
      : Math.max(1, (overrides[si + 1] != null ? overrides[si + 1] - stintEndLap : next.targetLaps));
    const nextFpl =
      next.fuelPerLapOverrideL ??
      calculateFuelPerLap(baseFuel, setup, next.mode, undefined, driverFuelFactor(setup, nextDriver));
    const nextEpl = calculateEnergyPerLap(baseEnergy, setup, next.mode);
    const fuelNeeded = nextFpl * (nextLaps + setup.fuelReserveLaps);
    const energyNeeded = nextEpl * nextLaps + setup.energyReservePct;
    const fuelAdd = resolveRefill(cfg.fuel, fuelNeeded, Math.max(0, fuel), setup.fuelCapacityL);
    const energyAdd = setup.energyEnabled
      ? resolveRefill(cfg.energy, energyNeeded, Math.max(0, energy), setup.energyCapacityPct)
      : 0;
    const driverChange = next.driverId !== sp.driverId;
    const ev = activeEventAt(events, t);
    const laneOverride = ev?.pitOpen && ev.pitLossUnderEventSec != null ? ev.pitLossUnderEventSec : undefined;
    const loss = calculatePitLoss(setup, {
      fuelAddedL: fuelAdd,
      changeTires: cfg.changeTires,
      driverChange,
      extraSec: cfg.extraSec,
      laneSecOverride: laneOverride,
    });
    const template = deriveTemplate(cfg, fuelAdd, driverChange);
    const entrySec = t;
    t += loss.totalSec;
    driverTimeSec[sp.driverId] = (driverTimeSec[sp.driverId] ?? 0) + loss.totalSec;
    // fold the loss into the in-lap so lap records sum to race time
    const inLap = laps[laps.length - 1];
    if (inLap) {
      inLap.lapMs += loss.totalSec * 1000;
      inLap.endSec = t;
    }
    stint.endSec = t;
    stops.push({
      index: stops.length,
      afterStint: si,
      lap: stintEndLap,
      entrySec,
      exitSec: t,
      fuelAddedL: fuelAdd,
      energyAddedPct: energyAdd,
      changeTires: cfg.changeTires,
      compound: cfg.changeTires ? cfg.compound : compound,
      driverChange,
      fromDriverId: sp.driverId,
      toDriverId: next.driverId,
      fuelSec: loss.fuelSec,
      tireSec: loss.tireSec,
      driverSec: loss.driverSec,
      extraSec: loss.extraSec,
      stationarySec: loss.stationarySec,
      laneSec: loss.laneSec,
      totalLossSec: loss.totalSec,
      template,
      reason: describeStopReason(template, cfg.reason, driverChange, cfg.changeTires),
      underEvent: ev?.type,
    });
    if (fuelNeeded - Math.max(0, fuel) > setup.fuelCapacityL + 0.01 && cfg.fuel === 'auto') {
      issues.push({
        severity: 'warning',
        code: 'TANK_TOO_SMALL',
        message: `Stint ${si + 2}: ${nextLaps} laps need ${fuelNeeded.toFixed(1)} L incl. reserve — tank holds ${setup.fuelCapacityL} L`,
        stint: si + 1,
      });
    }
    fuel = Math.max(0, fuel) + fuelAdd;
    energy = Math.max(0, energy) + energyAdd;
    fuelAddedTotal += fuelAdd;
    prevFuelAdded = fuelAdd;
    prevEnergyAdded = energyAdd;
    prevNewTires = cfg.changeTires;
    if (cfg.changeTires) {
      compound = cfg.compound;
      tireAge = 0;
      tireSets++;
    }
  }

  const unusedStints = Math.max(0, lastIdx - (stints[stints.length - 1]?.index ?? lastIdx));
  if (unusedStints > 0) {
    issues.push({
      severity: 'info',
      code: 'UNUSED_STINTS',
      message: `Race finishes before ${unusedStints} planned stint${unusedStints > 1 ? 's' : ''} — remove or shorten`,
    });
  }
  if (!finished && laps.length >= MAX_LAPS) {
    issues.push({ severity: 'critical', code: 'SIM_LIMIT', message: 'Simulation limit reached — check pace inputs' });
  }

  const green = laps.filter((l) => !l.pitIn && !l.event);
  const avgGreenLapMs = green.length ? green.reduce((a, l) => a + l.lapMs, 0) / green.length : 0;
  const totalPitLossSec = stops.reduce((a, s) => a + s.totalLossSec, 0);
  const fuelUsedL = laps.reduce((a, l) => a + l.fuelUsedL, 0);
  const energyUsedPct = laps.reduce((a, l) => a + l.energyUsedPct, 0);
  const minFuelMarginLaps = stints.length ? Math.min(...stints.map((s) => s.fuelMarginLaps)) : Infinity;
  const minEnergyMarginLaps = stints.length ? Math.min(...stints.map((s) => s.energyMarginLaps)) : Infinity;
  const maxTireAge = stints.length ? Math.max(...stints.map((s) => s.tireAgeEnd)) : 0;

  return {
    totalLaps: laps.length ? laps[laps.length - 1].lap : startLap - 1,
    finishSec: t,
    startLap,
    startSec,
    stints,
    stops,
    laps,
    totalPitLossSec,
    fuelUsedL,
    fuelAddedL: fuelAddedTotal,
    energyUsedPct,
    tireSets,
    driverTimeSec,
    avgGreenLapMs,
    minFuelMarginLaps,
    minEnergyMarginLaps,
    maxTireAge,
    issues,
    feasible: !issues.some((i) => i.severity === 'critical'),
    unusedStints,
    fullStintMaxLaps: fullStint.overall,
  };
}

/**
 * Full strategy calculation. Iterates so that "auto" fuel for the final stint
 * and pit windows converge on the projected race distance.
 */
export function calculateStrategy(
  race: RaceParams,
  setup: CarSetup,
  plan: StrategyPlan,
  drivers: Driver[],
  opts: SimOptions = {},
): StrategyResult {
  const lapsMode = opts.lapsLimit != null || race.lengthMode === 'laps';
  let est = lapsMode ? (opts.lapsLimit ?? race.laps) : estimateRaceLaps(race, setup, 0);
  let res = simulateOnce(race, setup, plan, drivers, opts, est);
  if (lapsMode) return res;
  for (let i = 0; i < 3; i++) {
    if (res.totalLaps === est) break;
    est = res.totalLaps;
    res = simulateOnce(race, setup, plan, drivers, opts, est);
  }
  return res;
}

/** Projected finish (race time, seconds) of a plan. */
export function calculateProjectedFinishTime(res: StrategyResult): number {
  return res.finishSec;
}

/** Total time for the stints to cover `laps` (used for fair comparisons). */
export function timeAtLap(res: StrategyResult, lap: number): number | null {
  const l = res.laps.find((x) => x.lap === lap);
  return l ? l.endSec : null;
}

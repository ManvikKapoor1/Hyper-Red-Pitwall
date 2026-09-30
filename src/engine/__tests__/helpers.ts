/**
 * Shared fixtures for the property tests: random races, cars and plans must always produce a
 * self-consistent simulation (conservation of fuel / energy / time,
 * contiguous laps and stints, pit timing that matches the pit model).
 */
import { mulberry32 } from '../demo';
import { generateRaceCalls } from '../calls';
import { projectLive } from '../live';
import { applyQuickUpdate, cloneLive, prepareGrid, recordPitStop, startRaceLive } from '../liveOps';
import { activeEventAt, calculateEnergyPerLap, calculateFuelPerLap, driverFuelFactor, netEnergyPerLap, predictLapMs } from '../model';
import { calculateStrategy } from '../simulate';
import type { CarEntry, Race } from '../types';

import { DEFAULT_SETTINGS, defaultRaceParams, defaultSetup, makeDriver } from '../factory';
import { calculatePitLoss, getCompound } from '../model';
import { buildPlan, withTirePattern } from '../planner';
import type { SimOptions, StrategyResult } from '../simulate';
import type { CarSetup, Driver, RaceParams, ScenarioEvent, StrategyPlan } from '../types';

const EPS = 1e-6;
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

export interface Case {
  race: RaceParams;
  setup: CarSetup;
  drivers: Driver[];
  plan: StrategyPlan;
  opts: SimOptions;
  label: string;
}

export function randomCase(seed: number): Case {
  const r = mulberry32(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const between = (a: number, b: number) => a + r() * (b - a);
  const race: RaceParams = {
    ...defaultRaceParams(),
    lengthMode: r() < 0.25 ? 'laps' : 'time',
    durationSec: Math.round(between(0.5, 24) * 3600),
    laps: Math.round(between(20, 400)),
  };
  const setup: CarSetup = {
    ...defaultSetup(DEFAULT_SETTINGS),
    fuelCapacityL: Math.round(between(40, 120)),
    fuelPerLapL: between(1.2, 7),
    racePaceMs: Math.round(between(75, 230) * 1000),
    fuelEffectSecPerL: r() < 0.3 ? between(0, 0.04) : 0,
    pitLaneLossSec: between(15, 40),
    refuelRateLps: between(1, 4),
    tireChangeSec: between(8, 30),
    driverChangeSec: between(10, 40),
    concurrency: pick(['sequential', 'parallel', 'fuelDriverThenTires'] as const),
    energyEnabled: r() < 0.7,
    energyPerLapPct: between(1.5, 9),
    energyRecoveryPerLapPct: r() < 0.3 ? between(0, 1) : 0,
    fuelReserveLaps: pick([0, 0.5, 1, 2]),
    fuelSafetyMarginLaps: pick([0, 0.3, 0.5, 1]),
    energyReservePct: pick([0, 2, 3, 5]),
  };
  const nd = 1 + Math.floor(r() * 4);
  const drivers = Array.from({ length: nd }, (_, i) =>
    makeDriver(`D${i}`, `D${i}`, i, {
      paceMs: r() < 0.5 ? setup.racePaceMs + Math.round(between(-800, 800)) : undefined,
      fuelPerLapL: r() < 0.5 ? setup.fuelPerLapL * between(0.95, 1.05) : undefined,
      maxStintLaps: r() < 0.3 ? Math.round(between(10, 80)) : undefined,
    }),
  );
  const tireEvery = pick([0, 1, 2, 3]);
  let plan = buildPlan(race, setup, drivers, {
    tireEvery,
    driverOrder: drivers.map((d) => d.id),
    driverBlock: pick([1, 2]),
    compound: pick(setup.compounds.map((c) => c.name)),
    mode: pick(['normal', 'normal', 'fuelSave', 'push'] as const),
    distribution: pick(['even', 'maxFirst'] as const),
  });
  // random human edits
  if (r() < 0.3) plan = withTirePattern(plan, pick([1, 2, 3]));
  if (r() < 0.3 && plan.stints.length > 1) {
    const i = Math.floor(r() * (plan.stints.length - 1));
    plan.stints[i] = { ...plan.stints[i], targetLaps: Math.max(1, plan.stints[i].targetLaps + Math.round(between(-6, 6))) };
  }
  if (r() < 0.2) plan.startFuel = pick(['auto', 'full', Math.round(between(10, setup.fuelCapacityL))] as StrategyPlan['startFuel'][]);
  if (r() < 0.2 && plan.stints.length > 1) plan.stints[0].stop = { ...plan.stints[0].stop, fuel: Math.round(between(0, 60)), energy: pick(['auto', 'full', 40] as const), extraSec: between(0, 20) };
  const events: ScenarioEvent[] = [];
  if (r() < 0.4) {
    const dur = race.lengthMode === 'time' ? race.durationSec : race.laps * (setup.racePaceMs / 1000);
    for (let k = 0; k < 1 + Math.floor(r() * 3); k++)
      events.push({
        id: `ev${k}`,
        type: pick(['SAFETY_CAR', 'SLOW_ZONE', 'FCY', 'RAIN'] as const),
        label: 'ev',
        startSec: between(0, dur),
        durationSec: between(60, 1800),
        lapDeltaSec: between(0, 40),
        fuelReductionPct: between(0, 40),
        energyReductionPct: between(0, 40),
        pitOpen: r() < 0.7,
        pitLossUnderEventSec: r() < 0.4 ? between(5, 30) : undefined,
      });
  }
  return { race, setup, drivers, plan, opts: { events }, label: `seed ${seed}` };
}

/** Every invariant the simulation must satisfy. Returns a list of broken rules. */
export function checkResult(c: Case, res: StrategyResult): string[] {
  const bad: string[] = [];
  const fail = (m: string) => bad.push(m);
  const { setup, race } = c;
  const lapsMode = race.lengthMode === 'laps';
  const hitLimit = res.issues.some((i) => i.code === 'SIM_LIMIT');

  // numbers are finite
  for (const l of res.laps) for (const [k, v] of Object.entries(l)) if (typeof v === 'number' && !Number.isFinite(v)) fail(`lap ${l.lap} ${k}=${v}`);
  for (const s of res.stints)
    for (const k of ['startSec', 'endSec', 'fuelStartL', 'fuelEndL', 'fuelUsedL', 'energyStartPct', 'energyEndPct', 'avgLapMs'] as const) if (!Number.isFinite(s[k])) fail(`stint ${s.index} ${k}=${s[k]}`);
  if (!Number.isFinite(res.finishSec)) fail(`finishSec=${res.finishSec}`);

  // laps contiguous, time continuous
  res.laps.forEach((l, i) => {
    if (l.lap !== res.startLap + i) fail(`lap numbering ${l.lap} at ${i}`);
    if (l.lapMs <= 0) fail(`lap ${l.lap} non-positive time`);
    if (!near(l.endSec - l.startSec, l.lapMs / 1000, 1e-9)) fail(`lap ${l.lap} time mismatch`);
    if (i > 0 && !near(l.startSec, res.laps[i - 1].endSec, 1e-9)) fail(`lap ${l.lap} starts at ${l.startSec} after ${res.laps[i - 1].endSec}`);
  });
  if (res.laps.length && !near(res.finishSec, res.laps[res.laps.length - 1].endSec, 1e-9)) fail('finish != last lap end');
  if (res.totalLaps !== (res.laps.length ? res.laps[res.laps.length - 1].lap : res.startLap - 1)) fail('totalLaps');

  // race distance
  if (!hitLimit && res.laps.length) {
    if (lapsMode) {
      if (res.totalLaps !== race.laps) fail(`laps race ended on ${res.totalLaps}/${race.laps}`);
    } else {
      const last = res.laps[res.laps.length - 1];
      if (last.endSec < race.durationSec - EPS) fail(`timed race ends at ${last.endSec} < ${race.durationSec}`);
      if (last.startSec >= race.durationSec + EPS && res.stops.every((s) => s.lap !== last.lap - 1)) fail(`extra lap after the flag (${last.startSec} ≥ ${race.durationSec})`);
    }
  }

  // stints contiguous and consistent with laps
  res.stints.forEach((s, k) => {
    const mine = res.laps.filter((l) => l.stint === s.index);
    if (mine.length !== s.endLap - s.fromLap + 1) fail(`stint ${s.index} lap count ${mine.length} vs ${s.endLap - s.fromLap + 1}`);
    if (mine.length && (mine[0].lap !== s.fromLap || mine[mine.length - 1].lap !== s.endLap)) fail(`stint ${s.index} range`);
    if (k > 0 && s.startLap !== res.stints[k - 1].endLap + 1) fail(`stint ${s.index} starts ${s.startLap} after ${res.stints[k - 1].endLap}`);
    if (!near(s.fuelStartL - s.fuelUsedL, s.fuelEndL, 1e-9)) fail(`stint ${s.index} fuel not conserved`);
    if (setup.energyEnabled && !near(s.energyStartPct - s.energyUsedPct, s.energyEndPct, 1e-9)) fail(`stint ${s.index} energy not conserved`);
    if (!near(mine.reduce((a, l) => a + l.fuelUsedL, 0), s.fuelUsedL, 1e-9)) fail(`stint ${s.index} fuel sum`);
    if (s.tireAgeEnd !== s.tireAgeStart + mine.length) fail(`stint ${s.index} tire age ${s.tireAgeStart}→${s.tireAgeEnd} over ${mine.length}`);
    if (s.fuelStartL > setup.fuelCapacityL + EPS) fail(`stint ${s.index} starts over capacity ${s.fuelStartL}`);
    if (setup.energyEnabled && s.energyStartPct > setup.energyCapacityPct + EPS) fail(`stint ${s.index} energy over capacity`);
    const sp = getCompound(setup, s.compound);
    if (s.tireAgeEnd > sp.maxLife && !res.issues.some((i) => i.code === 'TIRE_OVER_MAX' && i.stint === s.index)) fail(`stint ${s.index} over max life without issue`);
    if (s.fuelEndL < -EPS && !res.issues.some((i) => i.code === 'FUEL_OUT' && i.stint === s.index)) fail(`stint ${s.index} negative fuel without FUEL_OUT`);
    if (setup.energyEnabled && s.energyEndPct < -EPS && !res.issues.some((i) => i.code === 'ENERGY_OUT' && i.stint === s.index)) fail(`stint ${s.index} negative energy without ENERGY_OUT`);
    const margin = s.fuelPerLapL > 0 ? s.fuelEndL / s.fuelPerLapL : Infinity;
    if (!near(margin, s.fuelMarginLaps, 1e-9)) fail(`stint ${s.index} margin`);
  });

  // stops: one between consecutive stints, timing = pit model
  if (res.stops.length !== Math.max(0, res.stints.length - 1)) fail(`stops ${res.stops.length} vs stints ${res.stints.length}`);
  res.stops.forEach((p, k) => {
    const before = res.stints[k];
    const after = res.stints[k + 1];
    if (!before || !after) return;
    if (p.lap !== before.endLap) fail(`stop ${k} lap ${p.lap} vs stint end ${before.endLap}`);
    if (!near(p.totalLossSec, p.laneSec + p.stationarySec, 1e-9)) fail(`stop ${k} loss parts`);
    const model = calculatePitLoss(setup, { fuelAddedL: p.fuelAddedL, changeTires: p.changeTires, driverChange: p.driverChange, extraSec: p.extraSec, laneSecOverride: p.laneSec });
    if (!near(model.totalSec, p.totalLossSec, 1e-9)) fail(`stop ${k} loss vs model`);
    if (!near(after.fuelStartL, Math.max(0, before.fuelEndL) + p.fuelAddedL, 1e-9)) fail(`stop ${k} refuel: ${after.fuelStartL} vs ${before.fuelEndL}+${p.fuelAddedL}`);
    if (p.fuelAddedL < -EPS) fail(`stop ${k} negative refuel`);
    if (p.changeTires && after.tireAgeStart !== 0) fail(`stop ${k} new tires but age ${after.tireAgeStart}`);
    if (!p.changeTires && after.tireAgeStart !== before.tireAgeEnd) fail(`stop ${k} tire age jump`);
    if (!near(p.exitSec - p.entrySec, p.totalLossSec, 1e-9)) fail(`stop ${k} entry/exit`);
    if (!near(after.startSec, p.exitSec, 1e-9)) fail(`stop ${k} next stint start ${after.startSec} vs exit ${p.exitSec}`);
    if (p.driverChange !== (p.fromDriverId !== p.toDriverId)) fail(`stop ${k} driver flag`);
  });

  // totals
  if (!near(res.totalPitLossSec, res.stops.reduce((a, s) => a + s.totalLossSec, 0), 1e-9)) fail('total pit loss');
  if (!near(res.fuelUsedL, res.laps.reduce((a, l) => a + l.fuelUsedL, 0), 1e-9)) fail('fuel used total');
  const lapTime = res.laps.reduce((a, l) => a + l.lapMs / 1000, 0);
  if (!near(lapTime, res.finishSec - res.startSec, 1e-9)) fail(`lap times ${lapTime} vs elapsed ${res.finishSec - res.startSec}`);
  const drv = Object.values(res.driverTimeSec).reduce((a, b) => a + b, 0);
  if (!near(drv, res.finishSec - res.startSec, 1e-9)) fail(`driver time ${drv} vs elapsed`);
  if (res.tireSets !== 1 + res.stops.filter((s) => s.changeTires).length) fail('tire sets');
  if (res.stints.length && !near(res.minFuelMarginLaps, Math.min(...res.stints.map((s) => s.fuelMarginLaps)), 1e-12)) fail('min fuel margin');
  if (res.feasible !== !res.issues.some((i) => i.severity === 'critical')) fail('feasible flag');
  return bad;
}


const followSettings = DEFAULT_SETTINGS;

/** Drive a race where the car burns more/less than planned and the pitwall obeys the top call. */
export function followRace(seed: number, fuelBias: number, energyBias: number, log?: (line: string) => void) {
  const c = randomCase(seed);
  const pre = calculateStrategy(c.race, c.setup, c.plan, c.drivers, c.opts);
  if (!pre.feasible || pre.totalLaps > 220) return null;
  const car: CarEntry = { id: 'car', number: '1', teamName: 'T', setup: c.setup, drivers: c.drivers, plan: c.plan, planDirty: false, versions: [], live: undefined as unknown as CarEntry['live'] };
  const race: Race = { id: 'r', params: c.race, status: 'LIVE', isDemo: false, sample: false, cars: [car], activeCarId: 'car', events: c.opts.events ?? [], plannedEvents: [], clock: { running: false, anchorRaceSec: 0, anchorEpochMs: 0, speed: 1 }, createdAt: '', updatedAt: '' };
  car.live = startRaceLive(prepareGrid(race, car, followSettings));
  const rng = mulberry32(seed * 31 + 7);
  const problems: string[] = [];
  let guard = 0;
  while (guard++ < 800) {
    const live = car.live;
    const t0 = live.lastLapEndSec;
    const done = c.race.lengthMode === 'laps' ? live.lapsCompleted >= c.race.laps : t0 >= c.race.durationSec;
    if (done) break;
    const p = projectLive(race, car, followSettings, t0);
    const calls = generateRaceCalls(race, car, p, followSettings);
    const top = calls[0];
    for (const k of callProblems(calls, live.driveMode, p.currentLap)) problems.push(`lap ${p.currentLap}: ${k}`);
    // obey mode calls
    if (top?.action?.type === 'mode' && top.action.mode !== live.driveMode) car.live = { ...cloneLive(live), driveMode: top.action.mode };
    const lap = car.live.lapsCompleted + 1;
    log?.(`L${lap} fuel ${car.live.fuelL.toFixed(2)} E ${car.live.energyPct.toFixed(2)} mode ${car.live.driveMode} rate ${p.fuelRate.value.toFixed(3)} safe ${p.fuelRange.safeWhole} target ${p.window.target} final ${p.isFinalStint} top ${top?.key}:${top?.text} action ${JSON.stringify(top?.action)}`);
    const callBox = top?.action?.type === 'boxLap' && top.action.lap <= lap;
    const boxNow = (!p.isFinalStint && lap >= p.window.target) || callBox;
    // the real lap
    const ev = activeEventAt(race.events, t0);
    const driver = c.drivers.find((d) => d.id === car.live.driverId);
    const spec = getCompound(c.setup, car.live.compound);
    const fpl = calculateFuelPerLap(c.setup.fuelPerLapL * (1 + fuelBias), c.setup, car.live.driveMode, ev, driverFuelFactor(c.setup, driver)) * (1 + (rng() - 0.5) * 0.01);
    const epl = calculateEnergyPerLap(netEnergyPerLap(c.setup) * (1 + energyBias), c.setup, car.live.driveMode, ev) * (1 + (rng() - 0.5) * 0.01);
    const lapMs = predictLapMs({ setup: c.setup, driver, compound: spec, tireAge: car.live.tireAge, mode: car.live.driveMode, fuelL: car.live.fuelL, event: ev }) + (rng() - 0.5) * 600;
    const fuelAfter = car.live.fuelL - fpl;
    const energyAfter = car.live.energyPct - epl;
    if (fuelAfter < -1e-9) problems.push(`lap ${lap}: ran out of fuel (${fuelAfter.toFixed(2)} L, call "${top?.text}")`);
    if (c.setup.energyEnabled && energyAfter < -1e-9) problems.push(`lap ${lap}: ran out of energy (${energyAfter.toFixed(2)} %, call "${top?.text}")`);
    if (problems.length) break;
    // an unplanned stop (splash) takes what the call says; otherwise the planned stop
    const splash = boxNow && !p.nextStop && top?.pit;
    if (splash) {
      const loss = calculatePitLoss(c.setup, { fuelAddedL: top.pit!.fuelAddedL, changeTires: false, driverChange: false });
      car.live = recordPitStop(
        car,
        {
          inLap: lap,
          inLapMs: lapMs + loss.totalSec * 1000,
          fuelAddedL: top.pit!.fuelAddedL,
          energyAfterPct: c.setup.energyEnabled ? Math.min(c.setup.energyCapacityPct, Math.max(0, energyAfter) + top.pit!.energyAddedPct) : undefined,
          changeTires: false,
          compound: car.live.compound,
          toDriverId: car.live.driverId,
          stationarySec: loss.stationarySec,
          totalLossSec: loss.totalSec,
        },
        t0 + lapMs / 1000 + loss.totalSec,
        followSettings,
      );
      // the plan grows a stint for the unplanned stop (as the store does)
      if (car.live.stintIndex > car.plan.stints.length - 1) car.plan = { ...car.plan, stints: [...car.plan.stints, { ...car.plan.stints[car.plan.stints.length - 1], id: `x${lap}` }] };
      car.live = applyQuickUpdate(car, { fuelL: Math.min(c.setup.fuelCapacityL, Math.max(0, fuelAfter) + top.pit!.fuelAddedL) }, car.live.lastLapEndSec, followSettings, race.events);
    } else if (boxNow && p.nextStop) {
      const ns = p.nextStop;
      car.live = recordPitStop(
        car,
        {
          inLap: lap,
          inLapMs: lapMs + ns.totalLossSec * 1000,
          fuelAddedL: ns.fuelAddedL,
          energyAfterPct: c.setup.energyEnabled ? Math.min(c.setup.energyCapacityPct, Math.max(0, energyAfter) + ns.energyAddedPct) : undefined,
          changeTires: ns.changeTires,
          compound: ns.compound,
          toDriverId: ns.toDriverId,
          stationarySec: ns.stationarySec,
          totalLossSec: ns.totalLossSec,
          stationaryTimed: true,
          totalTimed: true,
        },
        t0 + lapMs / 1000 + ns.totalLossSec,
        followSettings,
      );
      car.live = applyQuickUpdate(car, { fuelL: Math.min(c.setup.fuelCapacityL, Math.max(0, fuelAfter) + ns.fuelAddedL) }, car.live.lastLapEndSec, followSettings, race.events);
    } else {
      car.live = applyQuickUpdate(
        car,
        { lapsCompleted: lap, raceTimeSec: t0 + lapMs / 1000, fuelL: fuelAfter, energyPct: c.setup.energyEnabled ? energyAfter : undefined, tireAge: car.live.tireAge + 1, lastLapMs: lapMs },
        t0 + lapMs / 1000,
        followSettings,
        race.events,
      );
    }
  }
  return problems;
}


/** Calls must be actionable: no switch to the mode already set, no box lap in the past, no duplicates. */
export function callProblems(calls: ReturnType<typeof generateRaceCalls>, mode: string, currentLap: number): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  for (const call of calls) {
    const txt = `${call.text} ${call.reasons.join(' ')} ${call.alternative ?? ''}`;
    if (/NaN|undefined|Infinity|null/.test(txt)) out.push(`unreadable call "${txt}"`);
    if (keys.has(call.key)) out.push(`duplicate call ${call.key}`);
    keys.add(call.key);
    if (call.action?.type === 'mode' && call.action.mode === mode) out.push(`"${call.text}" switches to the mode already set`);
    for (const a of [call.action, call.altAction]) if (a?.type === 'boxLap' && a.lap < currentLap) out.push(`"${call.text}" boxes on past lap ${a.lap}`);
    if (call.boxLap != null && call.boxLap < currentLap) out.push(`"${call.text}" box lap ${call.boxLap} before lap ${currentLap}`);
  }
  return out;
}

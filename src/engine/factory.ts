/**
 * Default objects. Values here are neutral starting points for a NEW race —
 * users are expected to overwrite them with their own numbers.
 */
import { emptyLive } from './liveOps';
import { buildPlan, uid } from './planner';
import { calculateStrategy } from './simulate';
import type { CarEntry, CarSetup, Driver, Race, RaceParams, Settings, StrategyPlan, StrategyVersion } from './types';

export const DEFAULT_SETTINGS: Settings = {
  units: { fuel: 'L', temp: 'C', distance: 'km' },
  time: { lapDecimals: 3, clock24h: true },
  theme: 'dark',
  numbers: { fuelDecimals: 1, decimalComma: false },
  defaults: {
    fuelReserveLaps: 1,
    fuelSafetyMarginLaps: 0.5,
    energyReservePct: 3,
    tireStrategy: 'double',
    earlyPitThresholdLaps: 3,
    fuelMethod: 'lastN',
    lastN: 5,
  },
  alerts: {
    fuelMarginWarnLaps: 2,
    fuelMarginCritLaps: 1,
    energyMarginWarnPct: 2,
    tireWarnPctOfTarget: 90,
    pitWindowWarnLaps: 2,
    staleDataLaps: 4,
    consumptionChangePct: 25,
    lapTimeDeviationPct: 15,
  },
};

// Categorical order validated with the dataviz palette validator (dark surface, adjacent CVD ΔE ≥ 8).
export const DRIVER_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];

export function defaultSetup(settings: Settings = DEFAULT_SETTINGS): CarSetup {
  return {
    car: 'Hypercar',
    className: 'HYPERCAR',
    fuelCapacityL: 75,
    fuelPerLapL: 2.8,
    racePaceMs: 95000,
    qualiPaceMs: 93500,
    wetPaceMs: 104000,
    fuelEffectSecPerL: 0,
    compounds: [
      { name: 'SOFT', paceOffsetSec: -0.3, degSecPerLap: 0.05, targetLife: 28, maxLife: 36, cliffSecPerLap: 0.12 },
      { name: 'MEDIUM', paceOffsetSec: 0, degSecPerLap: 0.03, targetLife: 50, maxLife: 60, cliffSecPerLap: 0.1 },
      { name: 'HARD', paceOffsetSec: 0.3, degSecPerLap: 0.02, targetLife: 75, maxLife: 90, cliffSecPerLap: 0.08 },
      { name: 'WET', paceOffsetSec: 6, degSecPerLap: 0.04, targetLife: 40, maxLife: 55, cliffSecPerLap: 0.1 },
    ],
    pitSpeedKph: 60,
    pitLaneLossSec: 25,
    refuelRateLps: 2.5,
    tireChangeSec: 14,
    driverChangeSec: 20,
    concurrency: 'fuelDriverThenTires',
    energyEnabled: true,
    energyCapacityPct: 100,
    energyPerLapPct: 3.8,
    energyRecoveryPerLapPct: 0,
    energyTargetPerStintPct: 97,
    energyDeployTarget: 'Balanced',
    fuelReserveLaps: settings.defaults.fuelReserveLaps,
    fuelSafetyMarginLaps: settings.defaults.fuelSafetyMarginLaps,
    energyReservePct: settings.defaults.energyReservePct,
    modes: {
      normal: { fuelPct: 0, energyPct: 0, lapSec: 0 },
      fuelSave: { fuelPct: -6, energyPct: -5, lapSec: 0.55 },
      energySave: { fuelPct: -2, energyPct: -7, lapSec: 0.45 },
      push: { fuelPct: 4, energyPct: 5, lapSec: -0.35 },
    },
  };
}

export function defaultRaceParams(): RaceParams {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 2);
  return {
    name: 'New Endurance Race',
    track: 'Circuit',
    trackLengthKm: 5,
    lengthMode: 'time',
    durationSec: 6 * 3600,
    laps: 200,
    startTimeISO: toLocalISO(start),
    sessionType: 'Race',
    weather: 'Dry',
    trackCondition: 'Rubbered-in',
    airTempC: 22,
    trackTempC: 30,
    rainProbabilityPct: 0,
    safetyCarAssumption: 'Not modelled unless added as a scenario',
    slowZoneAssumption: 'Not modelled unless added as a scenario',
  };
}

export function toLocalISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function makeDriver(name: string, code: string, i: number, extra: Partial<Driver> = {}): Driver {
  return { id: uid('drv'), name, code, color: DRIVER_COLORS[i % DRIVER_COLORS.length], ...extra };
}

export function versionOf(race: RaceParams, car: Pick<CarEntry, 'setup' | 'plan' | 'drivers'>, version: string, label: string, reason: string, extra: Partial<StrategyVersion> = {}): StrategyVersion {
  const res = calculateStrategy(race, car.setup, car.plan, car.drivers);
  return {
    id: uid('ver'),
    version,
    label,
    reason,
    createdAt: new Date().toISOString(),
    plan: JSON.parse(JSON.stringify(car.plan)) as StrategyPlan,
    setup: JSON.parse(JSON.stringify(car.setup)) as CarSetup,
    summary: { stops: res.stops.length, laps: res.totalLaps, totalSec: res.finishSec },
    ...extra,
  };
}

export function nextVersion(versions: StrategyVersion[]): string {
  if (!versions.length) return '1.0';
  const last = versions[versions.length - 1].version;
  const [maj, min] = last.split('.').map(Number);
  return `${maj}.${(min || 0) + 1}`;
}

export function newCar(race: RaceParams, settings: Settings, number = '1', teamName = 'Team'): CarEntry {
  const setup = defaultSetup(settings);
  const drivers = [makeDriver('Driver A', 'DRA', 0), makeDriver('Driver B', 'DRB', 1), makeDriver('Driver C', 'DRC', 2)];
  const plan = buildPlan(race, setup, drivers, {
    tireEvery: settings.defaults.tireStrategy === 'double' ? 2 : 1,
    driverOrder: drivers.map((d) => d.id),
    compound: 'MEDIUM',
    name: 'Baseline',
  });
  const car: CarEntry = {
    id: uid('car'),
    number,
    teamName,
    setup,
    drivers,
    plan,
    planDirty: false,
    versions: [],
    live: undefined as unknown as CarEntry['live'],
  };
  car.live = emptyLive(car, settings);
  return car;
}

export function newRace(settings: Settings, params: Partial<RaceParams> = {}): Race {
  const p = { ...defaultRaceParams(), ...params };
  const car = newCar(p, settings);
  const now = new Date().toISOString();
  return {
    id: uid('race'),
    params: p,
    status: 'PLANNING',
    isDemo: false,
    sample: false,
    cars: [car],
    activeCarId: car.id,
    events: [],
    plannedEvents: [],
    clock: { running: false, anchorRaceSec: 0, anchorEpochMs: Date.now(), speed: 1 },
    createdAt: now,
    updatedAt: now,
  };
}

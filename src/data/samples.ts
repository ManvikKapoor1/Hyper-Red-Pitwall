/**
 * SAMPLE DATA — demo races used so the product is never empty on first launch.
 * Every number here is illustrative and NOT an authoritative LMU value.
 */
import { demoAdvanceLap } from '../engine/demo';
import { DEFAULT_SETTINGS, defaultSetup, makeDriver, toLocalISO, versionOf } from '../engine/factory';
import { makeCall, prepareGrid, startRaceLive } from '../engine/liveOps';
import { makeStint, uid } from '../engine/planner';
import type { CarEntry, CarSetup, Driver, PitStopConfig, Race, RaceParams, ScenarioEvent, Settings, StrategyPlan } from '../engine/types';

function stop(changeTires: boolean, compound = 'MEDIUM', template: PitStopConfig['template'] = 'FUEL_ONLY'): PitStopConfig {
  return { template, fuel: 'auto', energy: 'full', changeTires, compound, extraSec: 0, reason: '' };
}

function porscheSetup(): CarSetup {
  return {
    ...defaultSetup(DEFAULT_SETTINGS),
    car: 'Porsche 963',
    className: 'HYPERCAR',
    fuelCapacityL: 75,
    fuelPerLapL: 2.82,
    racePaceMs: 95200,
    qualiPaceMs: 93400,
    wetPaceMs: 104600,
    pitLaneLossSec: 24.5,
    refuelRateLps: 2.4,
    tireChangeSec: 14,
    driverChangeSec: 20,
    energyPerLapPct: 3.85,
    energyTargetPerStintPct: 97,
    fuelReserveLaps: 1,
    fuelSafetyMarginLaps: 0.5,
    energyReservePct: 3,
  };
}

function fujiParams(): RaceParams {
  const start = new Date();
  start.setSeconds(0, 0);
  return {
    name: '6H Fuji Endurance',
    track: 'Fuji Speedway',
    trackLengthKm: 4.563,
    lengthMode: 'time',
    durationSec: 6 * 3600,
    laps: 228,
    startTimeISO: toLocalISO(start),
    sessionType: 'Race',
    weather: 'Dry — overcast',
    trackCondition: 'Rubbered-in',
    airTempC: 21,
    trackTempC: 29,
    rainProbabilityPct: 10,
  };
}

function plan9(drivers: Driver[], order: number[], tires: boolean[], name: string, laps = 25): StrategyPlan {
  return {
    id: uid('pl'),
    name,
    startCompound: 'MEDIUM',
    startTireAge: 0,
    startFuel: 'full',
    startEnergyPct: 100,
    stints: order.map((di, i) => {
      const s = makeStint(drivers[di].id, laps, 'MEDIUM', tires[i] ?? false);
      const next = order[i + 1];
      const drv = next != null && next !== di;
      s.stop = stop(tires[i] ?? false, 'MEDIUM', tires[i] ? (drv ? 'FUEL_TIRES_DRIVER' : 'FUEL_TIRES') : drv ? 'FUEL_DRIVER' : 'FUEL_ONLY');
      return s;
    }),
  };
}

function runTo(race: Race, lapsCompleted: number, settings: Settings) {
  for (const car of race.cars) {
    car.live = startRaceLive(prepareGrid(race, car, settings));
    car.live.calls.push(makeCall(car.live, 0, 'GREEN FLAG — STINT 1 STARTED', 'INFO', 'Race start', 'LOGGED', 'event'));
  }
  const active = race.cars[0];
  let guard = 0;
  while (active.live.phase === 'racing' && active.live.lapsCompleted < lapsCompleted && guard++ < 3000) {
    active.live = demoAdvanceLap(race, active, settings, { logCalls: true });
    const t = active.live.lastLapEndSec;
    for (const other of race.cars.slice(1)) {
      let g = 0;
      while (other.live.phase === 'racing' && g++ < 5) {
        const next = demoAdvanceLap(race, other, settings, { logCalls: true });
        if (next.lastLapEndSec > t) break;
        other.live = next;
      }
    }
  }
}

export function createDemoRace(settings: Settings = DEFAULT_SETTINGS, startLapsCompleted = 96): Race {
  const params = fujiParams();
  const setup = porscheSetup();
  const drivers = [
    makeDriver('Manny', 'MAN', 0, { number: '1', paceMs: 95050, fuelPerLapL: 2.8, preferredStintLaps: 25, maxStintLaps: 60, minStintLaps: 5, tirePreference: 'MEDIUM', energyPreference: 'Balanced' }),
    makeDriver('Alex R.', 'ALX', 1, { number: '2', paceMs: 95300, fuelPerLapL: 2.84, preferredStintLaps: 25, maxStintLaps: 60, minStintLaps: 5, tirePreference: 'MEDIUM', energyPreference: 'Early deploy' }),
    makeDriver('Jordan T.', 'JOR', 2, { number: '3', paceMs: 95550, fuelPerLapL: 2.83, preferredStintLaps: 24, maxStintLaps: 50, minStintLaps: 5, tirePreference: 'HARD', energyPreference: 'Conservative' }),
  ];
  const plan = plan9(drivers, [0, 0, 1, 1, 2, 2, 0, 1, 2], [false, true, false, true, false, true, false, true], '8-stop · double-stint tires');
  const car27: CarEntry = {
    id: uid('car'),
    number: '27',
    teamName: 'Hyper Red Racing',
    setup: { ...setup, fuelPerLapL: 2.82 },
    drivers,
    plan,
    planDirty: false,
    versions: [],
    live: undefined as unknown as CarEntry['live'],
    demo: { seed: 27, fuelBias: 0.012, energyBias: 0.008, paceBias: 150 },
  };

  const drivers28 = [
    makeDriver('Sam K.', 'SAM', 3, { paceMs: 95400, fuelPerLapL: 2.82, maxStintLaps: 60 }),
    makeDriver('Riley P.', 'RIL', 4, { paceMs: 95650, fuelPerLapL: 2.86, maxStintLaps: 60 }),
    makeDriver('Casey D.', 'CAS', 5, { paceMs: 95500, fuelPerLapL: 2.8, maxStintLaps: 60 }),
  ];
  const plan28 = plan9(drivers28, [0, 1, 2, 0, 1, 2, 0, 1, 2], [true, true, true, true, true, true, true, true], '8-stop · tires every stop');
  const car28: CarEntry = {
    id: uid('car'),
    number: '28',
    teamName: 'Hyper Red Racing',
    setup: porscheSetup(),
    drivers: drivers28,
    plan: plan28,
    planDirty: false,
    versions: [],
    live: undefined as unknown as CarEntry['live'],
    demo: { seed: 28, fuelBias: -0.004, energyBias: 0.004, paceBias: 320 },
  };

  const shower: ScenarioEvent = {
    id: uid('ev'),
    type: 'RAIN',
    label: 'Light shower — Sector 3',
    startSec: 2920,
    durationSec: 420,
    lapDeltaSec: 6,
    fuelReductionPct: 8,
    energyReductionPct: 8,
  };

  const race: Race = {
    id: 'demo-fuji',
    params,
    status: 'LIVE',
    isDemo: true,
    sample: true,
    cars: [car27, car28],
    activeCarId: car27.id,
    events: [shower],
    plannedEvents: [],
    clock: { running: false, anchorRaceSec: 0, anchorEpochMs: Date.now(), speed: 1 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // v1.0 pre-race: fuel assumption 2.78 L/lap; v1.1 once stint data confirmed higher usage
  car27.setup.fuelPerLapL = 2.78;
  car27.versions.push(versionOf(params, car27, '1.0', 'Pre-race', 'Baseline plan from practice estimates', { lap: 0, raceTimeSec: 0 }));
  car27.setup.fuelPerLapL = 2.82;
  car28.versions.push(versionOf(params, car28, '1.0', 'Pre-race', 'Baseline plan', { lap: 0, raceTimeSec: 0 }));

  runTo(race, startLapsCompleted, settings);

  const v11Lap = Math.min(40, car27.live.lapsCompleted);
  car27.versions.push(
    versionOf(params, car27, '1.1', 'Fuel assumption updated', 'Measured stint 1 consumption above pre-race estimate (2.78 → 2.82 L/lap)', {
      lap: v11Lap,
      raceTimeSec: car27.live.laps[v11Lap - 1]?.endSec ?? 0,
    }),
  );
  car27.live.calls.push(makeCall({ ...car27.live, lapsCompleted: v11Lap - 1 }, car27.live.laps[v11Lap - 1]?.endSec ?? 0, 'STRATEGY UPDATE — v1.1', 'INFO', 'Fuel assumption 2.82 L/lap', 'LOGGED', 'override'));
  car27.live.calls.sort((a, b) => a.raceTimeSec - b.raceTimeSec);

  race.clock = { running: false, anchorRaceSec: car27.live.lastLapEndSec, anchorEpochMs: Date.now(), speed: 1 };
  // start time so that the race is "in progress" right now
  const start = new Date(Date.now() - car27.live.lastLapEndSec * 1000);
  race.params.startTimeISO = toLocalISO(start);
  return race;
}

export function createCompletedSample(settings: Settings = DEFAULT_SETTINGS): Race {
  const params: RaceParams = {
    ...fujiParams(),
    name: '4H Spa-Francorchamps',
    track: 'Circuit de Spa-Francorchamps',
    trackLengthKm: 7.004,
    durationSec: 4 * 3600,
    laps: 115,
    weather: 'Dry',
    airTempC: 18,
    trackTempC: 24,
  };
  const d = new Date();
  d.setDate(d.getDate() - 6);
  d.setHours(14, 0, 0, 0);
  params.startTimeISO = toLocalISO(d);
  const setup: CarSetup = {
    ...porscheSetup(),
    racePaceMs: 125800,
    qualiPaceMs: 123900,
    fuelPerLapL: 3.9,
    fuelCapacityL: 75,
    energyPerLapPct: 5.3,
    pitLaneLossSec: 27,
  };
  const drivers = [makeDriver('Manny', 'MAN', 0, { paceMs: 125600 }), makeDriver('Alex R.', 'ALX', 1, { paceMs: 126000 })];
  const plan = plan9(drivers, [0, 0, 1, 1, 0, 1, 1], [false, true, false, true, false, true], '6-stop · double-stint tires', 18);
  const car: CarEntry = {
    id: uid('car'),
    number: '27',
    teamName: 'Hyper Red Racing',
    setup,
    drivers,
    plan,
    planDirty: false,
    versions: [],
    live: undefined as unknown as CarEntry['live'],
    demo: { seed: 11, fuelBias: 0.01, energyBias: 0.004, paceBias: 250 },
  };
  car.versions.push(versionOf(params, car, '1.0', 'Pre-race', 'Baseline plan'));
  const race: Race = {
    id: 'sample-spa',
    params,
    status: 'FINISHED',
    isDemo: false,
    sample: true,
    cars: [car],
    activeCarId: car.id,
    events: [
      { id: uid('ev'), type: 'RAIN', label: 'Rain — Les Combes', startSec: 5400, durationSec: 900, lapDeltaSec: 9, fuelReductionPct: 10, energyReductionPct: 12 },
    ],
    plannedEvents: [],
    clock: { running: false, anchorRaceSec: 0, anchorEpochMs: Date.now(), speed: 1 },
    createdAt: d.toISOString(),
    updatedAt: d.toISOString(),
  };
  runTo(race, 10000, settings);
  race.clock.anchorRaceSec = car.live.lastLapEndSec;
  return race;
}

export function createUpcomingSample(settings: Settings = DEFAULT_SETTINGS): Race {
  void settings;
  const params: RaceParams = {
    ...fujiParams(),
    name: '24H Le Mans',
    track: 'Circuit de la Sarthe',
    trackLengthKm: 13.626,
    durationSec: 24 * 3600,
    laps: 380,
    weather: 'Dry (rain risk overnight)',
    airTempC: 24,
    trackTempC: 36,
    rainProbabilityPct: 35,
  };
  const d = new Date();
  d.setDate(d.getDate() + 12);
  d.setHours(16, 0, 0, 0);
  params.startTimeISO = toLocalISO(d);
  const setup: CarSetup = { ...porscheSetup(), racePaceMs: 211500, qualiPaceMs: 206800, fuelPerLapL: 6.3, energyPerLapPct: 7.9, pitLaneLossSec: 32, fuelCapacityL: 90 };
  const drivers = [makeDriver('Manny', 'MAN', 0), makeDriver('Alex R.', 'ALX', 1), makeDriver('Jordan T.', 'JOR', 2)];
  const n = 33;
  const order = Array.from({ length: n }, (_, i) => Math.floor(i / 2) % 3);
  const tires = Array.from({ length: n - 1 }, (_, i) => i % 2 === 1);
  const plan = plan9(drivers, order, tires, 'Draft — 32 stops', 12);
  const car: CarEntry = {
    id: uid('car'),
    number: '27',
    teamName: 'Hyper Red Racing',
    setup,
    drivers,
    plan,
    planDirty: true,
    versions: [],
    live: undefined as unknown as CarEntry['live'],
  };
  const race: Race = {
    id: 'sample-lemans',
    params,
    status: 'PLANNING',
    isDemo: false,
    sample: true,
    cars: [car],
    activeCarId: car.id,
    events: [],
    plannedEvents: [],
    clock: { running: false, anchorRaceSec: 0, anchorEpochMs: Date.now(), speed: 1 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  car.live = prepareGrid(race, car, DEFAULT_SETTINGS);
  car.live.phase = 'pre';
  return race;
}

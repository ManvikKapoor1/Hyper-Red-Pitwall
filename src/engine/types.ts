/**
 * STINT domain model.
 *
 * Internal units are fixed so every calculation is unambiguous:
 *   time      → seconds (race clock, durations) / milliseconds (lap times)
 *   fuel      → litres
 *   energy    → percent of the virtual-energy allocation (0–100)
 *   temp      → °C
 *   distance  → km
 * Display conversion happens in the UI layer only (see lib/units.ts).
 */

export type ID = string;

export type RaceLengthMode = 'time' | 'laps';
export type Compound = string; // compound names are user-defined (e.g. SOFT / MEDIUM / HARD / WET)
export type DriveMode = 'normal' | 'fuelSave' | 'energySave' | 'push';
export type ServiceConcurrency = 'sequential' | 'parallel' | 'fuelDriverThenTires';
export type RefillAmount = 'auto' | 'full' | number;
export type FuelMethod = 'stint' | 'race' | 'lastN' | 'user';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
export type TrafficLevel = 'clear' | 'light' | 'heavy';

export type PitTemplate =
  | 'FUEL_ONLY'
  | 'FUEL_TIRES'
  | 'FUEL_DRIVER'
  | 'FUEL_TIRES_DRIVER'
  | 'DRIVER_ONLY'
  | 'EMERGENCY'
  | 'CUSTOM';

// ────────────────────────────────────────────────────────────────────────────
// Race & car setup (all values entered by humans)
// ────────────────────────────────────────────────────────────────────────────

export interface RaceParams {
  name: string;
  track: string;
  trackLengthKm: number;
  lengthMode: RaceLengthMode;
  durationSec: number;
  laps: number;
  startTimeISO: string; // local wall-clock start
  sessionType: string;
  weather: string;
  trackCondition: string;
  airTempC: number;
  trackTempC: number;
  rainProbabilityPct: number;
  safetyCarAssumption: string;
  slowZoneAssumption: string;
}

export interface CompoundSpec {
  name: Compound;
  paceOffsetSec: number; // vs. reference race pace
  degSecPerLap: number; // linear pace loss per lap of age
  targetLife: number; // laps — competitive life target
  maxLife: number; // laps — do-not-exceed
  cliffSecPerLap: number; // extra loss per lap beyond target life
}

export interface ModeEffect {
  fuelPct: number; // +/- % change in fuel per lap
  energyPct: number; // +/- % change in energy per lap
  lapSec: number; // +/- seconds per lap
}

export interface CarSetup {
  // car
  car: string;
  className: string;
  fuelCapacityL: number;
  fuelPerLapL: number;
  racePaceMs: number;
  qualiPaceMs: number;
  wetPaceMs: number;
  fuelEffectSecPerL: number; // lap-time penalty per litre carried (0 = ignore)
  // tires
  compounds: CompoundSpec[];
  // pit
  pitSpeedKph: number;
  pitLaneLossSec: number; // drive-through loss vs. staying on track
  refuelRateLps: number;
  tireChangeSec: number;
  driverChangeSec: number;
  concurrency: ServiceConcurrency;
  // energy
  energyEnabled: boolean;
  energyCapacityPct: number;
  energyPerLapPct: number;
  energyRecoveryPerLapPct: number; // informational; net usage = perLap − recovery
  energyTargetPerStintPct: number;
  energyDeployTarget: string;
  // margins
  fuelReserveLaps: number; // planning reserve kept in tank at planned stop
  fuelSafetyMarginLaps: number; // subtracted from theoretical → SAFE laps
  energyReservePct: number;
  // user-defined mode effects (never assumed physics)
  modes: Record<DriveMode, ModeEffect>;
}

export interface Driver {
  id: ID;
  name: string;
  code: string; // short tag, e.g. MAN
  number?: string;
  color: string;
  paceMs?: number; // optional; falls back to car race pace
  fuelPerLapL?: number;
  preferredStintLaps?: number;
  maxStintLaps?: number;
  minStintLaps?: number;
  tirePreference?: string;
  energyPreference?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Strategy plan
// ────────────────────────────────────────────────────────────────────────────

export interface PitStopConfig {
  template: PitTemplate;
  fuel: RefillAmount;
  energy: RefillAmount;
  changeTires: boolean;
  compound: Compound; // compound fitted if tires change
  extraSec: number; // repairs / penalties / custom work
  reason: string;
}

export interface StintPlan {
  id: ID;
  driverId: ID;
  targetLaps: number; // ignored for the final stint (runs to flag)
  mode: DriveMode;
  energyTargetPct?: number; // stint energy budget (optional)
  lapTimeOverrideMs?: number;
  fuelPerLapOverrideL?: number;
  notes?: string;
  /** Stop taken at the END of this stint (ignored for the final stint). */
  stop: PitStopConfig;
}

export interface StrategyPlan {
  id: ID;
  name: string;
  startCompound: Compound;
  startTireAge: number;
  startFuel: RefillAmount;
  startEnergyPct: number;
  stints: StintPlan[];
  notes?: string;
}

export interface StrategyVersion {
  id: ID;
  version: string; // "1.0", "1.1"…
  label: string;
  reason: string;
  createdAt: string;
  raceTimeSec?: number;
  lap?: number;
  plan: StrategyPlan;
  setup: CarSetup;
  summary: { stops: number; laps: number; totalSec: number };
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario events (safety car / slow zone …) — effects are always user-entered
// ────────────────────────────────────────────────────────────────────────────

export type ScenarioType =
  | 'SAFETY_CAR'
  | 'SLOW_ZONE'
  | 'FCY'
  | 'VSC'
  | 'RED_FLAG'
  | 'RAIN'
  | 'DRYING'
  | 'CUSTOM';

export interface ScenarioEvent {
  id: ID;
  type: ScenarioType;
  label: string;
  startSec: number;
  durationSec: number; // estimated
  endedSec?: number; // actual end if cleared early
  lapDeltaSec: number;
  fuelReductionPct: number;
  energyReductionPct: number;
  pitOpen: boolean;
  pitLossUnderEventSec?: number; // pit-lane loss while the event is active (replaces the green-flag lane loss)
  planned?: boolean; // simulation-only assumption
}

// ────────────────────────────────────────────────────────────────────────────
// Live session state (per car)
// ────────────────────────────────────────────────────────────────────────────

export interface LapRecord {
  lap: number;
  stint: number;
  driverId: ID;
  lapMs: number;
  endSec: number;
  fuelUsedL: number | null;
  fuelAfterL: number;
  energyUsedPct: number | null;
  energyAfterPct: number;
  tireAge: number;
  compound: Compound;
  pitIn?: boolean;
  event?: ScenarioType;
  estimated?: boolean; // interpolated from a multi-lap manual update
  mode?: DriveMode; // drive mode the lap was driven in (as instructed by the pitwall)
}

export interface ActualStop {
  index: number;
  lap: number;
  raceTimeSec: number;
  fuelAddedL: number;
  energyAddedPct: number;
  changeTires: boolean;
  compound: Compound;
  fromDriverId: ID;
  toDriverId: ID;
  stationarySec: number;
  totalLossSec: number;
  underEvent?: ScenarioType;
  note?: string;
  /** true when the time was entered / timed, false when the setup estimate was accepted */
  stationaryTimed?: boolean;
  totalTimed?: boolean;
}

export type CallPriority = 'CRITICAL' | 'ACTION' | 'UPCOMING' | 'INFO';
export type CallStatus = 'ISSUED' | 'CONFIRMED' | 'CANCELLED' | 'CHANGED' | 'COMPLETED' | 'LOGGED';

export interface CallLogEntry {
  id: ID;
  raceTimeSec: number;
  lap: number;
  text: string;
  priority: CallPriority;
  reason: string;
  status: CallStatus;
  source: 'system' | 'override' | 'manual' | 'event';
  createdAt: string;
}

export interface InputLogEntry {
  id: ID;
  raceTimeSec: number;
  lap: number;
  fields: string[];
  summary: string;
  createdAt: string;
}

export type PitPhase = null | 'entry' | 'stationary' | 'exit';
export type SessionPhase = 'pre' | 'grid' | 'racing' | 'finished';

export interface CarLive {
  phase: SessionPhase;
  pitPhase: PitPhase;
  lapsCompleted: number;
  lastLapEndSec: number;
  stintIndex: number;
  stintStartLap: number; // first lap number of the current stint
  stintStartFuelL: number;
  stintStartEnergyPct: number;
  driverId: ID;
  fuelL: number;
  energyPct: number;
  compound: Compound;
  tireAge: number;
  lastLapMs: number | null;
  bestLapMs: number | null;
  gapAheadSec: number | null;
  gapBehindSec: number | null;
  position: number | null;
  traffic: TrafficLevel;
  weather: string;
  driveMode: DriveMode;
  fuelMethod: FuelMethod;
  lastN: number;
  userFuelPerLapL: number | null;
  laps: LapRecord[];
  stops: ActualStop[];
  pitLapOverrides: Record<number, number>; // stintIndex → in-lap
  calls: CallLogEntry[];
  inputs: InputLogEntry[];
  lastUpdateLap: number;
  strategyChangedLap: number | null;
}

export interface RaceClock {
  running: boolean;
  anchorRaceSec: number;
  anchorEpochMs: number;
  speed: number;
}

export interface CarEntry {
  id: ID;
  number: string;
  teamName: string;
  setup: CarSetup;
  drivers: Driver[];
  plan: StrategyPlan;
  planDirty: boolean;
  versions: StrategyVersion[];
  live: CarLive;
  demo?: { seed: number; fuelBias: number; energyBias: number; paceBias: number };
}

export type RaceStatus = 'PLANNING' | 'READY' | 'LIVE' | 'FINISHED';

export interface Race {
  id: ID;
  params: RaceParams;
  status: RaceStatus;
  isDemo: boolean;
  sample: boolean; // values are SAMPLE DATA
  cars: CarEntry[];
  activeCarId: ID;
  events: ScenarioEvent[]; // live events (race-wide)
  plannedEvents: ScenarioEvent[]; // simulation assumptions
  clock: RaceClock;
  createdAt: string;
  updatedAt: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Settings
// ────────────────────────────────────────────────────────────────────────────

export interface Settings {
  units: { fuel: 'L' | 'gal'; temp: 'C' | 'F'; distance: 'km' | 'mi' };
  time: { lapDecimals: 1 | 2 | 3; clock24h: boolean };
  theme: 'dark' | 'contrast' | 'light';
  numbers: { fuelDecimals: 1 | 2; decimalComma: boolean };
  defaults: {
    fuelReserveLaps: number;
    fuelSafetyMarginLaps: number;
    energyReservePct: number;
    tireStrategy: 'double' | 'every';
    earlyPitThresholdLaps: number;
    fuelMethod: FuelMethod;
    lastN: number;
  };
  alerts: {
    fuelMarginWarnLaps: number;
    fuelMarginCritLaps: number;
    energyMarginWarnPct: number;
    tireWarnPctOfTarget: number;
    pitWindowWarnLaps: number;
    staleDataLaps: number;
    consumptionChangePct: number;
    lapTimeDeviationPct: number;
  };
}

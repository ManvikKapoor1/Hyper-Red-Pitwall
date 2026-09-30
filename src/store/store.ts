import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createCompletedSample, createDemoRace, createUpcomingSample } from '../data/samples';
import { demoAdvanceLap } from '../engine/demo';
import { DEFAULT_SETTINGS, makeDriver, newCar, newRace, nextVersion, versionOf } from '../engine/factory';
import { raceNowSec } from '../engine/live';
import {
  applyQuickUpdate,
  cloneLive,
  emptyLive,
  makeCall,
  prepareGrid,
  recordPitStop,
  startRaceLive,
  type PitStopInput,
} from '../engine/liveOps';
import { clonePlan, makeStint, uid } from '../engine/planner';
import type { QuickUpdateInput } from '../engine/validate';
import type {
  CallLogEntry,
  CallPriority,
  CallStatus,
  CarEntry,
  CarSetup,
  Driver,
  DriveMode,
  FuelMethod,
  LapRecord,
  PitPhase,
  Race,
  RaceParams,
  RaceStatus,
  ScenarioEvent,
  Settings,
  StrategyPlan,
} from '../engine/types';
import { storageAdapter } from './persistence';

export interface SavedStrategy {
  id: string;
  name: string;
  createdAt: string;
  track: string;
  car: string;
  plan: StrategyPlan;
  setup: CarSetup;
  drivers: Driver[];
}

export interface TrackEntry {
  id: string;
  name: string;
  lengthKm: number;
  notes: string;
}

export interface Toast {
  id: string;
  text: string;
  level: 'info' | 'ok' | 'warn' | 'crit';
}

interface Library {
  strategies: SavedStrategy[];
  tracks: TrackEntry[];
  teams: string[];
}

export interface AppState {
  races: Race[];
  settings: Settings;
  activeRaceId: string | null;
  library: Library;
  seeded: boolean;
  toasts: Toast[];

  toast: (text: string, level?: Toast['level']) => void;
  dismissToast: (id: string) => void;

  seedSamples: () => void;
  createRace: (params?: Partial<RaceParams>) => string;
  loadDemo: () => string;
  deleteRace: (id: string) => void;
  duplicateRace: (id: string) => string;
  setActiveRace: (id: string) => void;
  updateRaceParams: (id: string, patch: Partial<RaceParams>) => void;
  setRaceStatus: (id: string, status: RaceStatus) => void;
  setActiveCar: (raceId: string, carId: string) => void;
  addCar: (raceId: string) => void;
  removeCar: (raceId: string, carId: string) => void;
  updateCarMeta: (raceId: string, carId: string, patch: Partial<Pick<CarEntry, 'number' | 'teamName'>>) => void;

  updateSetup: (raceId: string, carId: string, patch: Partial<CarSetup>) => void;
  addDriver: (raceId: string, carId: string) => void;
  updateDriver: (raceId: string, carId: string, driverId: string, patch: Partial<Driver>) => void;
  removeDriver: (raceId: string, carId: string, driverId: string) => void;
  setPlan: (raceId: string, carId: string, plan: StrategyPlan, note?: string) => void;
  saveVersion: (raceId: string, carId: string, label: string, reason: string) => void;
  restoreVersion: (raceId: string, carId: string, versionId: string) => void;
  saveToLibrary: (raceId: string, carId: string, name: string) => void;
  applyLibraryStrategy: (raceId: string, carId: string, libId: string) => void;
  deleteLibraryStrategy: (libId: string) => void;
  upsertTrack: (t: TrackEntry) => void;
  removeTrack: (id: string) => void;

  prepareGrid: (raceId: string) => void;
  startRace: (raceId: string) => void;
  finishRace: (raceId: string) => void;
  resetLive: (raceId: string) => void;
  quickUpdate: (raceId: string, carId: string, input: QuickUpdateInput) => void;
  recordStop: (raceId: string, carId: string, input: PitStopInput) => void;
  setPitPhase: (raceId: string, carId: string, phase: PitPhase) => void;
  setDriveMode: (raceId: string, carId: string, mode: DriveMode) => void;
  setFuelMethod: (raceId: string, carId: string, method: FuelMethod, lastN?: number, userValue?: number | null) => void;
  setPitOverride: (raceId: string, carId: string, stintIndex: number, lap: number | null, reason: string) => void;
  logCall: (raceId: string, carId: string, text: string, priority: CallPriority, reason: string, status: CallStatus, source: CallLogEntry['source']) => void;
  setCallStatus: (raceId: string, carId: string, callId: string, status: CallStatus) => void;
  editLap: (raceId: string, carId: string, lap: number, patch: Partial<LapRecord>) => void;
  deleteLap: (raceId: string, carId: string, lap: number) => void;

  triggerEvent: (raceId: string, ev: Omit<ScenarioEvent, 'id'>) => string;
  endEvent: (raceId: string, evId: string, atSec: number) => void;
  updateEvent: (raceId: string, evId: string, patch: Partial<ScenarioEvent>) => void;
  removeEvent: (raceId: string, evId: string) => void;
  setPlannedEvents: (raceId: string, events: ScenarioEvent[]) => void;

  setClockRunning: (raceId: string, running: boolean) => void;
  setClockSpeed: (raceId: string, speed: number) => void;
  setRaceTime: (raceId: string, sec: number) => void;

  demoAdvance: (raceId: string, laps?: number) => void;
  demoSync: (raceId: string, nowSec: number) => void;

  updateSettings: (patch: DeepPartial<Settings>) => void;
  importAll: (data: unknown) => boolean;
  resetAll: () => void;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' ? deepMerge(b, v as DeepPartial<typeof b>) : v;
  }
  return out as T;
}

const touch = (r: Race): Race => ({ ...r, updatedAt: new Date().toISOString() });

function mapCar(race: Race, carId: string, fn: (c: CarEntry) => CarEntry): Race {
  return { ...race, cars: race.cars.map((c) => (c.id === carId ? fn(c) : c)) };
}

function nowFor(race: Race) {
  return raceNowSec(race.clock);
}

/** Creates a strategy version on the car (live changes stamp the current lap). */
function withVersion(race: Race, car: CarEntry, label: string, reason: string): CarEntry {
  const version = nextVersion(car.versions);
  const racing = car.live.phase === 'racing';
  const v = versionOf(race.params, car, version, label, reason, racing ? { lap: car.live.lapsCompleted + 1, raceTimeSec: nowFor(race) } : {});
  const live = racing ? { ...car.live, strategyChangedLap: car.live.lapsCompleted + 1 } : car.live;
  return { ...car, versions: [...car.versions, v], planDirty: false, live };
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      const mapRace = (id: string, fn: (r: Race) => Race) =>
        set((s) => ({ races: s.races.map((r) => (r.id === id ? touch(fn(r)) : r)) }));
      const mapRaceCar = (raceId: string, carId: string, fn: (c: CarEntry, r: Race) => CarEntry) =>
        mapRace(raceId, (r) => mapCar(r, carId, (c) => fn(c, r)));

      return {
        races: [],
        settings: DEFAULT_SETTINGS,
        activeRaceId: null,
        library: { strategies: [], tracks: [], teams: ['Hyper Red Racing'] },
        seeded: false,
        toasts: [],

        toast: (text, level = 'info') => {
          const id = uid('t');
          set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, level }] }));
          setTimeout(() => get().dismissToast(id), 2600);
        },
        dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

        seedSamples: () => {
          const st = get().settings;
          const demo = createDemoRace(st);
          const done = createCompletedSample(st);
          const upcoming = createUpcomingSample(st);
          set((s) => ({
            races: [demo, upcoming, done, ...s.races.filter((r) => ![demo.id, done.id, upcoming.id].includes(r.id))],
            activeRaceId: s.activeRaceId ?? demo.id,
            seeded: true,
            library: {
              ...s.library,
              tracks: s.library.tracks.length
                ? s.library.tracks
                : [
                    { id: uid('trk'), name: 'Fuji Speedway', lengthKm: 4.563, notes: 'Sample entry' },
                    { id: uid('trk'), name: 'Circuit de Spa-Francorchamps', lengthKm: 7.004, notes: 'Sample entry' },
                    { id: uid('trk'), name: 'Circuit de la Sarthe', lengthKm: 13.626, notes: 'Sample entry' },
                  ],
            },
          }));
        },

        createRace: (params) => {
          const r = newRace(get().settings, params);
          set((s) => ({ races: [r, ...s.races], activeRaceId: r.id }));
          return r.id;
        },
        loadDemo: () => {
          const r = createDemoRace(get().settings);
          set((s) => ({ races: [r, ...s.races.filter((x) => x.id !== r.id)], activeRaceId: r.id }));
          return r.id;
        },
        deleteRace: (id) => set((s) => ({ races: s.races.filter((r) => r.id !== id), activeRaceId: s.activeRaceId === id ? (s.races.find((r) => r.id !== id)?.id ?? null) : s.activeRaceId })),
        duplicateRace: (id) => {
          const src = get().races.find((r) => r.id === id);
          if (!src) return id;
          const copy: Race = JSON.parse(JSON.stringify(src));
          copy.id = uid('race');
          copy.params.name = `${src.params.name} (copy)`;
          copy.status = 'PLANNING';
          copy.isDemo = false;
          copy.events = [];
          copy.clock = { running: false, anchorRaceSec: 0, anchorEpochMs: Date.now(), speed: 1 };
          copy.cars = copy.cars.map((c) => ({ ...c, id: uid('car'), live: emptyLive(c, get().settings), versions: [], demo: undefined }));
          copy.activeCarId = copy.cars[0].id;
          copy.createdAt = copy.updatedAt = new Date().toISOString();
          set((s) => ({ races: [copy, ...s.races], activeRaceId: copy.id }));
          return copy.id;
        },
        setActiveRace: (id) => set({ activeRaceId: id }),
        updateRaceParams: (id, patch) => mapRace(id, (r) => ({ ...r, params: { ...r.params, ...patch } })),
        setRaceStatus: (id, status) => mapRace(id, (r) => ({ ...r, status })),
        setActiveCar: (raceId, carId) => mapRace(raceId, (r) => ({ ...r, activeCarId: carId })),
        addCar: (raceId) =>
          mapRace(raceId, (r) => {
            const src = r.cars.find((c) => c.id === r.activeCarId) ?? r.cars[0];
            const nums = r.cars.map((c) => Number(c.number)).filter((n) => isFinite(n));
            const car = newCar(r.params, get().settings, String((nums.length ? Math.max(...nums) : 0) + 1), src?.teamName ?? 'Team');
            if (src) {
              car.setup = JSON.parse(JSON.stringify(src.setup));
              car.drivers = src.drivers.map((d, i) => makeDriver(`${d.name} (2)`, d.code, i + 3));
              car.plan = { ...clonePlan(src.plan), id: uid('pl') };
              car.plan.stints = car.plan.stints.map((st) => ({ ...st, id: uid('st'), driverId: car.drivers[src.drivers.findIndex((d) => d.id === st.driverId)]?.id ?? car.drivers[0].id }));
              car.live = emptyLive(car, get().settings);
            }
            return { ...r, cars: [...r.cars, car], activeCarId: car.id };
          }),
        removeCar: (raceId, carId) =>
          mapRace(raceId, (r) => {
            if (r.cars.length <= 1) return r;
            const cars = r.cars.filter((c) => c.id !== carId);
            return { ...r, cars, activeCarId: r.activeCarId === carId ? cars[0].id : r.activeCarId };
          }),
        updateCarMeta: (raceId, carId, patch) => mapRaceCar(raceId, carId, (c) => ({ ...c, ...patch })),

        updateSetup: (raceId, carId, patch) => mapRaceCar(raceId, carId, (c) => ({ ...c, setup: { ...c.setup, ...patch }, planDirty: true })),
        addDriver: (raceId, carId) =>
          mapRaceCar(raceId, carId, (c) => {
            const i = c.drivers.length;
            const letter = String.fromCharCode(65 + i);
            return { ...c, drivers: [...c.drivers, makeDriver(`Driver ${letter}`, `DR${letter}`, i)] };
          }),
        updateDriver: (raceId, carId, driverId, patch) =>
          mapRaceCar(raceId, carId, (c) => ({ ...c, drivers: c.drivers.map((d) => (d.id === driverId ? { ...d, ...patch } : d)) })),
        removeDriver: (raceId, carId, driverId) =>
          mapRaceCar(raceId, carId, (c) => {
            if (c.drivers.length <= 1) return c;
            const drivers = c.drivers.filter((d) => d.id !== driverId);
            const plan = { ...c.plan, stints: c.plan.stints.map((s) => (s.driverId === driverId ? { ...s, driverId: drivers[0].id } : s)) };
            return { ...c, drivers, plan };
          }),
        setPlan: (raceId, carId, plan) => mapRaceCar(raceId, carId, (c) => ({ ...c, plan, planDirty: true })),
        saveVersion: (raceId, carId, label, reason) => {
          mapRaceCar(raceId, carId, (c, r) => {
            const next = withVersion(r, c, label, reason);
            if (c.live.phase === 'racing') {
              const v = next.versions[next.versions.length - 1];
              next.live = { ...next.live, calls: [...next.live.calls, makeCall(next.live, nowFor(r), `STRATEGY v${v.version} — ${label.toUpperCase()}`, 'INFO', reason, 'LOGGED', 'override')] };
            }
            return next;
          });
          get().toast('Strategy version saved', 'ok');
        },
        restoreVersion: (raceId, carId, versionId) => {
          mapRaceCar(raceId, carId, (c, r) => {
            const v = c.versions.find((x) => x.id === versionId);
            if (!v) return c;
            const restored = { ...c, plan: clonePlan(v.plan), setup: JSON.parse(JSON.stringify(v.setup)) };
            return withVersion(r, restored, `Restored v${v.version}`, `Restored from v${v.version} (${v.label})`);
          });
          get().toast('Version restored as new version', 'ok');
        },
        saveToLibrary: (raceId, carId, name) => {
          const r = get().races.find((x) => x.id === raceId);
          const c = r?.cars.find((x) => x.id === carId);
          if (!r || !c) return;
          const entry: SavedStrategy = {
            id: uid('lib'),
            name,
            createdAt: new Date().toISOString(),
            track: r.params.track,
            car: c.setup.car,
            plan: clonePlan(c.plan),
            setup: JSON.parse(JSON.stringify(c.setup)),
            drivers: JSON.parse(JSON.stringify(c.drivers)),
          };
          set((s) => ({ library: { ...s.library, strategies: [entry, ...s.library.strategies] } }));
          get().toast('Strategy saved to library', 'ok');
        },
        applyLibraryStrategy: (raceId, carId, libId) => {
          const lib = get().library.strategies.find((l) => l.id === libId);
          if (!lib) return;
          mapRaceCar(raceId, carId, (c) => {
            // map library drivers onto this car's drivers by position
            const plan = clonePlan(lib.plan);
            plan.stints = plan.stints.map((s) => {
              const i = lib.drivers.findIndex((d) => d.id === s.driverId);
              return { ...s, id: uid('st'), driverId: c.drivers[Math.max(0, i) % c.drivers.length]?.id ?? s.driverId };
            });
            return { ...c, plan, setup: JSON.parse(JSON.stringify(lib.setup)), planDirty: true };
          });
          get().toast(`Loaded "${lib.name}"`, 'ok');
        },
        deleteLibraryStrategy: (libId) => set((s) => ({ library: { ...s.library, strategies: s.library.strategies.filter((l) => l.id !== libId) } })),
        upsertTrack: (t) => set((s) => ({ library: { ...s.library, tracks: s.library.tracks.some((x) => x.id === t.id) ? s.library.tracks.map((x) => (x.id === t.id ? t : x)) : [...s.library.tracks, t] } })),
        removeTrack: (id) => set((s) => ({ library: { ...s.library, tracks: s.library.tracks.filter((t) => t.id !== id) } })),

        prepareGrid: (raceId) => {
          const st = get().settings;
          mapRace(raceId, (r) => ({ ...r, status: 'READY', cars: r.cars.map((c) => ({ ...c, live: prepareGrid(r, c, st) })), clock: { running: false, anchorRaceSec: 0, anchorEpochMs: Date.now(), speed: r.clock.speed } }));
          get().toast('Cars on the grid — values loaded from plan', 'info');
        },
        startRace: (raceId) => {
          const st = get().settings;
          mapRace(raceId, (r) => ({
            ...r,
            status: 'LIVE',
            clock: { running: true, anchorRaceSec: 0, anchorEpochMs: Date.now(), speed: r.clock.speed || 1 },
            cars: r.cars.map((c) => {
              const base = c.live.phase === 'grid' ? c.live : prepareGrid(r, c, st);
              let car: CarEntry = { ...c, live: startRaceLive(base) };
              if (!car.versions.length) car = { ...withVersion(r, { ...car, live: { ...car.live, phase: 'pre' } }, 'Pre-race', 'Plan at race start'), live: car.live };
              car.live = { ...car.live, strategyChangedLap: null, calls: [...car.live.calls, makeCall(car.live, 0, 'GREEN FLAG — STINT 1 STARTED', 'INFO', 'Race start', 'LOGGED', 'event')] };
              return car;
            }),
          }));
          get().toast('Race started — clock running', 'ok');
        },
        finishRace: (raceId) =>
          mapRace(raceId, (r) => ({
            ...r,
            status: 'FINISHED',
            clock: { ...r.clock, running: false, anchorRaceSec: nowFor(r), anchorEpochMs: Date.now() },
            cars: r.cars.map((c) => ({ ...c, live: { ...c.live, phase: 'finished', calls: [...c.live.calls, makeCall(c.live, nowFor(r), 'CHEQUERED FLAG', 'INFO', 'Race finished', 'LOGGED', 'event')] } })),
          })),
        resetLive: (raceId) => {
          const st = get().settings;
          mapRace(raceId, (r) => ({ ...r, status: 'PLANNING', events: [], clock: { running: false, anchorRaceSec: 0, anchorEpochMs: Date.now(), speed: 1 }, cars: r.cars.map((c) => ({ ...c, live: emptyLive(c, st) })) }));
        },
        quickUpdate: (raceId, carId, input) => {
          const st = get().settings;
          mapRace(raceId, (r) => {
            const now = nowFor(r);
            let clock = r.clock;
            if (input.raceTimeSec != null) clock = { ...clock, anchorRaceSec: input.raceTimeSec, anchorEpochMs: Date.now() };
            const out = mapCar({ ...r, clock }, carId, (c) => ({ ...c, live: applyQuickUpdate(c, input, input.raceTimeSec ?? now, st) }));
            const lastEnd = out.cars.find((c) => c.id === carId)?.live.lastLapEndSec ?? 0;
            // keep the race clock from lagging behind recorded laps (e.g. paused clock)
            if (lastEnd > nowFor(out)) out.clock = { ...out.clock, anchorRaceSec: lastEnd, anchorEpochMs: Date.now() };
            return out;
          });
          get().toast('Race updated — projections recalculated', 'ok');
        },
        recordStop: (raceId, carId, input) => {
          const st = get().settings;
          mapRace(raceId, (r) => {
            const now = nowFor(r);
            let lastEnd = 0;
            const out = mapCar(r, carId, (c) => {
              let live = recordPitStop(c, input, now, st);
              let plan = c.plan;
              let car: CarEntry = { ...c, live };
              // unplanned extra stop → extend the plan so the stint exists
              if (live.stintIndex > plan.stints.length - 1) {
                plan = clonePlan(plan);
                const last = plan.stints[plan.stints.length - 1];
                plan.stints.push({ ...makeStint(input.toDriverId, last?.targetLaps ?? 20, input.compound), mode: 'normal' });
                car = withVersion(r, { ...car, plan }, 'Unplanned stop', `Stop at lap ${input.inLap} added a stint`);
                live = car.live;
              }
              const drv = c.drivers.find((d) => d.id === input.toDriverId)?.name ?? '';
              live = {
                ...live,
                calls: [
                  ...live.calls,
                  makeCall(live, live.lastLapEndSec, `PIT STOP ${live.stops.length} COMPLETE`, 'INFO', `+${input.fuelAddedL.toFixed(1)} L · ${input.changeTires ? 'tires ' + input.compound : 'no tires'} · ${drv}`, 'COMPLETED', 'event'),
                  makeCall(live, live.lastLapEndSec, `STINT ${live.stintIndex + 1} STARTED`, 'INFO', `Driver ${drv}`, 'LOGGED', 'event'),
                ],
              };
              lastEnd = live.lastLapEndSec;
              return { ...car, live };
            });
            if (lastEnd > now) out.clock = { ...out.clock, anchorRaceSec: lastEnd, anchorEpochMs: Date.now() };
            return out;
          });
          get().toast('Pit stop recorded — new stint started', 'ok');
        },
        setPitPhase: (raceId, carId, phase) => mapRaceCar(raceId, carId, (c) => ({ ...c, live: { ...c.live, pitPhase: phase } })),
        setDriveMode: (raceId, carId, mode) => mapRaceCar(raceId, carId, (c) => ({ ...c, live: { ...c.live, driveMode: mode } })),
        setFuelMethod: (raceId, carId, method, lastN, userValue) =>
          mapRaceCar(raceId, carId, (c) => ({ ...c, live: { ...c.live, fuelMethod: method, lastN: lastN ?? c.live.lastN, userFuelPerLapL: userValue === undefined ? c.live.userFuelPerLapL : userValue } })),
        setPitOverride: (raceId, carId, stintIndex, lap, reason) => {
          mapRaceCar(raceId, carId, (c, r) => {
            const live = cloneLive(c.live);
            if (lap == null) delete live.pitLapOverrides[stintIndex];
            else live.pitLapOverrides[stintIndex] = lap;
            const label = lap == null ? `Stint ${stintIndex + 1} override cleared` : `Stint ${stintIndex + 1} → box lap ${lap}`;
            let car = withVersion(r, { ...c, live }, label, reason);
            car = { ...car, live: { ...car.live, calls: [...car.live.calls, makeCall(car.live, nowFor(r), lap == null ? 'OVERRIDE CLEARED — PLAN RESTORED' : `OVERRIDE → BOX LAP ${lap}`, 'ACTION', reason, 'CHANGED', 'override')] } };
            return car;
          });
          get().toast(lap == null ? 'Override cleared — plan restored' : `Override applied — box lap ${lap}. Downstream recalculated`, 'warn');
        },
        logCall: (raceId, carId, text, priority, reason, status, source) =>
          mapRaceCar(raceId, carId, (c, r) => ({ ...c, live: { ...c.live, calls: [...c.live.calls, makeCall(c.live, nowFor(r), text, priority, reason, status, source)] } })),
        setCallStatus: (raceId, carId, callId, status) =>
          mapRaceCar(raceId, carId, (c) => ({ ...c, live: { ...c.live, calls: c.live.calls.map((x) => (x.id === callId ? { ...x, status } : x)) } })),
        editLap: (raceId, carId, lap, patch) =>
          mapRaceCar(raceId, carId, (c) => ({ ...c, live: { ...c.live, laps: c.live.laps.map((l) => (l.lap === lap ? { ...l, ...patch, estimated: false } : l)) } })),
        deleteLap: (raceId, carId, lap) =>
          mapRaceCar(raceId, carId, (c) => ({ ...c, live: { ...c.live, laps: c.live.laps.filter((l) => l.lap !== lap) } })),

        triggerEvent: (raceId, ev) => {
          const id = uid('ev');
          mapRace(raceId, (r) => ({
            ...r,
            events: [...r.events, { ...ev, id }],
            cars: r.cars.map((c) => ({ ...c, live: { ...c.live, calls: [...c.live.calls, makeCall(c.live, ev.startSec, `${ev.label.toUpperCase()}`, 'ACTION', `Est. ${Math.round(ev.durationSec / 60)} min · +${ev.lapDeltaSec}s/lap · pit ${ev.pitOpen ? 'OPEN' : 'CLOSED'}`, 'LOGGED', 'event')] } })),
          }));
          get().toast(`${ev.label} — strategy recalculated`, 'warn');
          return id;
        },
        endEvent: (raceId, evId, atSec) =>
          mapRace(raceId, (r) => {
            const ev = r.events.find((e) => e.id === evId);
            return {
              ...r,
              events: r.events.map((e) => (e.id === evId ? { ...e, endedSec: atSec } : e)),
              cars: ev ? r.cars.map((c) => ({ ...c, live: { ...c.live, calls: [...c.live.calls, makeCall(c.live, atSec, `${ev.type.replace('_', ' ')} ENDED — GREEN`, 'INFO', ev.label, 'LOGGED', 'event')] } })) : r.cars,
            };
          }),
        updateEvent: (raceId, evId, patch) => mapRace(raceId, (r) => ({ ...r, events: r.events.map((e) => (e.id === evId ? { ...e, ...patch } : e)) })),
        removeEvent: (raceId, evId) => mapRace(raceId, (r) => ({ ...r, events: r.events.filter((e) => e.id !== evId) })),
        setPlannedEvents: (raceId, events) => mapRace(raceId, (r) => ({ ...r, plannedEvents: events })),

        setClockRunning: (raceId, running) =>
          mapRace(raceId, (r) => ({ ...r, clock: { ...r.clock, running, anchorRaceSec: nowFor(r), anchorEpochMs: Date.now() } })),
        setClockSpeed: (raceId, speed) =>
          mapRace(raceId, (r) => ({ ...r, clock: { ...r.clock, speed, anchorRaceSec: nowFor(r), anchorEpochMs: Date.now() } })),
        setRaceTime: (raceId, sec) => mapRace(raceId, (r) => ({ ...r, clock: { ...r.clock, anchorRaceSec: sec, anchorEpochMs: Date.now() } })),

        demoAdvance: (raceId, laps = 1) => {
          const st = get().settings;
          mapRace(raceId, (r0) => {
            let r = r0;
            for (let i = 0; i < laps; i++) {
              const active = r.cars.find((c) => c.id === r.activeCarId) ?? r.cars[0];
              if (active.live.phase !== 'racing') break;
              const live = demoAdvanceLap(r, active, st);
              r = mapCar(r, active.id, (c) => ({ ...c, live }));
              const t = live.lastLapEndSec;
              r = syncOthers(r, active.id, t, st);
              r = { ...r, clock: { ...r.clock, anchorRaceSec: Math.max(t, r.clock.running ? nowFor(r) : 0), anchorEpochMs: Date.now() } };
            }
            if (r.cars.every((c) => c.live.phase === 'finished')) r = { ...r, status: 'FINISHED', clock: { ...r.clock, running: false } };
            return r;
          });
        },
        demoSync: (raceId, nowSec) => {
          const st = get().settings;
          const r0 = get().races.find((x) => x.id === raceId);
          if (!r0) return;
          let changed = false;
          let r = r0;
          for (const car of r0.cars) {
            let c = car;
            let guard = 0;
            while (c.live.phase === 'racing' && guard++ < 10) {
              const next = demoAdvanceLap(r, c, st);
              if (next.lastLapEndSec > nowSec) break;
              c = { ...c, live: next };
              changed = true;
            }
            r = mapCar(r, car.id, () => c);
          }
          if (!changed) return;
          if (r.cars.every((c) => c.live.phase === 'finished')) r = { ...r, status: 'FINISHED', clock: { ...r.clock, running: false, anchorRaceSec: nowSec, anchorEpochMs: Date.now() } };
          set((s) => ({ races: s.races.map((x) => (x.id === raceId ? touch(r) : x)) }));
        },

        updateSettings: (patch) => set((s) => ({ settings: deepMerge(s.settings, patch) })),
        importAll: (data) => {
          const d = data as Partial<AppState>;
          if (!d || !Array.isArray(d.races)) return false;
          set((s) => ({ races: d.races!, settings: d.settings ? deepMerge(DEFAULT_SETTINGS, d.settings) : s.settings, library: d.library ?? s.library, activeRaceId: d.races![0]?.id ?? null, seeded: true }));
          return true;
        },
        resetAll: () => {
          set({ races: [], settings: DEFAULT_SETTINGS, activeRaceId: null, seeded: false, library: { strategies: [], tracks: [], teams: ['Hyper Red Racing'] } });
          get().seedSamples();
        },
      };
    },
    {
      name: 'stint.v1',
      version: 1,
      storage: createJSONStorage(() => storageAdapter),
      partialize: (s) => ({ races: s.races, settings: s.settings, activeRaceId: s.activeRaceId, library: s.library, seeded: s.seeded }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return { ...current, ...p, settings: deepMerge(DEFAULT_SETTINGS, (p.settings ?? {}) as DeepPartial<Settings>) };
      },
      onRehydrateStorage: () => (state) => {
        if (state && !state.seeded) state.seedSamples();
      },
    },
  ),
);

function syncOthers(r: Race, activeId: string, t: number, st: Settings): Race {
  let out = r;
  for (const c0 of r.cars) {
    if (c0.id === activeId) continue;
    let c = c0;
    let guard = 0;
    while (c.live.phase === 'racing' && guard++ < 10) {
      const next = demoAdvanceLap(out, c, st);
      if (next.lastLapEndSec > t) break;
      c = { ...c, live: next };
    }
    out = mapCar(out, c0.id, () => c);
  }
  return out;
}

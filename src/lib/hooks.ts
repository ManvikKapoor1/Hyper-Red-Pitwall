import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { generateRaceCalls } from '../engine/calls';
import { liveSimOptions, projectLive, raceNowSec } from '../engine/live';
import { calculateStrategy, type SimOptions } from '../engine/simulate';
import type { CarEntry, Race } from '../engine/types';
import { useStore } from '../store/store';

export function useRaceFromRoute(): Race | undefined {
  const { raceId } = useParams();
  return useStore((s) => s.races.find((r) => r.id === raceId));
}

export function activeCar(race: Race): CarEntry {
  return race.cars.find((c) => c.id === race.activeCarId) ?? race.cars[0];
}

/** Race clock (seconds). Ticks only while the clock runs. */
export function useRaceNow(race: Race | undefined, intervalMs = 250): number {
  const [, setTick] = useState(0);
  const running = !!race?.clock.running;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [running, intervalMs]);
  return race ? raceNowSec(race.clock) : 0;
}

/** Live projection + suggested calls. Recomputed when data changes or once per race-second. */
export function useLive(race: Race, car: CarEntry, nowSec: number) {
  const settings = useStore((s) => s.settings);
  const sec = Math.floor(nowSec);
  return useMemo(() => {
    const p = projectLive(race, car, settings, sec);
    const calls = generateRaceCalls(race, car, p, settings);
    return { p, calls };
  }, [race, car, settings, sec]);
}

/** Pre-race simulation of the car's plan. Planned scenarios are opt-in (Simulation tab). */
/** True while the car is racing: plan views then project from the live state. */
export function isLive(car: CarEntry): boolean {
  return car.live.phase === 'racing';
}

/** Live simulation options while racing (measured rates, current state), else none. */
export function useLiveSim(race: Race, car: CarEntry): SimOptions | undefined {
  const settings = useStore((s) => s.settings);
  const live = isLive(car);
  return useMemo(() => (live ? liveSimOptions(race, car, settings) : undefined), [live, race, car, settings]);
}

/**
 * Simulation of the car's plan. While racing it projects from the live state
 * (lap, fuel, energy, tires, measured rates, overrides, race events) like the
 * Live page; `fromStart` forces the whole race from lap 1, `plannedEvents`
 * adds the planning scenarios (always from the start).
 */
export function usePlanResult(race: Race, car: CarEntry, opts: { plannedEvents?: boolean; fromStart?: boolean } = {}) {
  const settings = useStore((s) => s.settings);
  const live = isLive(car) && !opts.fromStart && !opts.plannedEvents;
  const events = opts.plannedEvents ? race.plannedEvents : undefined;
  return useMemo(
    () =>
      live
        ? calculateStrategy(race.params, car.setup, car.plan, car.drivers, liveSimOptions(race, car, settings))
        : calculateStrategy(race.params, car.setup, car.plan, car.drivers, { earlyThresholdLaps: settings.defaults.earlyPitThresholdLaps, events }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, live ? race : race.params, live ? car : car.plan, car.setup, car.plan, car.drivers, events, settings],
  );
}

export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, deps: unknown[] = []) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const fn = map[e.key.toLowerCase()];
      if (fn) {
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function driverName(car: CarEntry, id?: string) {
  return car.drivers.find((d) => d.id === id)?.name ?? '—';
}
export function driverOf(car: CarEntry, id?: string) {
  return car.drivers.find((d) => d.id === id);
}

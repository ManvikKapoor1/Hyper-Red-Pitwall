import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { generateRaceCalls } from '../engine/calls';
import { projectLive, raceNowSec } from '../engine/live';
import { calculateStrategy } from '../engine/simulate';
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
export function usePlanResult(race: Race, car: CarEntry, withPlannedEvents = false) {
  const settings = useStore((s) => s.settings);
  const events = withPlannedEvents ? race.plannedEvents : undefined;
  return useMemo(
    () => calculateStrategy(race.params, car.setup, car.plan, car.drivers, { earlyThresholdLaps: settings.defaults.earlyPitThresholdLaps, events }),
    [race.params, car.setup, car.plan, car.drivers, events, settings.defaults.earlyPitThresholdLaps],
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

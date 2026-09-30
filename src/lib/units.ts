import { useMemo } from 'react';
import { formatClock, formatLapMs } from '../engine/format';
import { useStore } from '../store/store';
import type { Settings } from '../engine/types';

const L_PER_GAL = 3.785411784;

export function makeUnits(settings: Settings) {
  const gal = settings.units.fuel === 'gal';
  const fDec = settings.numbers.fuelDecimals;
  const comma = settings.numbers.decimalComma;
  const fmt = (v: number, d: number) => {
    if (v == null || !isFinite(v)) return '—';
    const s = v.toFixed(d);
    return comma ? s.replace('.', ',') : s;
  };
  return {
    fuelUnit: gal ? 'gal' : 'L',
    fuelVal: (l: number) => (gal ? l / L_PER_GAL : l),
    fuelFromDisplay: (v: number) => (gal ? v * L_PER_GAL : v),
    fuel: (l: number | null | undefined, d: number = fDec) => (l == null || !isFinite(l) ? '—' : fmt(gal ? l / L_PER_GAL : l, d)),
    fuelU: (l: number | null | undefined, d: number = fDec) => (l == null || !isFinite(l) ? '—' : `${fmt(gal ? l / L_PER_GAL : l, d)} ${gal ? 'gal' : 'L'}`),
    fpl: (l: number | null | undefined) => (l == null || !isFinite(l) ? '—' : fmt(gal ? l / L_PER_GAL : l, gal ? 3 : 2)),
    tempUnit: settings.units.temp === 'F' ? '°F' : '°C',
    temp: (c: number) => (settings.units.temp === 'F' ? fmt(c * 1.8 + 32, 0) : fmt(c, 0)),
    tempFromDisplay: (v: number) => (settings.units.temp === 'F' ? (v - 32) / 1.8 : v),
    distUnit: settings.units.distance,
    dist: (km: number) => (settings.units.distance === 'mi' ? fmt(km * 0.621371, 3) : fmt(km, 3)),
    distFromDisplay: (v: number) => (settings.units.distance === 'mi' ? v / 0.621371 : v),
    lap: (ms: number | null | undefined) => formatLapMs(ms, settings.time.lapDecimals),
    clock: (s: number | null | undefined) => formatClock(s),
    n: fmt,
    pct: (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? '—' : fmt(v, d)),
  };
}

export type Units = ReturnType<typeof makeUnits>;

export function useUnits(): Units {
  const settings = useStore((s) => s.settings);
  return useMemo(() => makeUnits(settings), [settings]);
}

/** Pure formatting helpers for race data (monospace-friendly, no locale surprises). */

export function pad(n: number, w = 2): string {
  return String(Math.floor(Math.abs(n))).padStart(w, '0');
}

/** 95212 → "1:35.212" */
export function formatLapMs(ms: number | null | undefined, decimals: 1 | 2 | 3 = 3): string {
  if (ms == null || !isFinite(ms) || ms <= 0) return '—:——.———'.slice(0, 6 + decimals);
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  const sStr = s.toFixed(decimals);
  const [whole, frac] = sStr.split('.');
  // guard against 59.9995 → 60.000
  if (Number(whole) >= 60) return `${m + 1}:00.${'0'.repeat(decimals)}`;
  return `${m}:${whole.padStart(2, '0')}.${frac}`;
}

/** 13288 → "3:41:28" (race clock) */
export function formatClock(sec: number | null | undefined, showHours = true): string {
  if (sec == null || !isFinite(sec)) return '—:——:——';
  const neg = sec < 0;
  const t = Math.floor(Math.abs(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const body = showHours || h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return neg ? `-${body}` : body;
}

/** 37.2 min style: 2232 → "0:37" (h:mm) */
export function formatHM(sec: number): string {
  const t = Math.max(0, Math.floor(sec / 60));
  return `${Math.floor(t / 60)}:${pad(t % 60)}`;
}

/** Compact duration: 42 → "42 s", 660 → "11 min", 4000 → "1 h 07" */
export function formatDurationShort(sec: number): string {
  if (!isFinite(sec)) return '—';
  const s = Math.max(0, Math.round(sec));
  if (s < 90) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${pad(Math.floor((s % 3600) / 60))}`;
}

/** +12.4 / −3.1 */
export function formatDelta(v: number, decimals = 1, unit = ''): string {
  if (!isFinite(v)) return '—';
  const sign = v > 0.0000001 ? '+' : v < -0.0000001 ? '−' : '±';
  return `${sign}${Math.abs(v).toFixed(decimals)}${unit}`;
}

export function formatNum(v: number | null | undefined, decimals = 1): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toFixed(decimals);
}

/** "1:35.212" | "95.212" → ms. Seconds must be below 60 when minutes are given; lap times are positive. */
export function parseLapTime(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!t) return null;
  const m = t.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const mins = m[1] ? Number(m[1]) : 0;
  const secs = Number(m[2]);
  if (!isFinite(secs) || (m[1] && secs >= 60)) return null;
  const ms = Math.round((mins * 60 + secs) * 1000);
  return ms > 0 ? ms : null;
}

/** "3:41:28" | "41:28" | "13288" → seconds. Minutes and seconds after the first part must be below 60. */
export function parseClock(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.slice(1).some((n) => n >= 60)) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

export function wallClock(startISO: string, raceSec: number, h24 = true): string {
  const d = new Date(startISO);
  if (isNaN(d.getTime())) return '—';
  const t = new Date(d.getTime() + raceSec * 1000);
  return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !h24 });
}

const L_PER_GAL = 3.785411784;
export type FuelUnit = 'L' | 'gal';

/** Litres → text in the user's fuel unit ("12.4 L" / "3.3 gal"). */
export function fuelText(litres: number, unit: FuelUnit = 'L', decimals = 1): string {
  if (!isFinite(litres)) return '—';
  return unit === 'gal' ? `${(litres / L_PER_GAL).toFixed(decimals + 1)} gal` : `${litres.toFixed(decimals)} L`;
}

/** Litres per lap → text in the user's fuel unit. */
export function fuelRateText(litresPerLap: number, unit: FuelUnit = 'L'): string {
  if (!isFinite(litresPerLap)) return '—';
  return unit === 'gal' ? `${(litresPerLap / L_PER_GAL).toFixed(3)} gal/lap` : `${litresPerLap.toFixed(2)} L/lap`;
}

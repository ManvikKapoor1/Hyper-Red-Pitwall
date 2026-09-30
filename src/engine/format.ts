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

/** "1:35.212" | "95.212" | "1:35" → ms */
export function parseLapTime(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const mins = m[1] ? Number(m[1]) : 0;
  const secs = Number(m[2]);
  if (!isFinite(secs)) return null;
  return Math.round((mins * 60 + secs) * 1000);
}

/** "3:41:28" | "41:28" | "13288" → seconds */
export function parseClock(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.some((p) => p === '' || isNaN(Number(p)))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}

export function wallClock(startISO: string, raceSec: number, h24 = true): string {
  const d = new Date(startISO);
  if (isNaN(d.getTime())) return '—';
  const t = new Date(d.getTime() + raceSec * 1000);
  return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: !h24 });
}

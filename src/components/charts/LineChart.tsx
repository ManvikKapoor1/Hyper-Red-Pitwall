/**
 * Small SVG line chart — one y-axis, 2px lines, hairline grid, crosshair
 * tooltip that lists every series at the hovered x. Sizes itself to its
 * container so it can fill fixed-height panels without nested scrolling.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface ChartPoint {
  x: number;
  y: number | null;
}

export interface ChartSeries {
  id: string;
  label: string;
  points: ChartPoint[];
  color: string; // CSS colour (tokens: var(--text-2), var(--violet) …)
  dashed?: boolean; // assumptions / projections
  step?: boolean;
  dots?: boolean;
}

export interface ChartMarker {
  x: number;
  y: number;
  kind: 'pit' | 'event' | 'dim';
  label: string;
}

export interface ChartBand {
  x0: number;
  x1: number;
  kind: 'event' | 'window';
}

export interface LineChartProps {
  series: ChartSeries[];
  markers?: ChartMarker[];
  bands?: ChartBand[];
  vlines?: { x: number; label?: string; anchor?: 'start' | 'end' }[];
  hlines?: { y: number; label?: string; color?: string }[];
  xDomain?: [number, number];
  yDomain?: [number, number];
  /** Include zero in the y domain (magnitudes). */
  zero?: boolean;
  yFormat: (v: number) => string;
  /** Axis tick label; defaults to a precision derived from the tick step. */
  yTick?: (v: number, step: number) => string;
  /** Only label whole-number x ticks (laps). */
  xInteger?: boolean;
  xFormat?: (v: number) => string;
  tipTitle?: (x: number) => ReactNode;
  tipExtra?: (x: number) => ReactNode;
  height?: number;
  ariaLabel: string;
  empty?: ReactNode;
}

const PAD = { r: 8, t: 8, b: 18 };

export function stepDecimals(step: number): number {
  return step > 0 ? Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)) : 0;
}

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!isFinite(min) || !isFinite(max)) return [];
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize((s) => (Math.abs(s.w - width) < 1 && Math.abs(s.h - height) < 1 ? s : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function LineChart(props: LineChartProps) {
  const { series, markers = [], bands = [], vlines = [], hlines = [], yFormat, xFormat = (v) => String(v), ariaLabel } = props;
  const [ref, size] = useSize<HTMLDivElement>();
  const [hx, setHx] = useState<number | null>(null);
  const w = size.w;
  const h = props.height ?? size.h;

  const xs = useMemo(() => {
    const set = new Set<number>();
    for (const s of series) for (const p of s.points) if (p.y != null) set.add(p.x);
    for (const m of markers) set.add(m.x);
    return [...set].sort((a, b) => a - b);
  }, [series, markers]);

  const [x0, x1] = props.xDomain ?? [xs[0] ?? 0, xs[xs.length - 1] ?? 1];
  const [y0, y1] = useMemo(() => {
    if (props.yDomain) return props.yDomain;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series)
      for (const p of s.points)
        if (p.y != null && isFinite(p.y)) {
          lo = Math.min(lo, p.y);
          hi = Math.max(hi, p.y);
        }
    for (const l of hlines) {
      lo = Math.min(lo, l.y);
      hi = Math.max(hi, l.y);
    }
    if (!isFinite(lo)) return [0, 1];
    if (props.zero) lo = Math.min(0, lo);
    const pad = (hi - lo || Math.abs(hi) * 0.1 || 1) * 0.12;
    return [props.zero && lo >= 0 ? 0 : lo - pad, hi + pad];
  }, [series, hlines, props.yDomain, props.zero]);

  const ih = Math.max(1, h - PAD.t - PAD.b);
  const yTicks = niceTicks(y0, y1, Math.max(2, Math.min(5, Math.floor(ih / 28))));
  const yStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
  const tickText = (v: number) => (props.yTick ? props.yTick(v, yStep) : v.toFixed(stepDecimals(yStep)));
  const padL = Math.max(26, Math.max(0, ...yTicks.map((t) => tickText(t).length)) * 6.2 + 9);
  const iw = Math.max(1, w - padL - PAD.r);
  const sx = (x: number) => padL + (x1 === x0 ? iw / 2 : ((x - x0) / (x1 - x0)) * iw);
  const sy = (y: number) => PAD.t + ih - ((Math.max(y0, Math.min(y1, y)) - y0) / (y1 - y0 || 1)) * ih;

  const xTicks = niceTicks(x0, x1, Math.max(2, Math.min(8, Math.floor(iw / 70)))).filter((v) => !props.xInteger || Number.isInteger(v));

  const path = (s: ChartSeries) => {
    let d = '';
    let pen = false;
    for (const p of s.points) {
      if (p.y == null || !isFinite(p.y) || p.x < x0 || p.x > x1) {
        pen = false;
        continue;
      }
      const X = sx(p.x);
      const Y = sy(p.y);
      if (!pen) d += `M${X.toFixed(1)},${Y.toFixed(1)}`;
      else if (s.step) d += `H${X.toFixed(1)}V${Y.toFixed(1)}`;
      else d += `L${X.toFixed(1)},${Y.toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const nearest = (px: number) => {
    if (!xs.length) return null;
    const x = x0 + ((px - padL) / iw) * (x1 - x0);
    let best = xs[0];
    for (const v of xs) if (Math.abs(v - x) < Math.abs(best - x)) best = v;
    return best;
  };

  const tip = hx != null && w > 0 && (
    <div className="lc-tip" style={{ left: Math.min(Math.max(sx(hx) + 10, 0), w - 150), top: PAD.t }}>
      <div className="lc-tip-t">{props.tipTitle ? props.tipTitle(hx) : xFormat(hx)}</div>
      {series.map((s) => {
        const p = s.points.find((q) => q.x === hx);
        return (
          <div key={s.id} className="lc-tip-r">
            <i className={s.dashed ? 'dash' : ''} style={{ borderColor: s.color }} />
            <b>{p?.y != null ? yFormat(p.y) : '—'}</b>
            <span>{s.label}</span>
          </div>
        );
      })}
      {markers
        .filter((m) => m.x === hx)
        .map((m, i) => (
          <div key={i} className="lc-tip-r">
            <i className={`mk ${m.kind}`} />
            <b>{yFormat(m.y)}</b>
            <span>{m.label}</span>
          </div>
        ))}
      {props.tipExtra?.(hx)}
    </div>
  );

  return (
    <div
      ref={ref}
      className="lc"
      style={props.height ? { height: props.height } : undefined}
      tabIndex={0}
      role="img"
      aria-label={ariaLabel}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setHx(nearest(e.clientX - r.left));
      }}
      onPointerLeave={() => setHx(null)}
      onBlur={() => setHx(null)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const i = hx == null ? xs.length - 1 : xs.indexOf(hx) + (e.key === 'ArrowRight' ? 1 : -1);
        setHx(xs[Math.max(0, Math.min(xs.length - 1, i))] ?? null);
      }}
    >
      {w > 0 && h > 0 && (
        <svg width={w} height={h} className="lc-svg">
          {bands.map((b, i) => (
            <rect key={i} className={`lc-band ${b.kind}`} x={sx(b.x0)} y={PAD.t} width={Math.max(1, sx(b.x1) - sx(b.x0))} height={ih} />
          ))}
          {yTicks.map((t) => (
            <g key={t}>
              <line className="lc-grid" x1={padL} x2={padL + iw} y1={sy(t)} y2={sy(t)} />
              <text className="lc-tick" x={padL - 5} y={sy(t)} dy="0.32em" textAnchor="end">
                {tickText(t)}
              </text>
            </g>
          ))}
          <line className="lc-axis" x1={padL} x2={padL + iw} y1={PAD.t + ih} y2={PAD.t + ih} />
          {xTicks.map((t) => (
            <text key={t} className="lc-tick" x={sx(t)} y={PAD.t + ih + 12} textAnchor="middle">
              {xFormat(t)}
            </text>
          ))}
          {vlines.map((v, i) => (
            <g key={i}>
              <line className="lc-vline" x1={sx(v.x)} x2={sx(v.x)} y1={PAD.t} y2={PAD.t + ih} />
              {v.label && (
                <text className="lc-vlabel" x={sx(v.x) + (v.anchor === 'end' ? -3 : 3)} y={PAD.t + 8} textAnchor={v.anchor ?? 'start'}>
                  {v.label}
                </text>
              )}
            </g>
          ))}
          {hlines.map((l, i) => (
            <g key={i}>
              <line className="lc-hline" x1={padL} x2={padL + iw} y1={sy(l.y)} y2={sy(l.y)} style={l.color ? { stroke: l.color } : undefined} />
              {l.label && (
                <text className="lc-vlabel" x={padL + iw - 3} y={sy(l.y) - 3} textAnchor="end">
                  {l.label}
                </text>
              )}
            </g>
          ))}
          {series.map((s) => (
            <g key={s.id}>
              <path d={path(s)} className={`lc-line ${s.dashed ? 'dash' : ''}`} style={{ stroke: s.color }} />
              {s.dots &&
                s.points.map((p) =>
                  p.y == null || p.x < x0 || p.x > x1 ? null : <circle key={p.x} className="lc-dot" cx={sx(p.x)} cy={sy(p.y)} r={3} style={{ fill: s.color }} />,
                )}
            </g>
          ))}
          {markers.map((m, i) => (
            <circle key={i} className={`lc-mk ${m.kind}`} cx={sx(m.x)} cy={sy(m.y)} r={4} />
          ))}
          {hx != null && (
            <g className="lc-cross">
              <line x1={sx(hx)} x2={sx(hx)} y1={PAD.t} y2={PAD.t + ih} />
              {series.map((s) => {
                const p = s.points.find((q) => q.x === hx);
                return p?.y != null ? <circle key={s.id} cx={sx(hx)} cy={sy(p.y)} r={4} style={{ fill: s.color }} /> : null;
              })}
            </g>
          )}
        </svg>
      )}
      {xs.length === 0 && <div className="lc-empty">{props.empty ?? 'No data yet'}</div>}
      {tip}
    </div>
  );
}

/** Legend row: line keys, dashed for assumptions, dots for markers. */
export function ChartLegend({ items }: { items: { label: string; color?: string; dashed?: boolean; marker?: ChartMarker['kind'] }[] }) {
  return (
    <span className="lc-legend">
      {items.map((it) => (
        <span key={it.label} className="lc-lg">
          {it.marker ? <i className={`mk ${it.marker}`} /> : <i className={it.dashed ? 'dash' : ''} style={{ borderColor: it.color }} />}
          {it.label}
        </span>
      ))}
    </span>
  );
}

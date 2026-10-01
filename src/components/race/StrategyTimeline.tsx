import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { actualStints } from '../../engine/analysis';
import { formatHM } from '../../engine/format';
import type { LiveProjection } from '../../engine/live';
import type { StrategyResult } from '../../engine/simulate';
import type { CallLogEntry, CarEntry, ScenarioEvent, StrategyVersion } from '../../engine/types';
import { IconZoomIn, IconZoomOut } from '../icons';

export interface TLBlock {
  index: number;
  driverId: string;
  startLap: number;
  endLap: number;
  startSec: number;
  endSec: number;
  kind: 'done' | 'current' | 'plan';
  compound: string;
  newTires: boolean;
  final: boolean;
  flag?: string;
  laps: number;
}
export interface TLStop {
  lap: number;
  sec: number;
  fuel: boolean;
  tires: boolean;
  driver: boolean;
  kind: 'done' | 'plan';
  label: string;
}

export function blocksFromResult(res: StrategyResult, kind: TLBlock['kind'] = 'plan'): { blocks: TLBlock[]; stops: TLStop[] } {
  return {
    blocks: res.stints.map((s) => ({
      index: s.index,
      driverId: s.driverId,
      startLap: s.startLap,
      endLap: s.endLap,
      startSec: s.startSec,
      endSec: s.endSec,
      kind,
      compound: s.compound,
      newTires: s.newTires,
      final: s.final,
      flag: s.flag,
      laps: s.laps,
    })),
    stops: res.stops.map((s) => ({
      lap: s.lap,
      sec: s.entrySec,
      fuel: s.fuelAddedL > 0.05,
      tires: s.changeTires,
      driver: s.driverChange,
      kind: 'plan' as const,
      label: `PIT ${s.index + 1} · L${s.lap}`,
    })),
  };
}

/** Recorded stints and stops (the running stint is marked current while racing). */
export function blocksFromActual(car: CarEntry): { blocks: TLBlock[]; stops: TLStop[] } {
  const racing = car.live.phase === 'racing';
  return {
    blocks: actualStints(car).map((s) => ({
      index: s.index,
      driverId: s.driverId,
      startLap: s.startLap,
      endLap: s.endLap,
      startSec: s.startSec,
      endSec: s.endSec,
      kind: racing && s.index === car.live.stintIndex ? 'current' : 'done',
      compound: s.compound,
      newTires: false,
      final: false,
      laps: s.laps,
    })),
    stops: car.live.stops.map((s) => ({ lap: s.lap, sec: s.raceTimeSec, fuel: s.fuelAddedL > 0.05, tires: s.changeTires, driver: s.fromDriverId !== s.toDriverId, kind: 'done', label: `PIT ${s.index + 1} · L${s.lap}` })),
  };
}

/** Actual completed stints + live projection from the current stint onwards. */
export function blocksFromLive(car: CarEntry, p: LiveProjection) {
  const actual = blocksFromActual(car);
  const proj = blocksFromResult(p.sim);
  const blocks: TLBlock[] = [
    // after the flag the stint being driven is complete too
    ...actual.blocks.filter((b) => b.index < car.live.stintIndex || car.live.phase === 'finished'),
    ...proj.blocks.map((b, i) => (i === 0 && car.live.phase === 'racing' ? { ...b, kind: 'current' as const } : b)),
  ];
  const stops: TLStop[] = [...actual.stops, ...proj.stops.map((s, i) => ({ ...s, label: `PIT ${car.live.stops.length + i + 1} · L${s.lap}` }))];
  return { blocks, stops };
}

export function StrategyTimeline({
  car,
  blocks,
  stops,
  totalLaps,
  totalSec,
  nowLap,
  events = [],
  calls = [],
  versions = [],
  actual,
  axis = 'lap',
  zoomable = true,
  compact = false,
  selected,
  onSelect,
  headerRight,
  labels,
}: {
  car: CarEntry;
  blocks: TLBlock[];
  stops: TLStop[];
  totalLaps: number;
  totalSec: number;
  nowLap?: number;
  events?: ScenarioEvent[];
  calls?: CallLogEntry[];
  versions?: StrategyVersion[];
  actual?: { blocks: TLBlock[]; stops: TLStop[] };
  axis?: 'lap' | 'time';
  zoomable?: boolean;
  compact?: boolean;
  selected?: number;
  onSelect?: (i: number) => void;
  headerRight?: ReactNode;
  labels?: { plan?: string; actual?: string };
}) {
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement>(null);
  // drawn width in px: labels and stop icons only show where they fit (no text on top of text)
  const [px, setPx] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setPx(el.clientWidth));
    ro.observe(el);
    setPx(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const innerPx = px * zoom;
  const fits = (pct: number, need: number) => !px || (pct / 100) * innerPx >= need;
  const drv = useMemo(() => new Map(car.drivers.map((d) => [d.id, d])), [car.drivers]);
  const domain = axis === 'lap' ? Math.max(1, totalLaps) : Math.max(1, totalSec);
  const posLap = (lap: number) => ((lap - 1) / domain) * 100; // start of lap
  const posEndLap = (lap: number) => (lap / domain) * 100;
  const posSec = (s: number) => (s / domain) * 100;
  const bx = (b: TLBlock) => (axis === 'lap' ? { l: posLap(b.startLap), r: posEndLap(b.endLap) } : { l: posSec(b.startSec), r: posSec(b.endSec) });
  const sx = (s: TLStop) => (axis === 'lap' ? posEndLap(s.lap) : posSec(s.sec));
  const lapAtSec = (sec: number) => {
    const all = [...blocks].sort((a, b) => a.startSec - b.startSec);
    const b = all.find((x) => sec >= x.startSec && sec <= x.endSec);
    if (!b) return sec <= 0 ? 1 : totalLaps;
    return b.startLap + ((sec - b.startSec) / Math.max(1, b.endSec - b.startSec)) * b.laps;
  };
  const ex = (sec: number) => (axis === 'lap' ? posLap(lapAtSec(sec)) : posSec(sec));

  const tickStep = axis === 'lap' ? niceStep(domain / (8 * zoom)) : niceTimeStep(domain / (8 * zoom));
  const ticks: number[] = [];
  for (let v = 0; v <= domain; v += tickStep) ticks.push(v);

  const nowX = nowLap != null ? (axis === 'lap' ? posLap(nowLap) : undefined) : undefined;
  const lanes = [
    { key: 'plan', label: labels?.plan ?? (actual ? 'PLAN' : nowLap != null ? 'STRATEGY' : 'PLAN'), data: { blocks, stops } },
    ...(actual ? [{ key: 'actual', label: labels?.actual ?? 'ACTUAL', data: actual }] : []),
  ];

  return (
    <div className={`tl ${compact ? 'compact' : ''}`}>
      {zoomable && (
        <div className="tl-tools">
          <div className="tl-legend">
            <span className="lg-i">
              <i className="lg-pit" /> Pit
            </span>
            <span className="lg-i">
              <b className="lg-fuel">F</b> Fuel
            </span>
            <span className="lg-i">
              <b className="lg-tire">T</b> Tires
            </span>
            <span className="lg-i">
              <b className="lg-drv">D</b> Driver
            </span>
            <span className="lg-i">
              <i className="lg-ev" /> Rain / incident
            </span>
            <span className="lg-i">
              <i className="lg-ver" /> Strategy change
            </span>
            <span className="lg-i">
              <i className="lg-call" /> Race call
            </span>
          </div>
          <div className="row gap-4" style={{ marginLeft: 'auto' }}>
            {headerRight}
            <button className="btn xs ghost" onClick={() => setZoom((z) => Math.max(1, z / 2))} disabled={zoom <= 1} title="Zoom out">
              <IconZoomOut size={13} />
            </button>
            <span className="mono dim" style={{ fontSize: 11, width: 26, textAlign: 'center' }}>
              {zoom}×
            </span>
            <button className="btn xs ghost" onClick={() => setZoom((z) => Math.min(16, z * 2))} title="Zoom in">
              <IconZoomIn size={13} />
            </button>
          </div>
        </div>
      )}
      <div className="tl-body">
        <div className="tl-lanes-labels">
          <div className="tl-axis-label" />
          {lanes.map((l) => (
            <div key={l.key} className="tl-lane-label label">
              {l.label}
            </div>
          ))}
          {!compact && <div className="tl-lane-label label sm">EVENTS</div>}
        </div>
        <div
          className="tl-scroll"
          ref={scroller}
          onWheel={(e) => {
            if (!zoomable || !e.ctrlKey) return;
            e.preventDefault();
            setZoom((z) => Math.max(1, Math.min(16, e.deltaY < 0 ? z * 2 : z / 2)));
          }}
        >
          <div className="tl-inner" style={{ width: `${zoom * 100}%` }}>
            <div className="tl-axis">
              {ticks.map((t) => (
                <span key={t} className="tick" style={{ left: `${axis === 'lap' ? (t / domain) * 100 : posSec(t)}%` }}>
                  {axis === 'lap' ? `L${t || 1}` : formatHM(t)}
                </span>
              ))}
            </div>
            {lanes.map((lane) => (
              <div key={lane.key} className="tl-lane">
                {ticks.map((t) => (
                  <span key={t} className="grid" style={{ left: `${(t / domain) * 100}%` }} />
                ))}
                {lane.data.blocks.map((b) => {
                  const { l, r } = bx(b);
                  const d = drv.get(b.driverId);
                  const w = Math.max(0.2, r - l);
                  const showT = fits(w, 26);
                  const showS = !compact && fits(w, 60);
                  return (
                    <button
                      key={`${lane.key}-${b.index}-${b.kind}`}
                      className={`tl-block ${b.kind} ${selected === b.index && lane.key === 'plan' ? 'sel' : ''} ${b.flag === 'LATE' ? 'late' : ''}`}
                      style={{ left: `${l}%`, width: `${w}%`, ['--drv' as string]: d?.color ?? 'var(--line-3)' }}
                      onClick={() => onSelect?.(b.index)}
                      title={`Stint ${b.index + 1} · ${d?.name ?? '—'} · L${b.startLap}–${b.endLap} (${b.laps} laps) · ${b.compound}${b.flag ? ' · ' + b.flag : ''}`}
                    >
                      {showT && (
                        <span className="tl-b-t">
                          S{b.index + 1}
                          {fits(w, 52) && <em>{d?.code ?? ''}</em>}
                        </span>
                      )}
                      {showS && (
                        <span className="tl-b-s">
                          {b.laps}L · {b.compound.slice(0, 1)}
                          {b.final ? ' · FLAG' : ''}
                        </span>
                      )}
                    </button>
                  );
                })}
                {lane.data.stops.map((s, i, all) => {
                  // icons sit right of the marker: only when they clear the next stop
                  const icons = (s.fuel ? 1 : 0) + (s.tires ? 1 : 0) + (s.driver ? 1 : 0);
                  const next = all[i + 1];
                  const room = next ? sx(next) - sx(s) : 100 - sx(s);
                  return (
                    <span key={`${lane.key}-stop-${i}`} className={`tl-stop ${s.kind}`} style={{ left: `${sx(s)}%` }} title={`${s.label}${s.fuel ? ' · fuel' : ''}${s.tires ? ' · tires' : ''}${s.driver ? ' · driver change' : ''}`}>
                      {icons > 0 && fits(room, icons * 12 + 6) && (
                        <span className="tl-stop-icons">
                          {s.fuel && <b className="lg-fuel">F</b>}
                          {s.tires && <b className="lg-tire">T</b>}
                          {s.driver && <b className="lg-drv">D</b>}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
            {!compact && (
              <div className="tl-lane events">
                {events.map((e) => {
                  const end = e.endedSec ?? e.startSec + e.durationSec;
                  const l = ex(e.startSec);
                  const r = ex(end);
                  return (
                    <span key={e.id} className={`tl-ev ${e.planned ? 'planned' : ''}`} style={{ left: `${l}%`, width: `${Math.max(0.3, r - l)}%` }} title={`${e.label} · ${formatHM(e.startSec)}–${formatHM(end)}`}>
                      {e.type === 'CUSTOM' ? 'INCIDENT' : e.type}
                    </span>
                  );
                })}
                {versions
                  .filter((v) => v.raceTimeSec != null && v.raceTimeSec > 0)
                  .map((v) => (
                    <span key={v.id} className="tl-ver" style={{ left: `${ex(v.raceTimeSec!)}%` }} title={`Strategy v${v.version} — ${v.label}`}>
                      v{v.version}
                    </span>
                  ))}
                {calls
                  .filter((c) => c.source !== 'event')
                  .map((c) => (
                    <span key={c.id} className={`tl-call p-${c.priority}`} style={{ left: `${axis === 'lap' ? posLap(c.lap) : posSec(c.raceTimeSec)}%` }} title={`L${c.lap} · ${c.text} (${c.status})`} />
                  ))}
              </div>
            )}
            {nowX != null && (
              <span className="tl-now" style={{ left: `${nowX}%` }} title={`Now · lap ${nowLap}`} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function niceStep(raw: number) {
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
  return steps.find((s) => s >= raw) ?? 1000;
}
function niceTimeStep(raw: number) {
  const steps = [60, 300, 600, 900, 1800, 3600, 7200, 10800];
  return steps.find((s) => s >= raw) ?? 21600;
}

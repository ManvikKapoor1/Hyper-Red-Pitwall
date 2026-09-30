import { useMemo, useState } from 'react';
import { formatDelta, formatLapMs } from '../../engine/format';
import { lapTrace, sliceTrace, type TracePoint, type TraceRange } from '../../engine/trace';
import type { CarEntry, Race } from '../../engine/types';
import { driverOf } from '../../lib/hooks';
import { useUnits } from '../../lib/units';
import { ChartLegend, LineChart, stepDecimals, type ChartMarker, type ChartSeries } from '../charts/LineChart';
import { Panel, Seg } from '../ui';

const RANGES: { value: TraceRange; label: string; title: string }[] = [
  { value: 'stint', label: 'Stint', title: 'Current stint only' },
  { value: 'last30', label: '30 laps', title: 'Last 30 laps' },
  { value: 'race', label: 'Race', title: 'Whole race' },
];

const MEASURED = 'var(--text-2)';
const ASSUMED = 'var(--muted)';

function markersFor(pts: TracePoint[], y: (t: TracePoint) => number | null): ChartMarker[] {
  const out: ChartMarker[] = [];
  for (const t of pts) {
    const v = y(t);
    if (t.green || v == null) continue;
    out.push({ x: t.lap, y: v, kind: t.pitIn ? 'pit' : 'event', label: t.pitIn ? 'Pit in-lap (excluded)' : `${t.event?.replace('_', ' ')} lap (excluded)` });
  }
  return out;
}

function stintLines(pts: TracePoint[]) {
  const out: { x: number; label: string }[] = [];
  for (let i = 1; i < pts.length; i++) if (pts[i].stint !== pts[i - 1].stint) out.push({ x: pts[i].lap - 0.5, label: `S${pts[i].stint + 1}` });
  return out;
}

/** Lap time, fuel/lap and energy/lap vs. the plan assumption — three charts, one axis each. */
export function LapTracePanel({ race, car, className = '' }: { race: Race; car: CarEntry; className?: string }) {
  const u = useUnits();
  const [range, setRange] = useState<TraceRange>('last30');
  const trace = useMemo(() => lapTrace(car, race.events), [car, race.events]);
  const pts = useMemo(() => sliceTrace(trace, range, car.live.stintIndex), [trace, range, car.live.stintIndex]);
  const vlines = stintLines(pts);
  const energy = car.setup.energyEnabled;
  const byLap = useMemo(() => new Map(pts.map((t) => [t.lap, t])), [pts]);
  const title = (x: number) => {
    const t = byLap.get(x);
    const d = t ? driverOf(car, t.driverId) : undefined;
    return (
      <>
        LAP {x}
        {t && <span className="dim"> · S{t.stint + 1} · {d?.code ?? ''}{t.estimated ? ' · EST.' : ''}</span>}
      </>
    );
  };
  const delta = (x: number, get: (t: TracePoint) => [number | null, number], fmt: (v: number) => string) => {
    const t = byLap.get(x);
    if (!t) return null;
    const [m, a] = get(t);
    if (m == null) return null;
    return <div className="lc-tip-d">Δ vs assumed {fmt(m - a)}</div>;
  };

  const lapSeries: ChartSeries[] = [
    { id: 'm', label: 'Measured', color: MEASURED, points: pts.map((t) => ({ x: t.lap, y: t.green ? t.lapMs : null })) },
    { id: 'a', label: 'Assumed', color: ASSUMED, dashed: true, points: pts.map((t) => ({ x: t.lap, y: t.green ? t.assumedLapMs : null })) },
  ];
  const fuelSeries: ChartSeries[] = [
    { id: 'm', label: 'Measured', color: MEASURED, points: pts.map((t) => ({ x: t.lap, y: t.green ? t.fuelUsedL : null })) },
    { id: 'a', label: 'Assumed', color: ASSUMED, dashed: true, step: true, points: pts.map((t) => ({ x: t.lap, y: t.green ? t.assumedFuelL : null })) },
  ];
  const energySeries: ChartSeries[] = [
    { id: 'm', label: 'Measured', color: 'var(--violet)', points: pts.map((t) => ({ x: t.lap, y: t.green ? t.energyUsedPct : null })) },
    { id: 'a', label: 'Assumed', color: ASSUMED, dashed: true, step: true, points: pts.map((t) => ({ x: t.lap, y: t.green ? t.assumedEnergyPct : null })) },
  ];
  const lapFmt = (ms: number) => u.lap(ms);

  return (
    <Panel
      className={`lap-trace ${className}`}
      title="Lap trace"
      bodyClass="tight"
      meta={
        <>
          <ChartLegend
            items={[
              { label: 'Measured', color: MEASURED },
              { label: 'Plan assumption', color: ASSUMED, dashed: true },
              { label: 'Pit lap', marker: 'pit' },
              { label: 'SC / slow-zone lap', marker: 'event' },
            ]}
          />
          <Seg className="xs" options={RANGES} value={range} onChange={setRange} />
        </>
      }
    >
      <div className={`lt-grid ${energy ? '' : 'two'}`}>
        <div className="lt-cell">
          <div className="lt-h">
            <span className="label">Lap time</span>
            <span className="sublabel">green laps · min:s</span>
          </div>
          <LineChart
            ariaLabel="Lap time per lap, measured versus plan assumption"
            series={lapSeries}
            markers={markersFor(pts, (t) => t.lapMs)}
            vlines={vlines}
            xInteger
            yFormat={lapFmt}
            yTick={(v, step) => formatLapMs(v, Math.min(3, Math.max(1, stepDecimals(step / 1000))) as 1 | 2 | 3)}
            tipTitle={title}
            tipExtra={(x) => delta(x, (t) => [t.green ? t.lapMs : null, t.assumedLapMs], (v) => `${formatDelta(v / 1000, 2)} s`)}
            empty="No laps recorded"
          />
        </div>
        <div className="lt-cell">
          <div className="lt-h">
            <span className="label">Fuel per lap</span>
            <span className="sublabel">{u.fuelUnit}</span>
          </div>
          <LineChart
            ariaLabel="Fuel used per lap, measured versus plan assumption"
            series={fuelSeries.map((s) => ({ ...s, points: s.points.map((p) => ({ x: p.x, y: p.y == null ? null : u.fuelVal(p.y) })) }))}
            markers={markersFor(pts, (t) => (t.fuelUsedL == null ? null : u.fuelVal(t.fuelUsedL)))}
            vlines={vlines}
            xInteger
            yFormat={(v) => v.toFixed(2)}
            tipTitle={title}
            tipExtra={(x) => delta(x, (t) => [t.green ? t.fuelUsedL : null, t.assumedFuelL], (v) => `${formatDelta(u.fuelVal(v), 2)} ${u.fuelUnit}`)}
            empty="No fuel readings"
          />
        </div>
        {energy && (
          <div className="lt-cell">
            <div className="lt-h">
              <span className="label c-violet">Energy per lap</span>
              <span className="sublabel">% of allocation</span>
            </div>
            <LineChart
              ariaLabel="Virtual energy used per lap, measured versus plan assumption"
              series={energySeries}
              markers={markersFor(pts, (t) => t.energyUsedPct)}
              vlines={vlines}
              xInteger
              yFormat={(v) => v.toFixed(1)}
              tipTitle={title}
              tipExtra={(x) => delta(x, (t) => [t.green ? t.energyUsedPct : null, t.assumedEnergyPct], (v) => `${formatDelta(v, 2)} %`)}
              empty="No energy readings"
            />
          </div>
        )}
      </div>
    </Panel>
  );
}

/** Table twin of the lap trace — the last laps as entered. */
export function RecentLaps({ car, className = '' }: { car: CarEntry; className?: string }) {
  const u = useUnits();
  const laps = car.live.laps.slice(-40).reverse();
  return (
    <Panel title="Recent laps" className={`recent-laps ${className}`} scroll bodyClass="flush" meta={<span className="sublabel">{car.live.laps.length} recorded</span>}>
      {laps.length === 0 ? (
        <div className="empty">No laps recorded yet.</div>
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th className="n">Lap</th>
              <th className="n">Time</th>
              <th className="n">Fuel</th>
              {car.setup.energyEnabled && <th className="n">Energy</th>}
              <th className="n">Tire</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {laps.map((l) => (
              <tr key={l.lap} className={l.estimated ? 'done' : ''} title={l.estimated ? 'Interpolated from a multi-lap update' : undefined}>
                <td className="n">{l.lap}</td>
                <td className="n">{u.lap(l.lapMs)}</td>
                <td className="n">{u.fuel(l.fuelUsedL, 2)}</td>
                {car.setup.energyEnabled && <td className="n">{u.pct(l.energyUsedPct, 2)}</td>}
                <td className="n">{l.tireAge}</td>
                <td className="dim" style={{ fontSize: 10.5 }}>
                  {l.pitIn ? 'PIT' : l.event ? l.event.replace('_', ' ') : l.estimated ? 'EST' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

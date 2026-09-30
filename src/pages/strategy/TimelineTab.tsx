import { useMemo, useState } from 'react';
import { actualStints } from '../../engine/analysis';
import { formatDelta, formatLapMs } from '../../engine/format';
import { blocksFromActual, blocksFromResult, StrategyTimeline } from '../../components/race/StrategyTimeline';
import { Panel, Seg } from '../../components/ui';
import { usePlanResult } from '../../lib/hooks';
import { useUnits } from '../../lib/units';
import { DriverChip } from '../../components/race/DriverChip';
import type { TabProps } from './shared';

export function TimelineTab({ race, car }: TabProps) {
  const u = useUnits();
  // plan vs actual: the plan simulated from lap 1, laid against what was driven
  const res = usePlanResult(race, car, { fromStart: true });
  const [axis, setAxis] = useState<'lap' | 'time'>('lap');
  const [sel, setSel] = useState(0);
  const plan = blocksFromResult(res);
  const done = useMemo(() => actualStints(car), [car]);
  const hasActual = done.length > 0;
  const actual = useMemo(() => (hasActual ? blocksFromActual(car) : undefined), [car, hasActual]);
  const nowLap = car.live.phase === 'racing' ? car.live.lapsCompleted + 1 : undefined;
  return (
    <div className="col gap-8">
      <Panel
        title={hasActual ? 'Plan vs actual' : 'Plan'}
        meta={<Seg className="xs" options={[{ value: 'lap' as const, label: 'Laps' }, { value: 'time' as const, label: 'Race time' }]} value={axis} onChange={setAxis} />}
        bodyClass="tight"
      >
        <StrategyTimeline
          car={car}
          blocks={plan.blocks}
          stops={plan.stops}
          actual={actual}
          totalLaps={Math.max(res.totalLaps, car.live.lapsCompleted)}
          totalSec={Math.max(res.finishSec, race.params.durationSec)}
          nowLap={axis === 'lap' ? nowLap : undefined}
          axis={axis}
          events={[...race.events, ...race.plannedEvents]}
          calls={car.live.calls}
          versions={car.versions}
          selected={sel}
          onSelect={setSel}
        />
      </Panel>
      <Panel title="Plan vs actual by stint" meta={<span className="sublabel">click a row or a timeline block to highlight · Δ = actual − plan</span>} bodyClass="flush">
        <table className="table">
          <thead>
            <tr>
              <th>Stint</th>
              <th>Driver (plan)</th>
              <th className="n">Laps plan</th>
              <th className="n">Laps actual</th>
              <th className="n">In-lap plan</th>
              <th className="n">In-lap actual</th>
              <th className="n">Avg lap plan</th>
              <th className="n">Avg lap actual</th>
              <th className="n">Δ avg lap</th>
              <th className="n">Fuel/lap plan</th>
              <th className="n">Fuel/lap actual</th>
              <th className="n">Δ fuel/lap</th>
            </tr>
          </thead>
          <tbody>
            {res.stints.map((pl) => {
              const a = done.find((x) => x.index === pl.index);
              const running = a && a.index === car.live.stintIndex && car.live.phase === 'racing';
              return (
                <tr key={pl.index} className={pl.index === sel ? 'sel' : ''} onClick={() => setSel(pl.index)} style={{ cursor: 'pointer' }}>
                  <td className="mono">S{pl.index + 1}</td>
                  <td>
                    <DriverChip car={car} id={pl.driverId} name />
                  </td>
                  <td className="n">{pl.laps}</td>
                  <td className="n">{a ? `${a.laps}${running ? ' …' : ''}` : '—'}</td>
                  <td className="n">{pl.final ? 'FLAG' : pl.endLap}</td>
                  <td className="n">{a && !running ? a.endLap : '—'}</td>
                  <td className="n">{formatLapMs(pl.avgLapMs)}</td>
                  <td className="n">{a ? formatLapMs(a.avgLapMs) : '—'}</td>
                  <td className="n">{a ? `${formatDelta((a.avgLapMs - pl.avgLapMs) / 1000, 2)} s` : '—'}</td>
                  <td className="n">{u.fpl(pl.fuelPerLapL)}</td>
                  <td className="n">{a ? u.fpl(a.fuelPerLapL) : '—'}</td>
                  <td className="n">{a ? formatDelta(u.fuelVal(a.fuelPerLapL - pl.fuelPerLapL), 2) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!hasActual && <div className="empty">No live data yet — actual values appear once laps are recorded.</div>}
      </Panel>
    </div>
  );
}

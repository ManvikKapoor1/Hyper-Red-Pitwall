import { useMemo } from 'react';
import { formatClock, formatDelta, formatLapMs } from '../../engine/format';
import { calculateTirePerformance, getCompound } from '../../engine/model';
import { tireOptions } from '../../engine/whatif';
import { LineChart } from '../../components/charts/LineChart';
import { Badge, Panel } from '../../components/ui';
import { useUnits } from '../../lib/units';
import { useStore } from '../../store/store';
import type { TabProps } from './shared';

export function TiresTab({ race, car, res }: TabProps) {
  const u = useUnits();
  const setPlan = useStore((s) => s.setPlan);
  const { setup } = car;
  const opts = useMemo(() => tireOptions(race.params, setup, car.plan, car.drivers), [race.params, setup, car.plan, car.drivers]);
  const maxAge = Math.max(...setup.compounds.map((c) => c.maxLife)) + 5;
  // each curve runs a few laps past its own max life; the axes are shared so compounds compare directly
  const curves = setup.compounds.map((c) => ({ c, points: Array.from({ length: Math.min(maxAge, c.maxLife + 5) + 1 }, (_, age) => ({ x: age, y: calculateTirePerformance(c, age) })) }));
  const yMax = Math.max(0.5, ...curves.map((k) => Math.max(...k.points.map((p) => p.y)))) * 1.08;
  const base = opts[0].result;
  const pattern = (p: typeof car.plan) => p.stints.map((s) => s.stop.changeTires).join();
  const samePattern = (i: number) => i > 0 && pattern(opts[i].plan) === pattern(car.plan);
  return (
    <div className="col gap-8">
      <Panel title="Degradation curves (entered)" meta={<span className="sublabel">pace loss vs tire age · same scale for every compound</span>}>
        <div className="deg-grid" style={{ gridTemplateColumns: `repeat(${Math.min(4, curves.length)}, minmax(0, 1fr))` }}>
          {curves.map(({ c, points }) => (
            <div key={c.name} className="lt-cell">
              <div className="lt-h">
                <span className="label">{c.name}</span>
                <span className="sublabel">
                  base {formatDelta(c.paceOffsetSec, 2)} s · {c.degSecPerLap} s/lap · cliff +{c.cliffSecPerLap} s/lap
                </span>
              </div>
              <LineChart
                height={190}
                ariaLabel={`${c.name} pace loss by tire age`}
                series={[{ id: c.name, label: 'Pace loss', color: 'var(--text-2)', points }]}
                vlines={[
                  { x: c.targetLife, label: 'TARGET', anchor: 'end' },
                  { x: c.maxLife, label: 'MAX' },
                ]}
                bands={[{ x0: c.maxLife, x1: maxAge }]}
                xDomain={[0, maxAge]}
                yDomain={[0, yMax]}
                xInteger
                yFormat={(v) => `+${v.toFixed(2)} s`}
                tipTitle={(x) => `AGE ${x} LAPS`}
              />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Tire strategy options" meta={<span className="sublabel">same stints, drivers and fuel — only the tire pattern changes · no option is ranked</span>} bodyClass="flush">
        <table className="table">
          <thead>
            <tr>
              <th>Option</th>
              <th>Pattern</th>
              <th className="n">Tire sets</th>
              <th className="n">Max age</th>
              <th className="n">Pit loss</th>
              <th className="n">Avg green lap</th>
              <th className="n">Laps</th>
              <th className="n">Finish</th>
              <th className="n">Δ pit loss vs A</th>
              <th>Plan check</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {opts.map((o, i) => {
              const r = o.result;
              const crit = r.issues.filter((x) => x.severity === 'critical');
              const warn = r.issues.filter((x) => x.severity === 'warning');
              const shown = crit.length ? crit : warn;
              return (
                <tr key={o.key} className={i === 0 ? 'cur' : ''}>
                  <td>
                    <b>{o.label}</b>
                  </td>
                  <td>
                    {o.description}
                    {samePattern(i) && <span className="dim"> · same as A</span>}
                  </td>
                  <td className="n">{r.tireSets}</td>
                  <td className="n">{r.maxTireAge}</td>
                  <td className="n">{u.n(r.totalPitLossSec, 1)} s</td>
                  <td className="n">{formatLapMs(r.avgGreenLapMs)}</td>
                  <td className="n">{r.totalLaps}</td>
                  <td className="n">{formatClock(r.finishSec)}</td>
                  <td className="n">{i === 0 ? '—' : `${formatDelta(r.totalPitLossSec - base.totalPitLossSec, 1)} s`}</td>
                  <td className={`ellipsis ${crit.length ? 'c-red' : warn.length ? 'c-amber' : 'dim'}`} style={{ maxWidth: 260 }} title={[...crit, ...warn].map((c) => c.message).join('\n')}>
                    {shown.length ? `${shown.length} ${crit.length ? 'critical' : `warning${shown.length > 1 ? 's' : ''}`} — ${shown[0].message}` : 'OK'}
                  </td>
                  <td className="right">
                    {i > 0 && !samePattern(i) && (
                      <button className="btn xs" onClick={() => setPlan(race.id, car.id, { ...o.plan, name: `${car.plan.name} · ${o.description.toLowerCase()}` })}>
                        Apply
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel title="Tires per stint" bodyClass="flush">
        <table className="table">
          <thead>
            <tr>
              <th>Stint</th>
              <th>Compound</th>
              <th>Set</th>
              <th className="n">Age start</th>
              <th className="n">Age end</th>
              <th className="n">Target / max</th>
              <th className="n">Pace loss at end</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {res.stints.map((s) => {
              const spec = getCompound(setup, s.compound);
              const over = s.tireAgeEnd > spec.maxLife ? 'red' : s.tireAgeEnd > spec.targetLife ? 'amber' : undefined;
              return (
                <tr key={s.index}>
                  <td className="mono">S{s.index + 1}</td>
                  <td>{s.compound}</td>
                  <td className={s.newTires || s.index === 0 ? '' : 'dim'}>{s.index === 0 ? (car.plan.startTireAge ? 'USED' : 'NEW') : s.newTires ? 'NEW' : 'CARRIED'}</td>
                  <td className="n">{s.tireAgeStart}</td>
                  <td className="n">{s.tireAgeEnd}</td>
                  <td className="n">
                    {spec.targetLife} / {spec.maxLife}
                  </td>
                  <td className="n">+{u.n(calculateTirePerformance(spec, s.tireAgeEnd), 2)} s</td>
                  <td>{over ? <Badge size="sm" color={over}>{over === 'red' ? 'Beyond max life' : 'Beyond target'}</Badge> : <span className="dim">Within target</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatClock } from '../../engine/format';
import { fuelSensitivity } from '../../engine/whatif';
import { LineChart } from '../../components/charts/LineChart';
import { Panel, Stat } from '../../components/ui';
import { useLiveSim } from '../../lib/hooks';
import { useUnits } from '../../lib/units';
import { marginClass } from '../../lib/margins';
import type { TabProps } from './shared';

const FUEL_PCTS = [-3, 0, 2, 5, 8];

export function FuelTab({ race, car, res }: TabProps) {
  const u = useUnits();
  const { setup } = car;
  const reserveL = setup.fuelReserveLaps * setup.fuelPerLapL;
  const sim = useLiveSim(race, car);
  const live = !!sim;
  const rows = useMemo(() => fuelSensitivity(race.params, setup, car.plan, car.drivers, FUEL_PCTS, sim), [race.params, setup, car.plan, car.drivers, sim]);
  // projection from the lap being driven; live races also show the recorded laps
  const levels = useMemo(() => [{ x: res.startLap - 1, y: u.fuelVal(res.stints[0]?.fuelStartL ?? 0) }, ...res.laps.map((l) => ({ x: l.lap, y: u.fuelVal(l.fuelAfterL) }))], [res, u]);
  const recorded = useMemo(() => (live ? car.live.laps.map((l) => ({ x: l.lap, y: u.fuelVal(l.fuelAfterL) })) : []), [live, car.live.laps, u]);
  const first = res.stints[0]?.index;
  return (
    <div className="col gap-8">
      <div className="stat-row">
        <Stat k="Capacity" v={u.fuel(setup.fuelCapacityL, 0)} u={u.fuelUnit} />
        <Stat k="Per lap (entered)" v={u.fpl(setup.fuelPerLapL)} u={`${u.fuelUnit}/lap`} h={<span className="tag-assumption">ASSUMPTION</span>} />
        <Stat k="Planning reserve" v={u.n(setup.fuelReserveLaps, 1)} u="laps" h={`≈ ${u.fuelU(reserveL)} kept at each stop`} />
        <Stat k="Safety margin" v={u.n(setup.fuelSafetyMarginLaps, 1)} u="laps" h="theoretical → safe laps" />
        <Stat k={live ? 'Used to flag' : 'Total used'} v={u.fuel(res.fuelUsedL, 0)} u={u.fuelUnit} />
        <Stat k={live ? 'Still to add' : 'Total added'} v={u.fuel(res.fuelAddedL, 0)} u={u.fuelUnit} />
        <Stat k="Min margin" v={<span className={marginClass(res.minFuelMarginLaps)}>{u.n(res.minFuelMarginLaps, 2)}</span>} u="laps" />
        <Link className="btn sm ghost" style={{ alignSelf: 'center', marginLeft: 'auto' }} to={`/app/race/${race.id}/setup`}>
          Edit fuel inputs
        </Link>
      </div>

      <Panel title="Fuel in tank" meta={<span className="sublabel">end of each lap · calculated</span>}>
        <LineChart
          height={240}
          ariaLabel="Fuel in tank at the end of each lap"
          series={[...(live ? [{ id: 'rec', label: 'Recorded', color: 'var(--muted)', points: recorded }] : []), { id: 'fuel', label: live ? 'Projected' : 'Fuel in tank', color: 'var(--text-2)', points: levels }]}
          hlines={[
            { y: u.fuelVal(setup.fuelCapacityL), label: 'CAPACITY' },
            { y: u.fuelVal(reserveL), label: 'RESERVE', color: 'var(--amber)' },
          ]}
          vlines={res.stops.map((s) => ({ x: s.lap + 0.5, label: `P${s.index + 1}` }))}
          zero
          xInteger
          yFormat={(v) => `${v.toFixed(1)} ${u.fuelUnit}`}
          yTick={(v) => v.toFixed(0)}
          tipTitle={(x) => `LAP ${x}`}
        />
      </Panel>

      <div className="grid-2">
        <Panel title="Per stint" bodyClass="flush">
          <table className="table">
            <thead>
              <tr>
                <th>Stint</th>
                <th className="n">Laps</th>
                <th className="n">Start</th>
                <th className="n">Added before</th>
                <th className="n">Used</th>
                <th className="n">Per lap</th>
                <th className="n">At stop</th>
                <th className="n">Margin</th>
              </tr>
            </thead>
            <tbody>
              {res.stints.map((s) => (
                <tr key={s.index}>
                  <td className="mono">S{s.index + 1}</td>
                  <td className="n">{live && s.index === first ? `${s.endLap - s.fromLap + 1} left` : s.laps}</td>
                  <td className="n">{u.fuel(s.fuelStartL)}{live && s.index === first ? ' now' : ''}</td>
                  <td className="n">{s.index === first ? '—' : u.fuel(s.fuelAddedL)}</td>
                  <td className="n">{u.fuel(s.fuelUsedL)}</td>
                  <td className="n">{u.fpl(s.fuelPerLapL)}</td>
                  <td className="n">{u.fuel(s.fuelEndL)}</td>
                  <td className={`n ${marginClass(s.fuelMarginLaps)}`}>{u.n(s.fuelMarginLaps, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Sensitivity — fuel per lap" meta={<span className="sublabel">same plan, {live ? 'measured' : 'entered'} consumption scaled</span>} bodyClass="flush">
          <table className="table">
            <thead>
              <tr>
                <th>Change</th>
                <th className="n">Fuel/lap</th>
                <th className="n">Laps</th>
                <th className="n">Finish</th>
                <th className="n">Min margin</th>
                <th>Plan check</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const crit = r.result.issues.filter((i) => i.severity === 'critical');
                return (
                  <tr key={r.key} className={r.label.startsWith('As ') ? 'cur' : ''}>
                    <td>{r.label}</td>
                    <td className="n">{u.fpl(r.input)}</td>
                    <td className="n">{r.result.totalLaps}</td>
                    <td className="n">{formatClock(r.result.finishSec)}</td>
                    <td className={`n ${marginClass(r.result.minFuelMarginLaps)}`}>{u.n(r.result.minFuelMarginLaps, 2)}</td>
                    <td className={crit.length ? 'c-red ellipsis' : 'dim'} style={{ maxWidth: 260 }} title={crit.map((c) => c.message).join('\n')}>
                      {crit.length ? crit[0].message : 'OK'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}

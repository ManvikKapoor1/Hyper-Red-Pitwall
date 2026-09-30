import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatClock } from '../../engine/format';
import { netEnergyPerLap } from '../../engine/model';
import { energySensitivity } from '../../engine/whatif';
import { LineChart } from '../../components/charts/LineChart';
import { Panel, Stat } from '../../components/ui';
import { useUnits } from '../../lib/units';
import { marginClass } from '../../lib/margins';
import { MODE_LABEL } from '../../lib/labels';
import type { TabProps } from './shared';
import type { DriveMode } from '../../engine/types';

const ENERGY_PCTS = [-3, 0, 2, 5, 8];

export function EnergyTab({ race, car, res }: TabProps) {
  const u = useUnits();
  const { setup } = car;
  const rows = useMemo(() => (setup.energyEnabled ? energySensitivity(race.params, setup, car.plan, car.drivers, ENERGY_PCTS) : []), [race.params, setup, car.plan, car.drivers]);
  const levels = useMemo(() => [{ x: 0, y: res.stints[0]?.energyStartPct ?? 0 }, ...res.laps.map((l) => ({ x: l.lap, y: l.energyAfterPct }))], [res]);
  if (!setup.energyEnabled)
    return (
      <div className="notice">
        Virtual energy tracking is disabled for this car. Enable it in <Link to={`/app/race/${race.id}/setup`}>Race Setup → Energy</Link> to plan energy per stint.
      </div>
    );
  return (
    <div className="col gap-8">
      <div className="stat-row">
        <Stat k="Allocation" v={u.n(setup.energyCapacityPct, 0)} u="%" color="violet" />
        <Stat k="Per lap (entered)" v={u.n(setup.energyPerLapPct, 2)} u="%" h={<span className="tag-assumption">ASSUMPTION</span>} />
        <Stat k="Recovery per lap" v={u.n(setup.energyRecoveryPerLapPct, 2)} u="%" h={`net ${u.n(netEnergyPerLap(setup), 2)} %/lap`} />
        <Stat k="Reserve" v={u.n(setup.energyReservePct, 1)} u="%" />
        <Stat k="Stint target" v={u.n(setup.energyTargetPerStintPct, 0)} u="%" h={setup.energyDeployTarget} />
        <Stat k="Total used" v={u.n(res.energyUsedPct, 0)} u="%" />
        <Stat k="Min margin" v={<span className={marginClass(res.minEnergyMarginLaps)}>{u.n(res.minEnergyMarginLaps, 2)}</span>} u="laps" />
        <Link className="btn sm ghost" style={{ alignSelf: 'center', marginLeft: 'auto' }} to={`/app/race/${race.id}/setup`}>
          Edit energy inputs
        </Link>
      </div>

      <Panel title={<span className="label c-violet">Virtual energy remaining</span>} meta={<span className="sublabel">end of each lap · calculated</span>}>
        <LineChart
          height={240}
          ariaLabel="Virtual energy remaining at the end of each lap"
          series={[{ id: 'energy', label: 'Energy', color: 'var(--violet)', points: levels }]}
          hlines={[{ y: setup.energyReservePct, label: 'RESERVE', color: 'var(--amber)' }]}
          vlines={res.stops.map((s) => ({ x: s.lap + 0.5, label: `P${s.index + 1}` }))}
          yDomain={[0, Math.max(100, setup.energyCapacityPct)]}
          xInteger
          yFormat={(v) => `${v.toFixed(1)} %`}
          yTick={(v) => v.toFixed(0)}
          tipTitle={(x) => `LAP ${x}`}
        />
      </Panel>

      <div className="grid-3">
        <Panel title="Per stint" bodyClass="flush" className="span-2">
          <table className="table">
            <thead>
              <tr>
                <th>Stint</th>
                <th>Mode</th>
                <th className="n">Laps</th>
                <th className="n">Start</th>
                <th className="n">Added before</th>
                <th className="n">Used</th>
                <th className="n">Per lap</th>
                <th className="n">Budget</th>
                <th className="n">At stop</th>
                <th className="n">Margin</th>
              </tr>
            </thead>
            <tbody>
              {res.stints.map((s) => (
                <tr key={s.index}>
                  <td className="mono">S{s.index + 1}</td>
                  <td>{MODE_LABEL[s.mode]}</td>
                  <td className="n">{s.laps}</td>
                  <td className="n">{u.pct(s.energyStartPct)}</td>
                  <td className="n">{s.index === 0 ? '—' : u.pct(s.energyAddedPct)}</td>
                  <td className="n">{u.pct(s.energyUsedPct)}</td>
                  <td className="n">{u.n(s.energyPerLapPct, 2)}</td>
                  <td className="n">{s.energyTargetPct != null ? u.pct(s.energyTargetPct) : '—'}</td>
                  <td className="n">{u.pct(s.energyEndPct)}</td>
                  <td className={`n ${marginClass(s.energyMarginLaps)}`}>{u.n(s.energyMarginLaps, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <div className="col gap-8">
          <Panel title="Drive-mode effects (entered)" bodyClass="flush">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th className="n">Energy</th>
                  <th className="n">Fuel</th>
                  <th className="n">Lap</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(setup.modes) as DriveMode[]).map((m) => (
                  <tr key={m}>
                    <td>{MODE_LABEL[m]}</td>
                    <td className="n">{signed(setup.modes[m].energyPct)} %</td>
                    <td className="n">{signed(setup.modes[m].fuelPct)} %</td>
                    <td className="n">{signed(setup.modes[m].lapSec)} s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="Sensitivity — energy per lap" bodyClass="flush">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Change</th>
                  <th className="n">%/lap</th>
                  <th className="n">Finish</th>
                  <th className="n">Min margin</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className={r.label === 'As entered' ? 'cur' : ''}>
                    <td>{r.label}</td>
                    <td className="n">{u.n(r.input, 2)}</td>
                    <td className="n">{formatClock(r.result.finishSec)}</td>
                    <td className={`n ${marginClass(r.result.minEnergyMarginLaps)}`}>{u.n(r.result.minEnergyMarginLaps, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function signed(v: number) {
  return v > 0 ? `+${v}` : `${v}`;
}

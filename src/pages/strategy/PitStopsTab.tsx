import { Link } from 'react-router-dom';
import { formatClock } from '../../engine/format';
import { calculatePitLoss, TEMPLATE_LABEL } from '../../engine/model';
import { applyTemplate } from '../../engine/planner';
import type { PitTemplate } from '../../engine/types';
import { CONCURRENCY } from '../../lib/labels';
import { Panel } from '../../components/ui';
import { useUnits } from '../../lib/units';
import { useStore } from '../../store/store';
import { DriverChip } from '../../components/race/DriverChip';
import type { TabProps } from './shared';

const TEMPLATES: { t: PitTemplate; fuel: boolean; tires: boolean; driver: boolean; extra?: number; note: string }[] = [
  { t: 'FUEL_ONLY', fuel: true, tires: false, driver: false, note: 'Refuel, same driver, same tires' },
  { t: 'FUEL_TIRES', fuel: true, tires: true, driver: false, note: 'Refuel + new set' },
  { t: 'FUEL_DRIVER', fuel: true, tires: false, driver: true, note: 'Refuel + driver swap' },
  { t: 'FUEL_TIRES_DRIVER', fuel: true, tires: true, driver: true, note: 'Full service' },
  { t: 'DRIVER_ONLY', fuel: false, tires: false, driver: true, note: 'Driver swap without fuel' },
  { t: 'EMERGENCY', fuel: true, tires: false, driver: false, extra: 10, note: 'Unplanned — extra work time entered per stop' },
  { t: 'CUSTOM', fuel: true, tires: false, driver: false, note: 'Any combination, set per stop' },
];


export function PitStopsTab({ race, car, res }: TabProps) {
  const u = useUnits();
  const setPlan = useStore((s) => s.setPlan);
  const { setup } = car;
  const exampleFuel = Math.round(setup.fuelPerLapL * 25);
  return (
    <div className="grid-side">
      <Panel title={car.live.phase === 'racing' ? 'Remaining stops' : 'Planned stops'} bodyClass="flush" className="scroll-x" meta={<span className="sublabel">{res.stops.length} stops · {u.n(res.totalPitLossSec, 1)} s total loss{car.live.phase === 'racing' ? ` · ${car.live.stops.length} made` : ''}</span>}>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th className="n">In-lap</th>
              <th className="n">Race time</th>
              <th style={{ width: 190 }}>Template</th>
              <th className="n">Fuel +</th>
              {setup.energyEnabled && <th className="n">Energy +</th>}
              <th>Tires</th>
              <th>Driver</th>
              <th className="n">Fuel s</th>
              <th className="n">Tires s</th>
              <th className="n">Driver s</th>
              <th className="n">Extra s</th>
              <th className="n">Stationary</th>
              <th className="n">Lane</th>
              <th className="n">Total loss</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {res.stops.map((s) => (
              <tr key={s.index}>
                <td className="mono">P{s.index + 1}</td>
                <td className="n">{s.lap}</td>
                <td className="n">{formatClock(s.entrySec)}</td>
                <td>
                  <select className="select sm" value={car.plan.stints[s.afterStint]?.stop.template ?? s.template} onChange={(e) => setPlan(race.id, car.id, applyTemplate(car.plan, s.afterStint, e.target.value as PitTemplate, car.drivers))} aria-label={`Stop ${s.index + 1} template`}>
                    {TEMPLATES.map((x) => (
                      <option key={x.t} value={x.t}>
                        {TEMPLATE_LABEL[x.t]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="n">{u.fuel(s.fuelAddedL)}</td>
                {setup.energyEnabled && <td className="n">{u.n(s.energyAddedPct, 1)}</td>}
                <td className={s.changeTires ? '' : 'dim'}>{s.changeTires ? `NEW ${s.compound}` : 'NO'}</td>
                <td>
                  {s.driverChange ? (
                    <span className="row gap-4">
                      <DriverChip car={car} id={s.fromDriverId} /> → <DriverChip car={car} id={s.toDriverId} />
                    </span>
                  ) : (
                    <span className="dim">NO</span>
                  )}
                </td>
                <td className="n">{u.n(s.fuelSec, 1)}</td>
                <td className="n">{u.n(s.tireSec, 1)}</td>
                <td className="n">{u.n(s.driverSec, 1)}</td>
                <td className="n">{u.n(s.extraSec, 1)}</td>
                <td className="n">{u.n(s.stationarySec, 1)}</td>
                <td className="n">{u.n(s.laneSec, 1)}</td>
                <td className="n">
                  <b>{u.n(s.totalLossSec, 1)}</b>
                </td>
                <td className="ellipsis" style={{ maxWidth: 220 }} title={s.reason}>
                  {s.reason}
                  {s.underEvent && <span className="c-amber"> · under {s.underEvent.replace('_', ' ')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <div className="col gap-8">
        <Panel title="Pit settings (entered)" meta={<Link className="btn xs ghost" to={`/app/race/${race.id}/setup`}>Edit</Link>}>
          <div className="kv">
            <span className="k">Pit-lane loss</span>
            <span className="v">{u.n(setup.pitLaneLossSec, 1)} s</span>
            <span className="k">Refuel rate</span>
            <span className="v">
              {u.n(u.fuelVal(setup.refuelRateLps), 2)} {u.fuelUnit}/s
            </span>
            <span className="k">Tire change</span>
            <span className="v">{u.n(setup.tireChangeSec, 1)} s</span>
            <span className="k">Driver change</span>
            <span className="v">{u.n(setup.driverChangeSec, 1)} s</span>
            <span className="k">Service order</span>
            <span className="v l">{CONCURRENCY.find((c) => c.value === setup.concurrency)?.title}</span>
          </div>
        </Panel>
        <Panel title="Stop templates" meta={<span className="sublabel">example: {u.fuelU(exampleFuel, 0)} refuel</span>} bodyClass="flush">
          <table className="table compact">
            <thead>
              <tr>
                <th>Template</th>
                <th className="n">Stationary</th>
                <th className="n">Total</th>
              </tr>
            </thead>
            <tbody>
              {TEMPLATES.map((x) => {
                const loss = calculatePitLoss(setup, { fuelAddedL: x.fuel ? exampleFuel : 0, changeTires: x.tires, driverChange: x.driver, extraSec: x.extra });
                return (
                  <tr key={x.t} title={x.note}>
                    <td>
                      <div>{TEMPLATE_LABEL[x.t]}</div>
                      <div className="sublabel">{x.note}</div>
                    </td>
                    <td className="n">{u.n(loss.stationarySec, 1)} s</td>
                    <td className="n">{u.n(loss.totalSec, 1)} s</td>
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

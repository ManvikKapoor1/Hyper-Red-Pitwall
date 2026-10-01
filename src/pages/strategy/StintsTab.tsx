import { formatClock, formatDurationShort, formatLapMs } from '../../engine/format';
import { updateStint } from '../../engine/planner';
import type { DriveMode } from '../../engine/types';
import { NumInput, Panel } from '../../components/ui';
import { actualStints } from '../../engine/analysis';
import { isLive } from '../../lib/hooks';
import { useUnits } from '../../lib/units';
import { useStore } from '../../store/store';
import { DriverChip } from '../../components/race/DriverChip';
import { marginClass } from '../../lib/margins';
import { DRIVE_MODES } from '../../lib/labels';
import { flagClass, limiterText, type TabProps } from './shared';

export function StintsTab({ race, car, res }: TabProps) {
  const u = useUnits();
  const setPlan = useStore((s) => s.setPlan);
  const plan = car.plan;
  const energy = car.setup.energyEnabled;
  const byIndex = new Map(res.stints.map((s) => [s.index, s]));
  const set = (i: number, patch: Parameters<typeof updateStint>[2]) => setPlan(race.id, car.id, updateStint(plan, i, patch));
  // live: driven stints are history; driver totals are what was driven plus what is projected
  const live = isLive(car);
  const cur = live ? car.live.stintIndex : -1;
  const driven = live ? actualStints(car) : [];
  const done = new Map(driven.filter((a) => a.index < cur).map((a) => [a.index, a]));
  const lapEnd = new Map(car.live.laps.map((l) => [l.lap, l.endSec]));
  const drivers = car.drivers.map((d) => {
    const act = driven.filter((a) => a.driverId === d.id);
    const stints = new Set([...act.map((a) => a.index), ...res.stints.filter((x) => x.driverId === d.id).map((x) => x.index)]).size;
    const laps = act.reduce((a, x) => a + x.laps, 0) + res.laps.filter((l) => l.driverId === d.id).length;
    const sec = act.reduce((a, x) => a + (x.endSec - x.startSec), 0) + (res.driverTimeSec[d.id] ?? 0);
    return { d, stints, laps, sec };
  });
  const totalDriverSec = drivers.reduce((a, x) => a + x.sec, 0) || 1;
  return (
    <div className="col gap-8">
      <Panel title="Stint planner" meta={<span className="sublabel">driver, laps and mode are editable · everything else is calculated</span>} bodyClass="flush" className="scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th>Stint</th>
              <th style={{ width: 170 }}>Driver</th>
              <th className="n" style={{ width: 80 }}>Target</th>
              <th style={{ width: 120 }}>Mode</th>
              <th className="n">Laps</th>
              <th className="n">From–to</th>
              <th className="n">Start</th>
              <th className="n">End</th>
              <th className="n">Avg lap</th>
              <th className="n">Fuel start</th>
              <th className="n">Fuel/lap</th>
              <th className="n">Fuel end</th>
              <th className="n">Fuel margin</th>
              {energy && <th className="n">Energy/lap</th>}
              {energy && <th className="n">Energy margin</th>}
              <th>Tires</th>
              <th>Limit</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {plan.stints.map((st, i) => {
              const s = byIndex.get(i);
              const a = done.get(i);
              const last = i === plan.stints.length - 1;
              const isCur = i === cur;
              // the stint being driven started before the projection: show its real start
              const startSec = isCur ? (lapEnd.get(car.live.stintStartLap - 1) ?? 0) : s?.startSec ?? 0;
              const fuelStart = isCur ? car.live.stintStartFuelL : s?.fuelStartL ?? 0;
              const ageStart = isCur && s ? s.tireAgeEnd - s.laps : s?.tireAgeStart ?? 0;
              return (
                <tr key={st.id} className={s ? '' : 'done'}>
                  <td className="mono">S{i + 1}</td>
                  <td>
                    <select className="select sm" value={st.driverId} disabled={i < cur} onChange={(e) => set(i, { driverId: e.target.value })} aria-label={`Stint ${i + 1} driver`}>
                      {car.drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code} — {d.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="n">{last ? <span className="dim">FLAG</span> : <NumInput size="sm" value={st.targetLaps} decimals={0} min={1} disabled={i < cur} onChange={(v) => set(i, { targetLaps: Math.round(v) })} />}</td>
                  <td>
                    <select className="select sm" value={st.mode} disabled={i < cur} onChange={(e) => set(i, { mode: e.target.value as DriveMode })} aria-label={`Stint ${i + 1} mode`}>
                      {DRIVE_MODES.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  {s ? (
                    <>
                      <td className="n">{s.laps}</td>
                      <td className="n">
                        {s.startLap}–{s.endLap}
                      </td>
                      <td className="n">{formatClock(startSec)}</td>
                      <td className="n">{formatClock(s.endSec)}</td>
                      <td className="n">{formatLapMs(s.avgLapMs)}</td>
                      <td className="n">{u.fuel(fuelStart)}</td>
                      <td className="n">{u.fpl(s.fuelPerLapL)}</td>
                      <td className="n">{u.fuel(s.fuelEndL)}</td>
                      <td className={`n ${marginClass(s.fuelMarginLaps)}`}>{u.n(s.fuelMarginLaps, 1)}</td>
                      {energy && <td className="n">{u.n(s.energyPerLapPct, 2)}</td>}
                      {energy && <td className={`n ${marginClass(s.energyMarginLaps)}`}>{u.n(s.energyMarginLaps, 1)}</td>}
                      <td className={s.newTires ? '' : 'dim'}>
                        {s.compound} {ageStart}→{s.tireAgeEnd}
                      </td>
                      <td className="dim">{limiterText(s)}</td>
                      <td className={flagClass(s.flag)}>{s.final ? 'FINAL' : s.flag}</td>
                    </>
                  ) : a ? (
                    <td colSpan={energy ? 14 : 12} className="dim">
                      Driven — L{a.startLap}–{a.endLap} ({a.laps} laps) · avg {formatLapMs(a.avgLapMs || null)} · {u.fpl(a.fuelPerLapL)} {u.fuelUnit}/lap · {a.compound} → {a.tireAgeEnd}
                    </td>
                  ) : (
                    <td colSpan={energy ? 14 : 12} className="c-amber">
                      Not reached — the race ends before this stint
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>

      <Panel title="Driver time" meta={<span className="sublabel">{live ? 'driven so far + projected' : 'calculated from the plan'} · check regulations for min / max drive time yourself</span>} bodyClass="flush">
        <table className="table">
          <thead>
            <tr>
              <th>Driver</th>
              <th className="n">Stints</th>
              <th className="n">Laps</th>
              <th className="n">Drive time</th>
              <th className="n">Share</th>
              <th style={{ width: '40%' }} />
              <th className="n">Max stint (entered)</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map(({ d, stints, laps, sec }) => {
              const share = (sec / totalDriverSec) * 100;
              return (
                <tr key={d.id}>
                  <td>
                    <DriverChip car={car} id={d.id} name />
                  </td>
                  <td className="n">{stints}</td>
                  <td className="n">{laps}</td>
                  <td className="n">{formatClock(sec)}</td>
                  <td className="n">{u.n(share, 1)} %</td>
                  <td>
                    <div className="share-bar" title={`${formatDurationShort(sec)} of driving`}>
                      <i style={{ width: `${share}%`, background: d.color }} />
                    </div>
                  </td>
                  <td className="n">{d.maxStintLaps ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

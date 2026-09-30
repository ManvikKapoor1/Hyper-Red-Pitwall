import { useMemo } from 'react';
import { RaceContextBar, RaceNotFound } from '../components/race/RaceContextBar';
import { postRaceSummary } from '../engine/analysis';
import { formatClock, formatDelta, formatLapMs } from '../engine/format';
import { lapTrace } from '../engine/trace';
import type { CarEntry, Race } from '../engine/types';
import { LineChart, ChartLegend } from '../components/charts/LineChart';
import { blocksFromActual, blocksFromResult, StrategyTimeline } from '../components/race/StrategyTimeline';
import { Panel, Stat } from '../components/ui';
import { activeCar, useRaceFromRoute } from '../lib/hooks';
import { useUnits } from '../lib/units';
import { DriverChip } from '../components/race/DriverChip';

export function AnalysisPage() {
  const race = useRaceFromRoute();
  if (!race) return <RaceNotFound />;
  return <Analysis race={race} car={activeCar(race)} />;
}

function Analysis({ race, car }: { race: Race; car: CarEntry }) {
  const u = useUnits();
  const sum = useMemo(() => postRaceSummary(race, car), [race, car]);
  // dashed "plan" lines use the planned version, not the (possibly edited) current plan
  const trace = useMemo(() => {
    const v = car.versions[0];
    return lapTrace(v ? { ...car, setup: v.setup, plan: v.plan } : car, race.events);
  }, [car, race.events]);
  const plan = blocksFromResult(sum.planned);
  const actual = useMemo(() => blocksFromActual(car), [car]);
  const vlines = sum.stints.slice(1).map((s) => ({ x: s.startLap - 0.5, label: `S${s.index + 1}` }));
  const lastLap = car.live.laps[car.live.laps.length - 1]?.lap ?? 0;
  const lapAt = (sec: number) => car.live.laps.find((l) => l.endSec >= sec)?.lap ?? lastLap;
  const bands = race.events.map((e) => ({ x0: lapAt(e.startSec) - 0.5, x1: lapAt(e.endedSec ?? e.startSec + e.durationSec) + 0.5 }));
  const hasData = car.live.laps.length > 0;
  return (
    <>
      <RaceContextBar race={race}>
        <span className="sublabel">Planned = strategy v{sum.plannedVersion} · actual = recorded laps and stops</span>
      </RaceContextBar>
      <div className="page full">
        {!sum.finished && hasData && <div className="notice amber mb-8">Race not finished — analysis covers the {sum.lapsCompleted} laps recorded so far.</div>}
        {!hasData ? (
          <div className="notice">No laps recorded for #{car.number} yet. Analysis fills in from the live race data.</div>
        ) : (
          <div className="col gap-8">
            <div className="stat-row">
              <Stat k="Duration" v={formatClock(sum.durationSec)} size="lg" />
              <Stat k="Laps" v={sum.lapsCompleted} size="lg" h={`planned ${sum.projectedLaps}`} />
              <Stat k="Stops" v={sum.stops} size="lg" h={`planned ${sum.planned.stops.length}`} />
              <Stat k="Pit time" v={u.n(sum.totalPitSec, 0)} u="s" size="lg" h={`${u.n(sum.totalStationarySec, 0)} s stationary`} />
              <Stat k="Fuel used" v={u.fuel(sum.fuelUsedL, 0)} u={u.fuelUnit} size="lg" h={`${u.fpl(sum.avgFuelPerLapL)} ${u.fuelUnit}/lap`} />
              {car.setup.energyEnabled && <Stat k="Energy used" v={u.n(sum.energyUsedPct, 0)} u="%" size="lg" />}
              <Stat k="Tire sets" v={sum.tireSets} size="lg" />
              <Stat k="Strategy changes" v={sum.strategyChanges} size="lg" />
              <Stat k="Calls" v={sum.calls} size="lg" />
            </div>

            <Panel title="Planned vs actual" bodyClass="tight">
              <StrategyTimeline
                car={car}
                blocks={plan.blocks}
                stops={plan.stops}
                actual={actual}
                totalLaps={Math.max(sum.planned.totalLaps, sum.lapsCompleted)}
                totalSec={Math.max(sum.planned.finishSec, sum.durationSec)}
                events={race.events}
                calls={car.live.calls}
                versions={car.versions}
                labels={{ plan: `PLAN v${sum.plannedVersion}` }}
              />
            </Panel>

            <div className="grid-2">
              <Panel
                title="Lap time"
                meta={
                  <ChartLegend
                    items={[
                      { label: 'Measured', color: 'var(--text-2)' },
                      { label: 'Plan assumption', color: 'var(--muted)', dashed: true },
                    ]}
                  />
                }
              >
                <LineChart
                  height={230}
                  ariaLabel="Lap time per lap across the race"
                  series={[
                    { id: 'm', label: 'Measured', color: 'var(--text-2)', points: trace.map((t) => ({ x: t.lap, y: t.green ? t.lapMs : null })) },
                    { id: 'a', label: 'Assumed', color: 'var(--muted)', dashed: true, points: trace.map((t) => ({ x: t.lap, y: t.green ? t.assumedLapMs : null })) },
                  ]}
                  vlines={vlines}
                  bands={bands}
                  xInteger
                  yFormat={(v) => u.lap(v)}
                  yTick={(v) => formatLapMs(v, 1)}
                  tipTitle={(x) => `LAP ${x}`}
                />
              </Panel>
              <Panel
                title="Fuel per lap"
                meta={
                  <ChartLegend
                    items={[
                      { label: 'Measured', color: 'var(--text-2)' },
                      { label: 'Plan assumption', color: 'var(--muted)', dashed: true },
                    ]}
                  />
                }
              >
                <LineChart
                  height={230}
                  ariaLabel="Fuel used per lap across the race"
                  series={[
                    { id: 'm', label: 'Measured', color: 'var(--text-2)', points: trace.map((t) => ({ x: t.lap, y: t.green && t.fuelUsedL != null ? u.fuelVal(t.fuelUsedL) : null })) },
                    { id: 'a', label: 'Assumed', color: 'var(--muted)', dashed: true, step: true, points: trace.map((t) => ({ x: t.lap, y: t.green ? u.fuelVal(t.assumedFuelL) : null })) },
                  ]}
                  vlines={vlines}
                  bands={bands}
                  xInteger
                  yFormat={(v) => `${v.toFixed(2)} ${u.fuelUnit}`}
                  tipTitle={(x) => `LAP ${x}`}
                />
              </Panel>
            </div>

            <Panel title="Stints — planned vs actual" bodyClass="flush" className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>Stint</th>
                    <th>Driver</th>
                    <th className="n">Laps plan</th>
                    <th className="n">Laps actual</th>
                    <th className="n">In-lap plan</th>
                    <th className="n">In-lap actual</th>
                    <th className="n">Δ in-lap</th>
                    <th className="n">Avg lap plan</th>
                    <th className="n">Avg lap actual</th>
                    <th className="n">Best</th>
                    <th className="n">Fuel/lap plan</th>
                    <th className="n">Fuel/lap actual</th>
                    <th>Tires</th>
                  </tr>
                </thead>
                <tbody>
                  {sum.comparison.map((c) => (
                    <tr key={c.index} className={c.actual ? '' : 'done'}>
                      <td className="mono">S{c.index + 1}</td>
                      <td>{c.actual ? <DriverChip car={car} id={c.actual.driverId} name /> : c.planned ? <DriverChip car={car} id={c.planned.driverId} name /> : '—'}</td>
                      <td className="n">{c.planned?.laps ?? '—'}</td>
                      <td className="n">{c.actual?.laps ?? '—'}</td>
                      <td className="n">{c.planned ? (c.planned.final ? 'FLAG' : c.planned.endLap) : '—'}</td>
                      <td className="n">{c.actual?.endLap ?? '—'}</td>
                      <td className="n">{c.pitLapDelta != null ? formatDelta(c.pitLapDelta, 0) : '—'}</td>
                      <td className="n">{c.planned ? formatLapMs(c.planned.avgLapMs) : '—'}</td>
                      <td className="n">{c.actual ? formatLapMs(c.actual.avgLapMs) : '—'}</td>
                      <td className="n">{c.actual ? formatLapMs(c.actual.bestLapMs) : '—'}</td>
                      <td className="n">{c.planned ? u.fpl(c.planned.fuelPerLapL) : '—'}</td>
                      <td className="n">{c.actual ? u.fpl(c.actual.fuelPerLapL) : '—'}</td>
                      <td>{c.actual ? `${c.actual.compound} → ${c.actual.tireAgeEnd}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <div className="grid-3">
              <Panel title="Drivers" bodyClass="flush">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Driver</th>
                      <th className="n">Stints</th>
                      <th className="n">Laps</th>
                      <th className="n">Time</th>
                      <th className="n">Avg</th>
                      <th className="n">Best</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(sum.driverStints).map(([id, d]) => (
                      <tr key={id}>
                        <td>
                          <DriverChip car={car} id={id} name />
                        </td>
                        <td className="n">{d.stints}</td>
                        <td className="n">{d.laps}</td>
                        <td className="n">{formatClock(d.timeSec)}</td>
                        <td className="n">{formatLapMs(d.avgLapMs)}</td>
                        <td className="n">{formatLapMs(d.bestLapMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
              <Panel title="Deviations from plan">
                {sum.deviations.length ? (
                  <ul className="plain">
                    {sum.deviations.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="sublabel">No stop deviations recorded.</div>
                )}
              </Panel>
              <Panel title="Major decisions" meta={<span className="sublabel">overrides, critical calls, changes</span>} bodyClass="flush" className="scroll">
                {sum.majorDecisions.length ? (
                  <table className="table compact">
                    <tbody>
                      {sum.majorDecisions.map((d, i) => (
                        <tr key={i}>
                          <td className="n dim">{formatClock(d.raceTimeSec)}</td>
                          <td className="n">L{d.lap}</td>
                          <td className="call-cell">{d.text}</td>
                          <td className="dim upper" style={{ fontSize: 11 }}>
                            {d.source}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty">No overrides or critical calls.</div>
                )}
              </Panel>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

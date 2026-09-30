import { useState } from 'react';
import { formatClock, formatDelta } from '../../engine/format';
import { uid } from '../../engine/planner';
import type { StrategyResult } from '../../engine/simulate';
import type { ScenarioEvent, ScenarioType } from '../../engine/types';
import { ScenarioModal, SCENARIOS } from '../../components/race/ScenarioPanel';
import { blocksFromResult, StrategyTimeline } from '../../components/race/StrategyTimeline';
import { ClockInput, NumInput, Panel } from '../../components/ui';
import { usePlanResult } from '../../lib/hooks';
import { useUnits } from '../../lib/units';
import { useStore } from '../../store/store';
import { IssueList, marginClass, type TabProps } from './shared';

export function SimulationTab({ race, car, res }: TabProps) {
  const u = useUnits();
  const setPlannedEvents = useStore((s) => s.setPlannedEvents);
  const withEv = usePlanResult(race, car, true);
  const [adding, setAdding] = useState<ScenarioType | null>(null);
  const events = race.plannedEvents;
  const update = (id: string, patch: Partial<ScenarioEvent>) => setPlannedEvents(race.id, events.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  const base = blocksFromResult(res);
  const sim = blocksFromResult(withEv);
  const defaultStart = res.stops[0]?.entrySec ?? 3600;
  return (
    <div className="col gap-8">
      <div className="grid-side">
        <Panel
          title="Planned scenarios"
          meta={
            <div className="row gap-4">
              {SCENARIOS.map((s) => (
                <button key={s.type} className="btn xs" onClick={() => setAdding(s.type)} title={`Add ${s.label}`}>
                  + {s.short}
                </button>
              ))}
            </div>
          }
          bodyClass="flush"
        >
          {events.length === 0 ? (
            <div className="empty">No scenarios planned. Add a safety car, slow zone or weather change to see how the plan reacts. Every effect is your own estimate.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Label</th>
                  <th className="n" style={{ width: 110 }}>Start</th>
                  <th className="n" style={{ width: 90 }}>Min</th>
                  <th className="n" style={{ width: 90 }}>Lap Δ s</th>
                  <th className="n" style={{ width: 90 }}>Fuel −%</th>
                  {car.setup.energyEnabled && <th className="n" style={{ width: 90 }}>Energy −%</th>}
                  <th>Pit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="c-amber">{e.type.replace('_', ' ')}</td>
                    <td>
                      <input className="input sm" value={e.label} onChange={(ev) => update(e.id, { label: ev.target.value })} />
                    </td>
                    <td className="n">
                      <ClockInput value={e.startSec} onChange={(v) => update(e.id, { startSec: v })} />
                    </td>
                    <td className="n">
                      <NumInput size="sm" value={e.durationSec / 60} decimals={1} min={0} onChange={(v) => update(e.id, { durationSec: v * 60 })} />
                    </td>
                    <td className="n">
                      <NumInput size="sm" value={e.lapDeltaSec} decimals={1} onChange={(v) => update(e.id, { lapDeltaSec: v })} />
                    </td>
                    <td className="n">
                      <NumInput size="sm" value={e.fuelReductionPct} decimals={0} min={-100} max={100} onChange={(v) => update(e.id, { fuelReductionPct: v })} />
                    </td>
                    {car.setup.energyEnabled && (
                      <td className="n">
                        <NumInput size="sm" value={e.energyReductionPct} decimals={0} min={-100} max={100} onChange={(v) => update(e.id, { energyReductionPct: v })} />
                      </td>
                    )}
                    <td>
                      <button className="btn xs" onClick={() => update(e.id, { pitOpen: !e.pitOpen })}>
                        {e.pitOpen ? 'OPEN' : 'CLOSED'}
                      </button>
                    </td>
                    <td className="right">
                      <button className="btn xs ghost" onClick={() => setPlannedEvents(race.id, events.filter((x) => x.id !== e.id))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Effect on the plan" bodyClass="flush">
          <Compare a={res} b={withEv} energy={car.setup.energyEnabled} u={u} />
        </Panel>
      </div>

      <Panel title="Race-time timeline" meta={<span className="sublabel">stops move with the scenarios · amber = planned scenario</span>} bodyClass="tight">
        <StrategyTimeline car={car} blocks={base.blocks} stops={base.stops} actual={sim} labels={{ plan: 'NO EVENTS', actual: 'WITH EVENTS' }} totalLaps={Math.max(res.totalLaps, withEv.totalLaps)} totalSec={Math.max(res.finishSec, withEv.finishSec, race.params.durationSec)} axis="time" events={events} />
      </Panel>

      <div className="grid-2">
        <Panel title="Stops — no events vs with events" bodyClass="flush">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th className="n">In-lap</th>
                <th className="n">Time</th>
                <th className="n">In-lap (events)</th>
                <th className="n">Time (events)</th>
                <th className="n">Δ time</th>
                <th>Under</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: Math.max(res.stops.length, withEv.stops.length) }, (_, i) => {
                const a = res.stops[i];
                const b = withEv.stops[i];
                return (
                  <tr key={i}>
                    <td className="mono">P{i + 1}</td>
                    <td className="n">{a?.lap ?? '—'}</td>
                    <td className="n">{a ? formatClock(a.entrySec) : '—'}</td>
                    <td className="n">{b?.lap ?? '—'}</td>
                    <td className="n">{b ? formatClock(b.entrySec) : '—'}</td>
                    <td className="n">{a && b ? `${formatDelta(b.entrySec - a.entrySec, 0)} s` : '—'}</td>
                    <td className={b?.underEvent ? 'c-amber' : 'dim'}>{b?.underEvent ? b.underEvent.replace('_', ' ') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
        <Panel title="Plan check with events">
          <IssueList issues={withEv.issues} />
        </Panel>
      </div>

      {adding && (
        <ScenarioModal
          type={adding}
          startSec={defaultStart}
          planned
          onClose={() => setAdding(null)}
          onSubmit={(ev) => setPlannedEvents(race.id, [...events, { ...ev, id: uid('ev'), planned: true }].sort((x, y) => x.startSec - y.startSec))}
        />
      )}
    </div>
  );
}

function Compare({ a, b, energy, u }: { a: StrategyResult; b: StrategyResult; energy: boolean; u: ReturnType<typeof useUnits> }) {
  const rows: { k: string; a: string; b: string; d: string; clsA?: string; cls?: string }[] = [
    { k: 'Race laps', a: String(a.totalLaps), b: String(b.totalLaps), d: formatDelta(b.totalLaps - a.totalLaps, 0) },
    { k: 'Finish', a: formatClock(a.finishSec), b: formatClock(b.finishSec), d: `${formatDelta(b.finishSec - a.finishSec, 0)} s` },
    { k: 'Stops', a: String(a.stops.length), b: String(b.stops.length), d: formatDelta(b.stops.length - a.stops.length, 0) },
    { k: 'Pit loss', a: `${u.n(a.totalPitLossSec, 0)} s`, b: `${u.n(b.totalPitLossSec, 0)} s`, d: `${formatDelta(b.totalPitLossSec - a.totalPitLossSec, 0)} s` },
    { k: 'Fuel used', a: u.fuelU(a.fuelUsedL, 0), b: u.fuelU(b.fuelUsedL, 0), d: formatDelta(u.fuelVal(b.fuelUsedL - a.fuelUsedL), 1) },
    { k: 'Min fuel margin', a: u.n(a.minFuelMarginLaps, 2), b: u.n(b.minFuelMarginLaps, 2), d: formatDelta(b.minFuelMarginLaps - a.minFuelMarginLaps, 2), clsA: marginClass(a.minFuelMarginLaps), cls: marginClass(b.minFuelMarginLaps) },
  ];
  if (energy) rows.push({ k: 'Min energy margin', a: u.n(a.minEnergyMarginLaps, 2), b: u.n(b.minEnergyMarginLaps, 2), d: formatDelta(b.minEnergyMarginLaps - a.minEnergyMarginLaps, 2), clsA: marginClass(a.minEnergyMarginLaps), cls: marginClass(b.minEnergyMarginLaps) });
  return (
    <table className="table">
      <thead>
        <tr>
          <th />
          <th className="n">No events</th>
          <th className="n">With events</th>
          <th className="n">Δ</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.k}>
            <td className="label">{r.k}</td>
            <td className={`n ${r.clsA ?? ''}`}>{r.a}</td>
            <td className={`n ${r.cls ?? ''}`}>{r.b}</td>
            <td className="n dim">{r.d}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import { useMemo, useState } from 'react';
import { compareStrategies, pitNowOption, type StrategyOption } from '../../engine/alternatives';
import { formatClock, formatDelta } from '../../engine/format';
import { liveSimOptions, type LiveProjection } from '../../engine/live';
import { eventActiveAt } from '../../engine/model';
import { clonePlan } from '../../engine/planner';
import type { CarEntry, Race, ScenarioEvent, ScenarioType } from '../../engine/types';
import { useStore } from '../../store/store';
import { Field, Modal, NumInput } from '../ui';

export const SCENARIOS: { type: ScenarioType; label: string; short: string }[] = [
  { type: 'SAFETY_CAR', label: 'Safety car', short: 'SC' },
  { type: 'SLOW_ZONE', label: 'Slow zone', short: 'SZ' },
  { type: 'FCY', label: 'Full course yellow', short: 'FCY' },
  { type: 'VSC', label: 'Virtual safety car', short: 'VSC' },
  { type: 'RED_FLAG', label: 'Red flag', short: 'RED' },
  { type: 'RAIN', label: 'Rain', short: 'RAIN' },
  { type: 'DRYING', label: 'Drying track', short: 'DRY' },
  { type: 'CUSTOM', label: 'Custom incident', short: 'CUST' },
];

/** Example starting values only — every field is the pitwall's own estimate. */
const EXAMPLES: Record<ScenarioType, Omit<ScenarioEvent, 'id' | 'startSec' | 'type' | 'label'>> = {
  SAFETY_CAR: { durationSec: 360, lapDeltaSec: 35, fuelReductionPct: 20, energyReductionPct: 25, pitOpen: true },
  SLOW_ZONE: { durationSec: 120, lapDeltaSec: 6, fuelReductionPct: 5, energyReductionPct: 6, pitOpen: true },
  FCY: { durationSec: 180, lapDeltaSec: 30, fuelReductionPct: 25, energyReductionPct: 30, pitOpen: false },
  VSC: { durationSec: 180, lapDeltaSec: 25, fuelReductionPct: 20, energyReductionPct: 25, pitOpen: true },
  RED_FLAG: { durationSec: 1200, lapDeltaSec: 0, fuelReductionPct: 0, energyReductionPct: 0, pitOpen: false },
  RAIN: { durationSec: 1800, lapDeltaSec: 8, fuelReductionPct: 8, energyReductionPct: 10, pitOpen: true },
  DRYING: { durationSec: 1200, lapDeltaSec: 3, fuelReductionPct: 3, energyReductionPct: 4, pitOpen: true },
  CUSTOM: { durationSec: 300, lapDeltaSec: 0, fuelReductionPct: 0, energyReductionPct: 0, pitOpen: true },
};

export function ScenarioModal({ type, startSec, onClose, onSubmit, planned }: { type: ScenarioType; startSec: number; onClose: () => void; onSubmit: (ev: Omit<ScenarioEvent, 'id'>) => void; planned?: boolean }) {
  const meta = SCENARIOS.find((s) => s.type === type)!;
  const ex = EXAMPLES[type];
  const [label, setLabel] = useState(meta.label);
  const [start, setStart] = useState(startSec);
  const [dur, setDur] = useState(ex.durationSec / 60);
  const [lapDelta, setLapDelta] = useState(ex.lapDeltaSec);
  const [fuelRed, setFuelRed] = useState(ex.fuelReductionPct);
  const [eRed, setERed] = useState(ex.energyReductionPct);
  const [pitOpen, setPitOpen] = useState(ex.pitOpen);
  const [pitLoss, setPitLoss] = useState<number | null>(null);
  return (
    <Modal
      title={`${planned ? 'Plan scenario' : 'Trigger'} — ${meta.label}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn warn"
            onClick={() => {
              onSubmit({ type, label, startSec: start, durationSec: dur * 60, lapDeltaSec: lapDelta, fuelReductionPct: fuelRed, energyReductionPct: eRed, pitOpen, pitLossUnderEventSec: pitLoss ?? undefined, planned });
              onClose();
            }}
          >
            {planned ? 'Add to simulation' : 'Trigger & recalculate'}
          </button>
        </>
      }
    >
      <div className="notice amber mb-8">Enter your own estimate of the effect. Pre-filled numbers are editable examples, not assumptions the system makes.</div>
      <div className="grid-2">
        <Field label="Label">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Start (race time)">
          <input className="input num" defaultValue={formatClock(start)} onBlur={(e) => {
            const parts = e.target.value.split(':').map(Number);
            if (parts.every((n) => isFinite(n))) setStart(parts.reduce((a, n) => a * 60 + n, 0));
          }} />
        </Field>
        <Field label="Estimated duration (min)">
          <NumInput value={dur} decimals={1} min={0} onChange={setDur} />
        </Field>
        <Field label="Lap time change (s)">
          <NumInput value={lapDelta} decimals={1} onChange={setLapDelta} />
        </Field>
        <Field label="Fuel consumption reduction (%)">
          <NumInput value={fuelRed} decimals={0} min={-100} max={100} onChange={setFuelRed} />
        </Field>
        <Field label="Energy usage reduction (%)">
          <NumInput value={eRed} decimals={0} min={-100} max={100} onChange={setERed} />
        </Field>
        <Field label="Pit opportunity">
          <select className="select" value={pitOpen ? 'open' : 'closed'} onChange={(e) => setPitOpen(e.target.value === 'open')}>
            <option value="open">OPEN</option>
            <option value="closed">CLOSED</option>
          </select>
        </Field>
        <Field label="Pit-lane loss under event (s)" hint="Optional — blank uses the green-flag value">
          <NumInput value={pitLoss} decimals={1} min={0} onChange={setPitLoss} placeholder="—" />
        </Field>
      </div>
    </Modal>
  );
}

export function ScenarioPanel({ race, car, p, nowSec }: { race: Race; car: CarEntry; p: LiveProjection; nowSec: number }) {
  const triggerEvent = useStore((s) => s.triggerEvent);
  const endEvent = useStore((s) => s.endEvent);
  const [open, setOpen] = useState<ScenarioType | null>(null);
  const active = race.events.filter((e) => eventActiveAt(e, nowSec));
  const racing = car.live.phase === 'racing';
  return (
    <div className="scen">
      <div className="scen-bar">
        <span className="label">Scenario</span>
        {SCENARIOS.map((s) => (
          <button key={s.type} className="btn xs" disabled={!racing} onClick={() => setOpen(s.type)} title={`Trigger ${s.label}`}>
            {s.short}
          </button>
        ))}
      </div>
      {active.map((ev) => {
        const end = ev.endedSec ?? ev.startSec + ev.durationSec;
        return (
          <div key={ev.id} className="scen-active">
            <span className="badge amber solid sm">{ev.type.replace('_', ' ')}</span>
            <span className="grow ellipsis">
              {ev.label} · <span className="mono">+{ev.lapDeltaSec}s/lap</span> · fuel −{ev.fuelReductionPct}% · pit {ev.pitOpen ? 'OPEN' : 'CLOSED'}
            </span>
            <span className="mono">{formatClock(Math.max(0, end - nowSec), false)} left</span>
            <button className="btn xs" onClick={() => endEvent(race.id, ev.id, nowSec)}>
              End now
            </button>
          </div>
        );
      })}
      {active.length > 0 && racing && !p.isFinalStint && <EventImpact race={race} car={car} p={p} />}
      {open && <ScenarioModal type={open} startSec={nowSec} onClose={() => setOpen(null)} onSubmit={(ev) => triggerEvent(race.id, ev)} />}
    </div>
  );
}

/** CURRENT STRATEGY AFTER EVENT vs ALTERNATIVE (box under the event). */
export function EventImpact({ race, car, p }: { race: Race; car: CarEntry; p: LiveProjection }) {
  const settings = useStore((s) => s.settings);
  const setPlan = useStore((s) => s.setPlan);
  const setPitOverride = useStore((s) => s.setPitOverride);
  const rows = useMemo(() => {
    const sim = liveSimOptions(race, car, settings);
    const cur: StrategyOption = { id: 'current', name: 'Current strategy after event', description: '', plan: car.plan, assumptions: [], current: true };
    const alt = pitNowOption({ race: race.params, car, sim, currentLap: p.currentLap, stintIndex: car.live.stintIndex });
    return { m: compareStrategies(race.params, car, [cur, alt], sim), alt };
  }, [race, car, settings, p.currentLap]);
  const [a, b] = rows.m;
  if (!a || !b) return null;
  return (
    <div className="impact">
      <table className="table compact">
        <thead>
          <tr>
            <th>After event</th>
            <th className="n">Laps</th>
            <th className="n">Finish</th>
            <th className="n">Δ same dist.</th>
            <th className="n">Stops</th>
            <th className="n">Pit loss</th>
            <th className="n">Min fuel margin</th>
          </tr>
        </thead>
        <tbody>
          {[a, b].map((m) => (
            <tr key={m.option.id}>
              <td>
                <span className={`badge sm ${m.option.current ? '' : 'blue'}`}>{m.option.current ? 'CURRENT' : 'ALTERNATIVE'}</span> <span className="sublabel">{m.option.current ? `box lap ${p.window.target}` : `box lap ${p.currentLap}`}</span>
              </td>
              <td className="n">{m.totalLaps}</td>
              <td className="n">{formatClock(m.finishSec)}</td>
              <td className={`n ${m.deltaSameDistanceSec < -0.05 ? 'c-green' : m.deltaSameDistanceSec > 0.05 ? 'c-amber' : ''}`}>{formatDelta(m.deltaSameDistanceSec, 1)} s</td>
              <td className="n">{m.stops}</td>
              <td className="n">{m.pitLossSec.toFixed(0)} s</td>
              <td className={`n ${m.minFuelMarginLaps < 0 ? 'c-red' : ''}`}>{m.minFuelMarginLaps.toFixed(1)} laps</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row mt-4 gap-4">
        <span className="sublabel grow">Calculated from entered event effects & measured rates. Neither option is ranked.</span>
        <button
          className="btn xs info"
          onClick={() => {
            setPlan(race.id, car.id, clonePlan(rows.alt.plan));
            setPitOverride(race.id, car.id, car.live.stintIndex, p.currentLap, `Box under event — re-balanced (${rows.alt.name})`);
          }}
        >
          Apply alternative
        </button>
      </div>
    </div>
  );
}

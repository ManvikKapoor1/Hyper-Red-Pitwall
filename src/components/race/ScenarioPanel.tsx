import { useState } from 'react';
import { formatClock } from '../../engine/format';
import { eventActiveAt } from '../../engine/model';
import type { CarEntry, Race, ScenarioEvent, ScenarioType } from '../../engine/types';
import { useStore } from '../../store/store';
import { Field, Modal, NumInput } from '../ui';

/** Scenarios LMU can throw at a stint (no safety car / full-course yellow in LMU). */
export const SCENARIOS: { type: ScenarioType; label: string; short: string }[] = [
  { type: 'RAIN', label: 'Rain', short: 'Rain' },
  { type: 'DRYING', label: 'Drying track', short: 'Drying' },
  { type: 'CUSTOM', label: 'Custom incident', short: 'Incident' },
];

export const scenarioLabel = (type: ScenarioType | string) => SCENARIOS.find((s) => s.type === type)?.label ?? 'Event';

/** Example starting values only — every field is the pitwall's own estimate. */
const EXAMPLES: Record<ScenarioType, Omit<ScenarioEvent, 'id' | 'startSec' | 'type' | 'label'>> = {
  RAIN: { durationSec: 1800, lapDeltaSec: 8, fuelReductionPct: 8, energyReductionPct: 10 },
  DRYING: { durationSec: 1200, lapDeltaSec: 3, fuelReductionPct: 3, energyReductionPct: 4 },
  CUSTOM: { durationSec: 300, lapDeltaSec: 0, fuelReductionPct: 0, energyReductionPct: 0 },
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
              onSubmit({ type, label, startSec: start, durationSec: dur * 60, lapDeltaSec: lapDelta, fuelReductionPct: fuelRed, energyReductionPct: eRed, planned });
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
      </div>
    </Modal>
  );
}

export function ScenarioPanel({ race, car, nowSec }: { race: Race; car: CarEntry; nowSec: number }) {
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
            <span className="badge amber solid sm">{scenarioLabel(ev.type)}</span>
            <span className="grow ellipsis">
              {ev.label} · <span className="mono">{ev.lapDeltaSec >= 0 ? '+' : ''}{ev.lapDeltaSec}s/lap</span> · fuel {ev.fuelReductionPct >= 0 ? '−' : '+'}{Math.abs(ev.fuelReductionPct)}%
            </span>
            <span className="mono">{formatClock(Math.max(0, end - nowSec), false)} left</span>
            <button className="btn xs" onClick={() => endEvent(race.id, ev.id, nowSec)}>
              End now
            </button>
          </div>
        );
      })}
      {open && <ScenarioModal type={open} startSec={nowSec} onClose={() => setOpen(null)} onSubmit={(ev) => triggerEvent(race.id, ev)} />}
    </div>
  );
}

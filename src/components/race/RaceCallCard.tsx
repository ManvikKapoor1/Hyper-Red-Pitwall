import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CallAction, RaceCall } from '../../engine/calls';
import type { LiveProjection } from '../../engine/live';
import type { CallPriority, CarEntry, Race } from '../../engine/types';
import { useUnits } from '../../lib/units';
import { useStore } from '../../store/store';
import { Field, Modal, NumInput } from '../ui';
import { PRIORITY_LABEL, priorityColor } from './RaceStatusBadge';

export function useApplyCall(race: Race, car: CarEntry, p: LiveProjection) {
  const setPitOverride = useStore((s) => s.setPitOverride);
  const setDriveMode = useStore((s) => s.setDriveMode);
  return (action: CallAction | undefined, why: string) => {
    if (!action || action.type === 'none') return;
    if (action.type === 'boxLap') {
      const planned = p.current?.endLap;
      const overridden = car.live.pitLapOverrides[car.live.stintIndex];
      if (action.lap !== planned || overridden != null) {
        if (action.lap !== (overridden ?? planned)) setPitOverride(race.id, car.id, car.live.stintIndex, action.lap, why);
      }
    } else if (action.type === 'mode') {
      setDriveMode(race.id, car.id, action.mode);
    }
  };
}

export function RaceCallCard({ race, car, p, call, onOverride }: { race: Race; car: CarEntry; p: LiveProjection; call?: RaceCall; onOverride: () => void }) {
  const logCall = useStore((s) => s.logCall);
  const apply = useApplyCall(race, car, p);
  const u = useUnits();
  const [showBasis, setShowBasis] = useState(false);
  if (!call) return null;
  const color = priorityColor(call.priority);
  const lastIssued = [...car.live.calls].reverse().find((c) => c.source !== 'event');
  const alreadyIssued = lastIssued && lastIssued.text === call.text && lastIssued.lap === p.currentLap && lastIssued.status !== 'CANCELLED';
  const size = call.text.length > 22 ? 'md' : call.text.length > 14 ? 'lg' : 'xl';
  return (
    <section className={`panel call-card pr-${call.priority} ${call.priority === 'CRITICAL' ? 'pulse-red' : ''}`} aria-live="polite">
      <header className="panel-h">
        <span className="label">Next call</span>
        <div className="meta">
          <span className={`badge sm ${color ?? ''} ${call.priority === 'CRITICAL' ? 'solid' : ''}`}>{PRIORITY_LABEL[call.priority]}</span>
          <span className={`badge sm ghost ${call.confidence === 'HIGH' ? 'green' : call.confidence === 'MEDIUM' ? 'amber' : 'red'}`} title="Confidence from data quality & recency">
            {call.confidence} CONF
          </span>
        </div>
      </header>
      <div className="panel-b call-body">
        <div className={`call-text ${size}`}>{call.text}</div>
        <ul className="call-reasons">
          {call.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        {call.alternative && (
          <div className="call-alt">
            <span className="label">Alternative</span>
            <span className="call-alt-t">{call.alternative}</span>
          </div>
        )}
        <button className="btn xs ghost basis-toggle" onClick={() => setShowBasis((b) => !b)}>
          {showBasis ? 'Hide' : 'Show'} basis
        </button>
        {showBasis && (
          <div className="call-basis">
            <div>
              Fuel: {u.fpl(p.fuelRate.value)} {u.fuelUnit}/lap — {p.fuelRate.source} ({p.fuelRate.confidence})
            </div>
            {car.setup.energyEnabled && (
              <div>
                Energy: {p.energyRate.value.toFixed(2)} %/lap — {p.energyRate.source} ({p.energyRate.confidence})
              </div>
            )}
            <div>
              Safety margin {car.setup.fuelSafetyMarginLaps} lap · energy reserve {car.setup.energyReservePct}% · last input lap {car.live.lastUpdateLap}
            </div>
            <div className="dim">Suggested call — the pitwall decides and relays it to the driver.</div>
          </div>
        )}
      </div>
      {car.live.phase === 'finished' ? (
        <div className="call-actions">
          <Link className="btn grow" to={`/app/race/${race.id}/analysis`}>
            Post-race analysis
          </Link>
        </div>
      ) : (
        <div className="call-actions">
          <button
            className={`btn ${call.priority === 'CRITICAL' ? 'danger' : 'go'} grow`}
            disabled={!!alreadyIssued}
            onClick={() => {
              logCall(race.id, car.id, call.text, call.priority, call.reasons.join(' · '), 'ISSUED', 'system');
              apply(call.action, `Call accepted: ${call.text}`);
            }}
            title="Log as issued to the driver (C)"
          >
            {alreadyIssued ? 'Issued ✓' : 'Confirm & issue'}
          </button>
          {call.alternative && (
            <button
              className="btn grow"
              onClick={() => {
                logCall(race.id, car.id, call.alternative!, call.priority, `Alternative to "${call.text}"`, 'ISSUED', 'override');
                apply(call.altAction, `Alternative chosen: ${call.alternative}`);
              }}
              title="Issue the alternative instead"
            >
              Use alternative
            </button>
          )}
          <button className="btn warn" onClick={onOverride} title="Override the recommendation (O)">
            Override…
          </button>
        </div>
      )}
    </section>
  );
}

export function OverrideModal({ race, car, p, call, onClose }: { race: Race; car: CarEntry; p: LiveProjection; call?: RaceCall; onClose: () => void }) {
  const setPitOverride = useStore((s) => s.setPitOverride);
  const logCall = useStore((s) => s.logCall);
  const [lap, setLap] = useState<number>(car.live.pitLapOverrides[car.live.stintIndex] ?? p.window.target);
  const [text, setText] = useState('');
  const [priority, setPriority] = useState<CallPriority>('ACTION');
  const [reason, setReason] = useState('');
  const planned = p.current?.endLap ?? p.window.target;
  const unsafe = lap > p.window.latest;
  return (
    <Modal
      title="Override recommendation"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          {text.trim() && (
            <button
              className="btn"
              onClick={() => {
                logCall(race.id, car.id, text.trim().toUpperCase(), priority, reason || 'Strategist override', 'ISSUED', 'override');
                onClose();
              }}
            >
              Issue custom call
            </button>
          )}
          {!p.isFinalStint && (
            <button
              className="btn warn"
              onClick={() => {
                setPitOverride(race.id, car.id, car.live.stintIndex, lap, reason || `Strategist override (system: lap ${planned})`);
                onClose();
              }}
            >
              Override → box lap {lap}
            </button>
          )}
        </>
      }
    >
      {call && (
        <div className="notice mb-8">
          System: <b>{call.text}</b>
          {!p.isFinalStint && (
            <>
              {' '}
              · planned in-lap <b className="mono">{planned}</b> · safe range to lap <b className="mono">{p.window.latest}</b>
            </>
          )}
        </div>
      )}
      {!p.isFinalStint && (
        <div className="grid-2">
          <Field label="Box on lap" hint={unsafe ? `Beyond safe range (lap ${p.window.latest}) — will be flagged` : `Window ${p.window.earliest}–${p.window.latest}`}>
            <NumInput value={lap} decimals={0} min={p.currentLap} onChange={setLap} size="lg" autoFocus />
          </Field>
          <div className="row wrap gap-4" style={{ alignSelf: 'end' }}>
            {[-2, -1, 1, 2, 3].map((d) => (
              <button key={d} className="btn sm" onClick={() => setLap(Math.max(p.currentLap, planned + d))}>
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="sep" />
      <div className="grid-2">
        <Field label="Custom call (optional)">
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. STAY OUT — TARGET LAP 92" />
        </Field>
        <Field label="Priority">
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as CallPriority)}>
            <option value="CRITICAL">Critical</option>
            <option value="ACTION">Action required</option>
            <option value="UPCOMING">Upcoming</option>
            <option value="INFO">Information</option>
          </select>
        </Field>
      </div>
      <Field label="Reason" className="mt-8">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the strategist overrides (logged & versioned)" />
      </Field>
      <p className="sublabel mt-8">Overriding the pit lap creates a new strategy version and recalculates everything downstream.</p>
    </Modal>
  );
}

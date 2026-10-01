import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RaceContextBar, RaceNotFound } from '../components/race/RaceContextBar';
import { formatClock } from '../engine/format';
import type { CallLogEntry, CallPriority, CallStatus, CarEntry, Race } from '../engine/types';
import { StatusBadge } from '../components/race/LiveCards';
import { useApplyCall } from '../components/race/RaceCallCard';
import { PRIORITY_LABEL, PriorityBadge } from '../components/race/RaceStatusBadge';
import { ConfidenceBadge, Field, Panel, Seg, Stat } from '../components/ui';
import { activeCar, useLive, useRaceFromRoute, useRaceNow } from '../lib/hooks';
import { useStore } from '../store/store';

const PRIORITIES: CallPriority[] = ['CRITICAL', 'ACTION', 'UPCOMING', 'INFO'];
const STATUSES: CallStatus[] = ['ISSUED', 'CONFIRMED', 'CHANGED', 'COMPLETED', 'CANCELLED', 'LOGGED'];
const SOURCES: CallLogEntry['source'][] = ['system', 'override', 'manual', 'event'];
const QUICK = ['BOX THIS LAP', 'BOX NEXT LAP', 'STAY OUT', 'FUEL SAVE', 'ENERGY SAVE', 'PUSH', 'MODE NORMAL', 'TRAFFIC BEHIND', 'COPY?'];

export function CallsPage() {
  const race = useRaceFromRoute();
  if (!race) return <RaceNotFound />;
  return <Calls race={race} car={activeCar(race)} />;
}

function Calls({ race, car }: { race: Race; car: CarEntry }) {
  const nowSec = useRaceNow(race, 1000);
  const { p, calls } = useLive(race, car, nowSec);
  const logCall = useStore((s) => s.logCall);
  const apply = useApplyCall(race, car, p);
  const racing = car.live.phase === 'racing';
  const log = car.live.calls;
  const counts = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, log.filter((c) => c.status === s).length])) as Record<CallStatus, number>, [log]);
  return (
    <>
      <RaceContextBar
        race={race}
        actions={
          <Link className="btn sm" to={`/app/race/${race.id}/live`}>
            Live race
          </Link>
        }
      >
        <span className="sublabel">
          {racing ? `Lap ${p.currentLap} · ${formatClock(nowSec)}` : car.live.phase === 'finished' ? 'Race finished' : 'Pre-race'} · STINT suggests calls; the pitwall decides and relays them.
        </span>
      </RaceContextBar>
      <div className="page full">
        <div className="calls-grid">
          <div className="col gap-8">
            <Panel title="Suggested now" meta={<span className="sublabel">{calls.length} from the live projection</span>}>
              {calls.length === 0 && <div className="empty">No suggestions.</div>}
              <div className="col gap-8">
                {calls.map((c) => (
                  <div key={c.key} className={`sugg p-${c.priority}`}>
                    <div className="row between">
                      <PriorityBadge p={c.priority} size="sm" />
                      <ConfidenceBadge c={c.confidence} />
                    </div>
                    <div className="sugg-t">{c.text}</div>
                    <ul className="call-reasons">
                      {c.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                    {c.alternative && (
                      <div className="sublabel">
                        Alternative: <b className="c-blue">{c.alternative}</b>
                      </div>
                    )}
                    <div className="row gap-4 mt-4">
                      <button
                        className="btn sm go"
                        disabled={!racing}
                        onClick={() => {
                          logCall(race.id, car.id, c.text, c.priority, c.reasons.join(' · '), 'ISSUED', 'system');
                          apply(c.action, `Call accepted: ${c.text}`);
                        }}
                      >
                        Issue
                      </button>
                      {c.alternative && (
                        <button
                          className="btn sm"
                          disabled={!racing}
                          onClick={() => {
                            logCall(race.id, car.id, c.alternative!, c.priority, `Alternative to "${c.text}"`, 'ISSUED', 'override');
                            apply(c.altAction, `Alternative chosen: ${c.alternative}`);
                          }}
                        >
                          Issue alternative
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            <ManualCall race={race} car={car} />
          </div>
          <div className="col gap-8" style={{ minWidth: 0 }}>
            <div className="stat-row">
              <Stat k="Calls logged" v={log.length} />
              {STATUSES.map((s) => (
                <Stat key={s} k={s} v={counts[s]} />
              ))}
            </div>
            <CallBoard race={race} car={car} />
          </div>
        </div>
      </div>
    </>
  );
}

function ManualCall({ race, car }: { race: Race; car: CarEntry }) {
  const logCall = useStore((s) => s.logCall);
  const [text, setText] = useState('');
  const [priority, setPriority] = useState<CallPriority>('ACTION');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<CallStatus>('ISSUED');
  const submit = () => {
    if (!text.trim()) return;
    logCall(race.id, car.id, text.trim().toUpperCase(), priority, reason.trim() || 'Manual pitwall call', status, 'manual');
    setText('');
    setReason('');
  };
  return (
    <Panel title="Manual call">
      <div className="row wrap gap-4 mb-8">
        {QUICK.map((q) => (
          <button key={q} className="btn xs" onClick={() => setText(q)}>
            {q}
          </button>
        ))}
      </div>
      <div className="col gap-8">
        <Field label="Call">
          <input className="input" value={text} placeholder="e.g. BOX NEXT LAP — FUEL ONLY" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </Field>
        <Field group label="Priority">
          <Seg options={PRIORITIES.map((p) => ({ value: p, label: p === 'ACTION' ? 'Action' : p.charAt(0) + p.slice(1).toLowerCase(), title: PRIORITY_LABEL[p] }))} value={priority} onChange={setPriority} />
        </Field>
        <Field label="Reason">
          <input className="input" value={reason} placeholder="optional" onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </Field>
        <div className="row gap-8">
          <Seg options={[{ value: 'ISSUED' as CallStatus, label: 'Issued to driver' }, { value: 'LOGGED' as CallStatus, label: 'Note only' }]} value={status} onChange={setStatus} />
          <button className="btn primary grow" disabled={!text.trim()} onClick={submit}>
            Log call
          </button>
        </div>
      </div>
    </Panel>
  );
}

function CallBoard({ race, car }: { race: Race; car: CarEntry }) {
  const setCallStatus = useStore((s) => s.setCallStatus);
  const [prio, setPrio] = useState<CallPriority | 'ALL'>('ALL');
  const [status, setStatus] = useState<CallStatus | 'ALL'>('ALL');
  const [source, setSource] = useState<CallLogEntry['source'] | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...car.live.calls]
      .reverse()
      .filter((c) => (prio === 'ALL' || c.priority === prio) && (status === 'ALL' || c.status === status) && (source === 'ALL' || c.source === source))
      .filter((c) => !needle || c.text.toLowerCase().includes(needle) || c.reason.toLowerCase().includes(needle));
  }, [car.live.calls, prio, status, source, q]);
  return (
    <Panel
      title="Call history"
      meta={<span className="sublabel">{rows.length} shown · newest first</span>}
      bodyClass="flush"
      className="call-board"
    >
      <div className="filter-row">
        <Seg className="xs" options={[{ value: 'ALL' as const, label: 'All' }, ...PRIORITIES.map((p) => ({ value: p, label: p }))]} value={prio} onChange={setPrio} />
        <select className="select xs" value={status} onChange={(e) => setStatus(e.target.value as CallStatus | 'ALL')} aria-label="Status filter">
          <option value="ALL">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className="select xs" value={source} onChange={(e) => setSource(e.target.value as CallLogEntry['source'] | 'ALL')} aria-label="Source filter">
          <option value="ALL">Any source</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input className="input sm" style={{ width: 220 }} placeholder="Search calls & reasons" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {rows.length === 0 ? (
        <div className="empty">No calls match.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="n">Race time</th>
              <th className="n">Lap</th>
              <th>Priority</th>
              <th>Call</th>
              <th>Reason</th>
              <th>Source</th>
              <th style={{ width: 150 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={c.status === 'CANCELLED' ? 'done' : ''}>
                <td className="n">{formatClock(c.raceTimeSec)}</td>
                <td className="n">{c.lap}</td>
                <td>
                  <PriorityBadge p={c.priority} size="sm" />
                </td>
                <td className="call-cell">{c.text}</td>
                <td className="ellipsis t2" title={c.reason}>
                  {c.reason}
                </td>
                <td className="dim upper" style={{ fontSize: 11 }}>
                  {c.source}
                </td>
                <td>
                  {c.source === 'event' ? (
                    <StatusBadge s={c.status} />
                  ) : (
                    <select className="select sm" value={c.status} onChange={(e) => setCallStatus(race.id, car.id, c.id, e.target.value as CallStatus)} aria-label="Call status">
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

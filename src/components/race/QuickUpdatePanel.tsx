import { useEffect, useMemo, useRef, useState } from 'react';
import { formatClock, formatLapMs, parseClock, parseLapTime } from '../../engine/format';
import { validateRaceData, type QuickUpdateInput, type ValidationWarning } from '../../engine/validate';
import type { CarEntry, Race, TrafficLevel } from '../../engine/types';
import { useUnits } from '../../lib/units';
import { useStore } from '../../store/store';
import { Modal } from '../ui';

interface Draft {
  lap: string;
  time: string;
  fuel: string;
  energy: string;
  tire: string;
  lapTime: string;
  compound: string;
  gapAhead: string;
  gapBehind: string;
  position: string;
  traffic: TrafficLevel;
  weather: string;
}

function fromCar(car: CarEntry, nowSec: number, u: ReturnType<typeof useUnits>): Draft {
  const l = car.live;
  return {
    lap: String(l.lapsCompleted + 1),
    time: formatClock(nowSec),
    fuel: u.fuelVal(l.fuelL).toFixed(1),
    energy: l.energyPct.toFixed(1),
    tire: String(l.tireAge),
    lapTime: l.lastLapMs ? formatLapMs(l.lastLapMs) : '',
    compound: l.compound,
    gapAhead: l.gapAheadSec != null ? l.gapAheadSec.toFixed(1) : '',
    gapBehind: l.gapBehindSec != null ? l.gapBehindSec.toFixed(1) : '',
    position: l.position != null ? String(l.position) : '',
    traffic: l.traffic,
    weather: l.weather,
  };
}

/**
 * QUICK UPDATE — the fast manual input path. Only changed fields are sent;
 * everything is validated before the engine accepts it.
 */
export function QuickUpdatePanel({ race, car, nowSec, onRecordStop }: { race: Race; car: CarEntry; nowSec: number; onRecordStop: (prefill?: { fuelAfterL?: number }) => void }) {
  const u = useUnits();
  const settings = useStore((s) => s.settings);
  const quickUpdate = useStore((s) => s.quickUpdate);
  const [draft, setDraft] = useState<Draft>(() => fromCar(car, nowSec, u));
  const [more, setMore] = useState(false);
  const [pending, setPending] = useState<{ input: QuickUpdateInput; warnings: ValidationWarning[] } | null>(null);
  const [timeTouched, setTimeTouched] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  const baseline = useMemo(() => fromCar(car, nowSec, u), [car.live, u]); // eslint-disable-line react-hooks/exhaustive-deps

  // reset the form whenever the underlying state changes (another update, demo lap, pit stop)
  useEffect(() => {
    setDraft(fromCar(car, nowSec, u));
    setTimeTouched(false);
  }, [car.live.lapsCompleted, car.live.stintIndex, car.live.inputs.length, car.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // keep race time following the clock until the user edits it
  useEffect(() => {
    if (!timeTouched) setDraft((d) => ({ ...d, time: formatClock(nowSec) }));
  }, [Math.floor(nowSec), timeTouched]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.key.toLowerCase() === 'u' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        firstRef.current?.focus();
        firstRef.current?.select();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const changed = (k: keyof Draft) => draft[k] !== baseline[k] && !(k === 'time' && !timeTouched);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (k === 'time') setTimeTouched(true);
    setDraft((d) => ({ ...d, [k]: e.target.value }));
  };

  const build = (): QuickUpdateInput | string => {
    const input: QuickUpdateInput = {};
    // an emptied field is not a zero
    const num = (s: string) => (s.trim() === '' ? NaN : Number(s.trim().replace(',', '.')));
    if (changed('lap')) {
      const n = num(draft.lap);
      if (!isFinite(n) || n < 1) return 'Current lap must be a number ≥ 1';
      input.lapsCompleted = Math.round(n) - 1;
    }
    if (timeTouched && changed('time')) {
      const s = parseClock(draft.time);
      if (s == null) return 'Race time format h:mm:ss';
      input.raceTimeSec = s;
    } else if (input.lapsCompleted != null && input.lapsCompleted > car.live.lapsCompleted) {
      // clock time counts only if it is plausible for the laps entered (paused clocks are ignored)
      const delta = input.lapsCompleted - car.live.lapsCompleted;
      const per = (nowSec - car.live.lastLapEndSec) / delta;
      const ref = car.setup.racePaceMs / 1000;
      if (per > ref * 0.6 && per < ref * 3) input.raceTimeSec = nowSec;
    }
    if (changed('fuel')) {
      const v = num(draft.fuel);
      if (!isFinite(v)) return 'Fuel must be a number';
      input.fuelL = u.fuelFromDisplay(v);
    }
    if (changed('energy')) {
      const v = num(draft.energy);
      if (!isFinite(v)) return 'Energy must be a number';
      input.energyPct = v;
    }
    if (changed('tire')) {
      const v = num(draft.tire);
      if (!isFinite(v) || v < 0) return 'Tire age must be ≥ 0';
      input.tireAge = Math.round(v);
    }
    if (changed('lapTime') && draft.lapTime.trim()) {
      const ms = parseLapTime(draft.lapTime);
      if (ms == null) return 'Lap time format m:ss.sss';
      input.lastLapMs = ms;
    }
    if (changed('compound')) input.compound = draft.compound;
    // gaps and position may be cleared (unknown) but not garbled
    const optional = (s: string) => (s.trim() ? num(s) : null);
    if (changed('gapAhead')) input.gapAheadSec = optional(draft.gapAhead);
    if (changed('gapBehind')) input.gapBehindSec = optional(draft.gapBehind);
    if (changed('position')) {
      const v = optional(draft.position);
      input.position = v == null ? null : Math.round(v);
    }
    if ([input.gapAheadSec, input.gapBehindSec].some((g) => g != null && (!isFinite(g) || g < 0))) return 'Gaps must be seconds ≥ 0';
    if (input.position != null && (!isFinite(input.position) || input.position < 1)) return 'Position must be a number ≥ 1';
    if (changed('traffic')) input.traffic = draft.traffic;
    if (changed('weather')) input.weather = draft.weather;
    return input;
  };
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    const input = build();
    if (typeof input === 'string') {
      setErr(input);
      return;
    }
    setErr(null);
    if (Object.keys(input).length === 0) return;
    const warnings = validateRaceData(car, input, settings, race.events);
    if (warnings.length) {
      setPending({ input, warnings });
      return;
    }
    quickUpdate(race.id, car.id, input);
  };

  const nChanged = (['lap', 'fuel', 'energy', 'tire', 'lapTime', 'compound', 'gapAhead', 'gapBehind', 'position', 'traffic', 'weather'] as (keyof Draft)[]).filter(changed).length + (timeTouched && changed('time') ? 1 : 0);
  const disabled = car.live.phase !== 'racing';
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') {
      setDraft(fromCar(car, nowSec, u));
      setTimeTouched(false);
    }
  };

  return (
    <section className="panel qu">
      <header className="panel-h">
        <span className="label">Quick update</span>
        <div className="meta">
          <span className="sublabel" title="Manual input — the system does not read telemetry">
            MANUAL · last input L{car.live.lastUpdateLap + 1}
          </span>
          <kbd title="Focus quick update">U</kbd>
        </div>
      </header>
      <div className="panel-b" onKeyDown={onKey}>
        <fieldset disabled={disabled} className="qu-grid">
          <label className="qu-f">
            <span className="label">Current lap</span>
            <div className="row gap-4">
              <input ref={firstRef} className={`input num lg ${changed('lap') ? 'changed' : ''}`} value={draft.lap} onChange={set('lap')} inputMode="numeric" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className="btn sm" onClick={() => setDraft((d) => ({ ...d, lap: String(Number(d.lap) + 1), tire: String(Number(d.tire) + 1) }))} title="Next lap (+1, tire age +1)">
                +1
              </button>
            </div>
          </label>
          <label className="qu-f">
            <span className="label">
              Race time {timeTouched ? '' : <span className="dim">(clock)</span>}
            </span>
            <input className={`input num lg ${timeTouched && changed('time') ? 'changed' : ''}`} value={draft.time} onChange={set('time')} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <label className="qu-f">
            <span className="label">Fuel remaining</span>
            <span className="input-wrap">
              <input className={`input num lg ${changed('fuel') ? 'changed' : ''}`} value={draft.fuel} onChange={set('fuel')} inputMode="decimal" onFocus={(e) => e.currentTarget.select()} />
              <span className="unit">{u.fuelUnit}</span>
            </span>
          </label>
          {car.setup.energyEnabled && (
            <label className="qu-f">
              <span className="label">Energy remaining</span>
              <span className="input-wrap">
                <input className={`input num lg ${changed('energy') ? 'changed' : ''}`} value={draft.energy} onChange={set('energy')} inputMode="decimal" onFocus={(e) => e.currentTarget.select()} />
                <span className="unit">%</span>
              </span>
            </label>
          )}
          <label className="qu-f">
            <span className="label">Tire age</span>
            <span className="input-wrap">
              <input className={`input num lg ${changed('tire') ? 'changed' : ''}`} value={draft.tire} onChange={set('tire')} inputMode="numeric" onFocus={(e) => e.currentTarget.select()} />
              <span className="unit">laps</span>
            </span>
          </label>
          <label className="qu-f">
            <span className="label">Last lap time</span>
            <input className={`input num lg ${changed('lapTime') ? 'changed' : ''}`} value={draft.lapTime} onChange={set('lapTime')} placeholder="1:35.000" onFocus={(e) => e.currentTarget.select()} />
          </label>
          {more && (
            <>
              <label className="qu-f">
                <span className="label">Compound</span>
                <select className={`select ${changed('compound') ? 'changed' : ''}`} value={draft.compound} onChange={set('compound')}>
                  {car.setup.compounds.map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="qu-f">
                <span className="label">Position</span>
                <input className={`input num ${changed('position') ? 'changed' : ''}`} value={draft.position} onChange={set('position')} placeholder="—" />
              </label>
              <label className="qu-f">
                <span className="label">Gap ahead (s)</span>
                <input className={`input num ${changed('gapAhead') ? 'changed' : ''}`} value={draft.gapAhead} onChange={set('gapAhead')} placeholder="—" />
              </label>
              <label className="qu-f">
                <span className="label">Gap behind (s)</span>
                <input className={`input num ${changed('gapBehind') ? 'changed' : ''}`} value={draft.gapBehind} onChange={set('gapBehind')} placeholder="—" />
              </label>
              <label className="qu-f">
                <span className="label">Traffic</span>
                <select className={`select ${changed('traffic') ? 'changed' : ''}`} value={draft.traffic} onChange={set('traffic')}>
                  <option value="clear">Clear</option>
                  <option value="light">Light</option>
                  <option value="heavy">Heavy</option>
                </select>
              </label>
              <label className="qu-f">
                <span className="label">Weather</span>
                <input className={`input ${changed('weather') ? 'changed' : ''}`} value={draft.weather} onChange={set('weather')} />
              </label>
            </>
          )}
        </fieldset>
        {err && <div className="notice red mt-8">{err}</div>}
        <div className="row mt-8 gap-4">
          <button className="btn primary grow" onClick={submit} disabled={disabled || nChanged === 0} title="Enter">
            Update race{nChanged ? ` · ${nChanged}` : ''}
          </button>
          <button className="btn ghost sm" onClick={() => setMore((m) => !m)}>
            {more ? 'Less' : 'More'}
          </button>
        </div>
        <div className="sublabel mt-4">Values at the start of the current lap. Enter = update · Esc = reset.</div>
      </div>
      {pending && (
        <ValidationModal
          warnings={pending.warnings}
          onConfirm={() => {
            quickUpdate(race.id, car.id, pending.input);
            setPending(null);
          }}
          onEdit={() => {
            setPending(null);
            setTimeout(() => firstRef.current?.focus(), 0);
          }}
          onDismiss={() => {
            setPending(null);
            setDraft(fromCar(car, nowSec, u));
            setTimeTouched(false);
          }}
          onRecordStop={
            pending.warnings.some((w) => w.suggestsPit)
              ? () => {
                  setPending(null);
                  onRecordStop({ fuelAfterL: pending.input.fuelL });
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

export function ValidationModal({ warnings, onConfirm, onEdit, onDismiss, onRecordStop }: { warnings: ValidationWarning[]; onConfirm: () => void; onEdit: () => void; onDismiss: () => void; onRecordStop?: () => void }) {
  const critical = warnings.some((w) => w.severity === 'critical');
  return (
    <Modal
      title={
        <div className="row">
          <span className={`badge ${critical ? 'red solid' : 'amber'}`}>Data input conflict</span>
          <span className="sublabel">Verify before the engine accepts these values</span>
        </div>
      }
      onClose={onEdit}
      footer={
        <>
          <button className="btn ghost" onClick={onDismiss} title="Discard this update">
            Dismiss
          </button>
          <button className="btn" onClick={onEdit} autoFocus>
            Edit
          </button>
          {onRecordStop && (
            <button className="btn info" onClick={onRecordStop}>
              Record pit stop…
            </button>
          )}
          <button className={`btn ${critical ? 'danger' : 'warn'}`} onClick={onConfirm}>
            Confirm values
          </button>
        </>
      }
    >
      <div className="col">
        {warnings.map((w, i) => (
          <div key={i} className={`notice ${w.severity === 'critical' ? 'red' : 'amber'}`}>
            <div className="label" style={{ color: w.severity === 'critical' ? 'var(--red)' : 'var(--amber)' }}>
              {w.severity === 'critical' ? 'Critical' : 'Warning'} · {w.code.replace(/_/g, ' ')}
            </div>
            <div>{w.message}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

import { Link } from 'react-router-dom';
import type { AlertItem } from '../../engine/calls';
import { formatClock, formatDelta, formatDurationShort, wallClock } from '../../engine/format';
import { RACE_STATES, type LiveProjection } from '../../engine/live';
import { calculateTirePerformance, getCompound, TEMPLATE_LABEL } from '../../engine/model';
import type { CallStatus, CarEntry, DriveMode, FuelMethod, Race } from '../../engine/types';
import { driverName, driverOf } from '../../lib/hooks';
import { useUnits } from '../../lib/units';
import { useStore } from '../../store/store';
import { IconDriver, IconFuel, IconTire } from '../icons';
import { Badge, Bar, ConfidenceBadge, NumInput, Panel, Seg, Stat } from '../ui';
import { PriorityBadge } from './RaceStatusBadge';

const MODES: { value: DriveMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'fuelSave', label: 'Fuel save' },
  { value: 'energySave', label: 'Energy save' },
  { value: 'push', label: 'Push' },
];

function flagColor(f?: string) {
  return f === 'LATE' ? 'red' : f === 'EARLY' ? 'amber' : f === 'OPTIMAL' ? 'green' : undefined;
}

export function CurrentStintCard({ race, car, p }: { race: Race; car: CarEntry; p: LiveProjection }) {
  const u = useUnits();
  const setDriveMode = useStore((s) => s.setDriveMode);
  const logCall = useStore((s) => s.logCall);
  const { live, setup } = car;
  const cur = p.current;
  const target = p.window.target;
  const stintLen = cur ? cur.endLap - live.stintStartLap + 1 : 0;
  const done = Math.max(0, p.currentLap - live.stintStartLap);
  const d = driverOf(car, live.driverId);
  const spec = getCompound(setup, live.compound);
  const fuelLow = p.fuelAtPitLaps < 1;
  const energyLow = setup.energyEnabled && p.energyTargetPct != null && live.energyPct < p.energyTargetPct - 1;
  const flag = p.isFinalStint ? 'FINAL' : cur?.flag;
  const windowLeft = stintLen > 0 ? ((p.window.earliest - live.stintStartLap) / stintLen) * 100 : 0;
  const windowRight = stintLen > 0 ? ((p.window.latest - live.stintStartLap + 1) / stintLen) * 100 : 0;
  return (
    <Panel
      title="Current stint"
      meta={
        <>
          {flag && flag !== 'FINAL' && (
            <Badge size="sm" color={flagColor(flag)} title="Planned in-lap vs. safe stint length (EARLY = 3+ laps before the limit)">
              {flag} PIT
            </Badge>
          )}
          {flag === 'FINAL' && <Badge size="sm">To flag</Badge>}
        </>
      }
    >
      <div className="cs-top">
        <div className="cs-driver">
          <span className="drv-swatch" style={{ background: d?.color, width: 4, height: 34 }} />
          <div>
            <div className="cs-name">{(d?.name ?? '—').toUpperCase()}</div>
            <div className="sublabel">
              Stint {live.stintIndex + 1} · {d?.code ?? ''}
              {d?.number ? ` · #${d.number}` : ''}
            </div>
          </div>
        </div>
        <div className="cs-laps">
          <span className="mono">{done}</span>
          <span className="mono of">/ {p.isFinalStint ? '—' : stintLen}</span>
          <span className="label">laps</span>
        </div>
      </div>
      <div className="cs-bar" title={`Window laps ${p.window.earliest}–${p.window.latest}`}>
        {!p.isFinalStint && <span className="cs-win" style={{ left: `${Math.max(0, windowLeft)}%`, width: `${Math.max(1, windowRight - windowLeft)}%` }} />}
        <Bar pct={stintLen ? (done / stintLen) * 100 : 0} color="blue" size="lg" />
        <div className="row between mono dim" style={{ fontSize: 11, marginTop: 3 }}>
          <span>L{live.stintStartLap}</span>
          <span>{p.isFinalStint ? 'TO FLAG' : `BOX L${target}`}</span>
        </div>
      </div>
      <div className="cs-grid">
        <Stat k={<><IconFuel size={11} /> Fuel</>} v={u.fuel(live.fuelL)} u={u.fuelUnit} color={fuelLow ? 'red' : undefined} h={`${u.n(p.fuelRange.theoretical, 1)} laps theor.`} />
        <Stat k={<><IconTire size={11} /> Tires</>} v={live.tireAge} u={`laps · ${live.compound.slice(0, 3)}`} color={live.tireAge >= spec.maxLife ? 'red' : live.tireAge >= spec.targetLife ? 'amber' : undefined} h={`target ${spec.targetLife} · max ${spec.maxLife}`} />
        {setup.energyEnabled && (
          <Stat k="Energy" v={u.pct(live.energyPct)} u="%" color={energyLow ? 'amber' : 'violet'} h={p.energyTargetPct != null ? `target ${u.pct(p.energyTargetPct)}%` : undefined} />
        )}
        <Stat k="Pace" v={u.lap(live.lastLapMs)} h={`avg ${u.lap(p.pace.avgMs || null)}`} />
      </div>
      <div className="cs-mode">
        <span className="label">Mode</span>
        <Seg
          options={MODES}
          value={live.driveMode}
          onChange={(m) => {
            setDriveMode(race.id, car.id, m);
            logCall(race.id, car.id, `MODE → ${MODES.find((x) => x.value === m)!.label.toUpperCase()}`, 'INFO', 'Instructed by pitwall', 'ISSUED', 'manual');
          }}
        />
      </div>
    </Panel>
  );
}

export function RaceStatePanel({ race, car, p, onRecordStop }: { race: Race; car: CarEntry; p: LiveProjection; onRecordStop: () => void }) {
  const setPitPhase = useStore((s) => s.setPitPhase);
  const prepareGrid = useStore((s) => s.prepareGrid);
  const startRace = useStore((s) => s.startRace);
  const finishRace = useStore((s) => s.finishRace);
  const { live } = car;
  const stateColor = p.state === 'SAFETY CAR' || p.state === 'SLOW ZONE' ? 'amber' : p.state.startsWith('PIT') ? 'blue' : p.state === 'FINISH' ? '' : p.state === 'STRATEGY CHANGE' ? 'blue' : 'green';
  return (
    <Panel title="Race state" meta={<span className={`rs-now c-${stateColor}`}>{p.state}</span>}>
      <div className="rs-chips">
        {RACE_STATES.map((s) => (
          <span key={s} className={`rs-chip ${s === p.state ? 'on' : ''}`}>
            {s}
          </span>
        ))}
      </div>
      <div className="row wrap gap-4 mt-8">
        {live.phase === 'pre' && (
          <button className="btn sm" onClick={() => prepareGrid(race.id)}>
            Cars to grid
          </button>
        )}
        {(live.phase === 'pre' || live.phase === 'grid') && (
          <button className="btn sm go" onClick={() => startRace(race.id)}>
            Start race
          </button>
        )}
        {live.phase === 'racing' && (
          <>
            <button className={`btn sm ${live.pitPhase === 'entry' ? 'on' : ''}`} onClick={() => setPitPhase(race.id, car.id, live.pitPhase === 'entry' ? null : 'entry')} title="Car entering pit lane">
              Pit entry
            </button>
            <button className={`btn sm ${live.pitPhase === 'stationary' ? 'on' : ''}`} onClick={() => setPitPhase(race.id, car.id, 'stationary')} title="Car stationary in box">
              In box
            </button>
            <button className={`btn sm ${live.pitPhase === 'exit' ? 'on' : ''}`} onClick={() => setPitPhase(race.id, car.id, 'exit')} title="Car leaving pit lane">
              Pit exit
            </button>
            <button className="btn sm info" onClick={onRecordStop} title="Record the completed stop (P)">
              Record stop…
            </button>
            {!race.isDemo && (
              <button
                className="btn sm ghost"
                onClick={() => {
                  if (confirm('Show the chequered flag for all cars?')) finishRace(race.id);
                }}
              >
                Finish
              </button>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

const LAST_N = [3, 5, 8, 10];

/** Consumption method picker — one compact select (lives in the Fuel panel header). */
function FuelMethodSelect({ race, car, current }: { race: Race; car: CarEntry; current: number }) {
  const setFuelMethod = useStore((s) => s.setFuelMethod);
  const { live } = car;
  const value = live.fuelMethod === 'lastN' ? `lastN:${live.lastN}` : live.fuelMethod;
  const windows = [...new Set([...LAST_N, live.lastN])].sort((a, b) => a - b);
  return (
    <select
      className="select xs"
      value={value}
      title="Consumption calculation method"
      aria-label="Fuel consumption method"
      onChange={(e) => {
        const [m, n] = e.target.value.split(':');
        // switching to a user value starts from the rate in use now, so projections do not jump
        const user = m === 'user' && live.userFuelPerLapL == null ? current : undefined;
        setFuelMethod(race.id, car.id, m as FuelMethod, n ? Number(n) : undefined, user);
      }}
    >
      {windows.map((n) => (
        <option key={n} value={`lastN:${n}`}>
          Last {n} laps
        </option>
      ))}
      <option value="stint">Stint avg</option>
      <option value="race">Race avg</option>
      <option value="user">User value</option>
    </select>
  );
}

export function FuelCard({ race, car, p }: { race: Race; car: CarEntry; p: LiveProjection }) {
  const u = useUnits();
  const setFuelMethod = useStore((s) => s.setFuelMethod);
  const { live, setup } = car;
  const margin = p.isFinalStint ? (p.current?.fuelMarginLaps ?? 0) : p.fuelAtPitLaps;
  const mColor = margin < 1 ? 'red' : margin < 2 ? 'amber' : 'green';
  return (
    <Panel
      title={<span className="label"><IconFuel size={11} /> Fuel</span>}
      meta={
        <>
          <FuelMethodSelect race={race} car={car} current={p.fuelRate.value} />
          <ConfidenceBadge c={p.fuelRate.confidence} basis={p.fuelRate.source} />
        </>
      }
      className="kpi"
    >
      <div className="row between">
        <Stat k="Remaining" v={u.fuel(live.fuelL)} u={u.fuelUnit} size="lg" />
        {live.fuelMethod === 'user' ? (
          <div className="stat right" style={{ width: 96 }}>
            <span className="k">Per lap (user)</span>
            <NumInput size="sm" value={u.fuelVal(live.userFuelPerLapL ?? p.fuelRate.value)} decimals={u.fuelUnit === 'gal' ? 3 : 2} step={0.01} unit={u.fuelUnit} onChange={(v) => setFuelMethod(race.id, car.id, 'user', undefined, u.fuelFromDisplay(v))} />
          </div>
        ) : (
          <Stat k="Per lap" v={u.fpl(p.fuelRate.value)} u={`${u.fuelUnit}/lap`} className="right" h={p.fuelRate.measured ? <span className="tag-measured">MEASURED</span> : <span className="tag-assumption">ESTIMATE</span>} />
        )}
      </div>
      <div className="kv mt-8">
        <span className="k">Theoretical</span>
        <span className="v">{u.n(p.fuelRange.theoretical, 2)} laps</span>
        <span className="k">Safe (−{setup.fuelSafetyMarginLaps} lap)</span>
        <span className="v">{u.n(p.fuelRange.safe, 2)} laps</span>
        <span className="k">{p.isFinalStint ? 'Target' : 'Target pit'}</span>
        <span className="v">{p.isFinalStint ? 'FLAG' : `LAP ${p.window.target}`}</span>
        <span className="k">{p.isFinalStint ? 'Margin at flag' : 'At pit'}</span>
        <span className={`v c-${mColor}`}>
          {p.isFinalStint ? '' : `${u.fuel(p.fuelAtPitL)} ${u.fuelUnit} · `}
          {formatDelta(margin, 1)} laps
        </span>
        <span className="k">Fuel save req.</span>
        <span className={`v ${p.fuelSavePct > 0 ? 'c-amber' : ''}`}>{p.fuelSavePct > 0 ? `−${u.n(p.fuelSavePct, 1)}% → ${u.fpl(p.fuelRequiredPerLap)}` : 'NONE'}</span>
        <span className="k">To finish race</span>
        <span className="v">
          {u.fuel(p.fuelToFinishRaceL, 0)} {u.fuelUnit}
        </span>
      </div>
    </Panel>
  );
}

export function TireCard({ car, p }: { car: CarEntry; p: LiveProjection }) {
  const { live, setup } = car;
  const spec = getCompound(setup, live.compound);
  const lossNow = calculateTirePerformance(spec, live.tireAge);
  const lossPit = calculateTirePerformance(spec, p.tireAgeAtPit);
  const remaining = spec.targetLife - live.tireAge;
  const pct = (live.tireAge / spec.maxLife) * 100;
  const color = live.tireAge >= spec.maxLife ? 'red' : live.tireAge >= spec.targetLife ? 'amber' : 'green';
  const ns = p.nextStop;
  return (
    <Panel title={<span className="label"><IconTire size={11} /> Tires</span>} meta={<span className="tag-assumption" title="Degradation is a user-entered assumption">DEG ASSUMED</span>} className="kpi">
      <div className="row between">
        <Stat k="Compound / age" v={live.tireAge} u="laps" size="lg" color={color === 'green' ? undefined : color} />
        <Stat k="Compound" v={live.compound} className="right" />
      </div>
      <Bar pct={pct} color={color} marks={[(spec.targetLife / spec.maxLife) * 100]} title={`Target ${spec.targetLife} / max ${spec.maxLife} laps`} />
      <div className="kv mt-8">
        <span className="k">Competitive life</span>
        <span className={`v ${remaining < 0 ? 'c-amber' : ''}`}>{remaining >= 0 ? `${remaining} laps left` : `${-remaining} over target`}</span>
        <span className="k">Pace loss now</span>
        <span className="v">{formatDelta(lossNow, 2)} s</span>
        <span className="k">{p.isFinalStint ? 'At flag' : 'At pit'}</span>
        <span className="v">
          {p.tireAgeAtPit} laps · {formatDelta(lossPit, 2)} s
        </span>
        <span className="k">Next stop</span>
        <span className="v">{p.isFinalStint ? '—' : ns?.changeTires ? `NEW ${ns.compound}` : 'NO CHANGE'}</span>
        {!p.isFinalStint && ns && !ns.changeTires && p.nextStint && (
          <>
            <span className="k">End next stint</span>
            <span className={`v ${p.nextStint.tireAgeEnd > spec.targetLife ? 'c-amber' : ''}`}>{p.nextStint.tireAgeEnd} laps</span>
          </>
        )}
      </div>
    </Panel>
  );
}

export function EnergyCard({ car, p }: { car: CarEntry; p: LiveProjection }) {
  const u = useUnits();
  const { live, setup } = car;
  if (!setup.energyEnabled)
    return (
      <Panel title="Energy" className="kpi">
        <div className="empty">Virtual energy tracking disabled in setup.</div>
      </Panel>
    );
  const delta = p.energyTargetPct != null ? live.energyPct - p.energyTargetPct : 0;
  const status = delta < -1 ? 'BELOW TARGET' : delta > 2 ? 'ABOVE TARGET' : 'ON TARGET';
  const sColor = delta < -1 ? 'amber' : 'green';
  const atFinish = p.sim.laps[p.sim.laps.length - 1]?.energyAfterPct;
  return (
    <Panel title={<span className="label c-violet">Virtual energy</span>} meta={<ConfidenceBadge c={p.energyRate.confidence} basis={p.energyRate.source} />} className="kpi">
      <div className="row between">
        <Stat k="Remaining" v={u.pct(live.energyPct)} u="%" size="lg" color="violet" />
        <Stat k="Target now" v={p.energyTargetPct != null ? u.pct(p.energyTargetPct) : '—'} u="%" className="right" />
      </div>
      <Bar pct={live.energyPct} color="violet" marks={p.energyTargetPct != null ? [p.energyTargetPct] : []} />
      <div className="kv mt-8">
        <span className="k">Delta</span>
        <span className={`v c-${sColor}`}>{formatDelta(delta, 1)} %</span>
        <span className="k">Per lap</span>
        <span className="v">{u.n(p.energyRate.value, 2)} %</span>
        <span className="k">{p.isFinalStint ? 'At flag' : 'Projected at pit'}</span>
        <span className={`v ${p.energyAtPitPct < setup.energyReservePct ? 'c-red' : ''}`}>{u.pct(p.energyAtPitPct)} %</span>
        <span className="k">Proj. at finish</span>
        <span className="v">{u.pct(atFinish)} %</span>
        <span className="k">Status</span>
        <span className={`v c-${sColor}`}>{p.energySavePct > 0 ? `SAVE ${u.n(p.energySavePct, 1)}%` : status}</span>
      </div>
    </Panel>
  );
}

export function PaceCard({ car, p }: { car: CarEntry; p: LiveProjection }) {
  const u = useUnits();
  const { live } = car;
  return (
    <Panel title="Pace" meta={<span className="sublabel">{p.pace.samples} green laps</span>} className="kpi">
      <div className="row between">
        <Stat k="Last lap" v={u.lap(live.lastLapMs)} size="lg" />
        <Stat k="Best" v={u.lap(live.bestLapMs)} className="right" />
      </div>
      <div className="kv mt-8">
        <span className="k">Avg (recent)</span>
        <span className="v">{u.lap(p.pace.avgMs || null)}</span>
        <span className="k">Expected next</span>
        <span className="v">{u.lap(p.pace.predictedMs)}</span>
        <span className="k">vs model</span>
        <span className="v">{formatDelta(p.pace.biasMs / 1000, 2)} s</span>
        <span className="k">Gap ahead</span>
        <span className="v">{live.gapAheadSec != null ? `${u.n(live.gapAheadSec, 1)} s` : '—'}</span>
        <span className="k">Gap behind</span>
        <span className="v">{live.gapBehindSec != null ? `${u.n(live.gapBehindSec, 1)} s` : '—'}</span>
        <span className="k">Traffic</span>
        <span className={`v ${live.traffic === 'heavy' ? 'c-amber' : ''}`}>{live.traffic.toUpperCase()}</span>
      </div>
    </Panel>
  );
}

export function PitWindowCard({ race, car, p, nowSec, onOverride }: { race: Race; car: CarEntry; p: LiveProjection; nowSec: number; onOverride: () => void }) {
  const u = useUnits();
  const h24 = useStore((s) => s.settings.time.clock24h);
  const logCall = useStore((s) => s.logCall);
  const setPitOverride = useStore((s) => s.setPitOverride);
  const ns = p.nextStop;
  const w = p.window;
  const overridden = car.live.pitLapOverrides[car.live.stintIndex] != null;
  if (car.live.phase !== 'racing' || p.isFinalStint || !ns) {
    return (
      <Panel title="Next pit window" className="pw">
        <div className="pw-final">
          <div className="label">{car.live.phase === 'finished' ? 'Race complete' : p.isFinalStint ? 'Final stint' : 'Pre-race'}</div>
          <div className="pw-laps mono">{p.isFinalStint ? 'TO FLAG' : `LAP ${p.sim.stops[0]?.lap ?? '—'}`}</div>
          {p.isFinalStint && p.current && (
            <div className="sublabel">
              Fuel margin at flag {u.n(p.current.fuelMarginLaps, 1)} laps · energy {u.n(p.current.energyMarginLaps, 1)} laps
            </div>
          )}
        </div>
      </Panel>
    );
  }
  const stateColor = w.state === 'OPEN' ? 'green' : w.state === 'CLOSING' ? 'amber' : w.state === 'MISSED' ? 'red' : undefined;
  const span0 = Math.min(p.currentLap, w.earliest) - 1;
  const span1 = Math.max(w.latest, w.target) + 2;
  const pos = (lap: number) => ((lap - span0) / Math.max(1, span1 - span0)) * 100;
  const entryWall = wallClock(race.params.startTimeISO, ns.entrySec, h24);
  const flag = p.current?.flag;
  return (
    <Panel
      title="Next pit window"
      className="pw"
      meta={
        <>
          {overridden && <Badge size="sm" color="blue">Override</Badge>}
          <Badge size="sm" color={stateColor}>
            {w.state}
          </Badge>
        </>
      }
    >
      <div className="pw-main">
        <div>
          <div className="label">Window</div>
          <div className="pw-laps mono">
            {w.earliest === w.latest ? `LAP ${w.latest}` : `LAP ${w.earliest}–${w.latest}`}
          </div>
        </div>
        <div className="right">
          <div className="label">Target</div>
          <div className={`pw-target mono ${flag === 'LATE' ? 'c-red' : ''}`}>LAP {w.target}</div>
        </div>
      </div>
      <div className="pw-scale" title="Window (shaded), target (marker), current lap (NOW)">
        <span className="pw-open" style={{ left: `${pos(w.earliest - 1)}%`, width: `${Math.max(1, pos(w.latest) - pos(w.earliest - 1))}%` }} />
        <span className="pw-cur" style={{ left: `${pos(p.currentLap - 1)}%` }} />
        <span className={`pw-tgt ${flag === 'LATE' ? 'late' : ''}`} style={{ left: `${pos(w.target)}%` }} />
      </div>
      <div className="row between mt-4">
        <span className="sublabel">
          {w.lapsTo <= 0 ? 'THIS LAP' : `in ${w.lapsTo} lap${w.lapsTo > 1 ? 's' : ''}`} · ~{formatDurationShort(Math.max(0, ns.entrySec - nowSec))} · {entryWall}
        </span>
        {flag && <Badge size="sm" color={flagColor(flag)}>{flag} PIT</Badge>}
      </div>
      <div className="pw-action">
        <div className="pw-tpl">{TEMPLATE_LABEL[ns.template]}</div>
        <div className="pw-items">
          <span>
            <IconFuel size={11} /> +{u.fuel(ns.fuelAddedL)} {u.fuelUnit}
          </span>
          <span className={ns.changeTires ? '' : 'dim'}>
            <IconTire size={11} /> {ns.changeTires ? `NEW ${ns.compound}` : 'NO TIRES'}
          </span>
          <span className={ns.driverChange ? '' : 'dim'}>
            <IconDriver size={11} /> {ns.driverChange ? `→ ${driverName(car, ns.toDriverId).toUpperCase()}` : 'NO CHANGE'}
          </span>
        </div>
        <div className="kv mt-4">
          <span className="k">Stationary</span>
          <span className="v">{u.n(ns.stationarySec, 1)} s</span>
          <span className="k">Total pit loss</span>
          <span className="v">{u.n(ns.totalLossSec, 1)} s</span>
          <span className="k">Reason</span>
          <span className="v l" style={{ textAlign: 'right' }}>
            {ns.reason}
          </span>
        </div>
      </div>
      <div className="row gap-4 mt-8">
        <button className="btn sm go grow" onClick={() => logCall(race.id, car.id, `BOX LAP ${w.target} CONFIRMED`, 'ACTION', `${TEMPLATE_LABEL[ns.template]} · +${u.fuel(ns.fuelAddedL)} ${u.fuelUnit}`, 'CONFIRMED', 'system')}>
          Accept
        </button>
        <button className="btn sm grow" onClick={onOverride}>
          Edit / override
        </button>
        {overridden && (
          <button className="btn sm ghost" onClick={() => setPitOverride(race.id, car.id, car.live.stintIndex, null, 'Return to plan')} title="Clear override">
            Clear
          </button>
        )}
      </div>
    </Panel>
  );
}

export function AlertPanel({ alerts }: { alerts: AlertItem[] }) {
  return (
    <div className="alerts" role="status">
      <span className="label">Alerts</span>
      {alerts.length === 0 && <span className="sublabel">No active alerts</span>}
      {alerts.map((a) => (
        <span key={a.code} className={`alert ${a.level}`}>
          {a.text}
        </span>
      ))}
    </div>
  );
}

const STATUS_COLOR: Record<CallStatus, string> = {
  ISSUED: 'blue',
  CONFIRMED: 'green',
  CANCELLED: '',
  CHANGED: 'amber',
  COMPLETED: 'green',
  LOGGED: '',
};

export function StatusBadge({ s }: { s: CallStatus }) {
  return (
    <span className={`badge sm ghost ${STATUS_COLOR[s]}`} style={{ opacity: s === 'CANCELLED' ? 0.6 : 1 }}>
      {s}
    </span>
  );
}

export function RaceCallHistory({ race, car, limit = 12, compact }: { race: Race; car: CarEntry; limit?: number; compact?: boolean }) {
  const setCallStatus = useStore((s) => s.setCallStatus);
  const calls = [...car.live.calls].reverse().slice(0, limit);
  return (
    <div className={`call-hist ${compact ? 'compact' : ''}`}>
      {calls.length === 0 && <div className="empty">No calls yet.</div>}
      {calls.map((c) => (
        <div key={c.id} className={`ch-row p-${c.priority}`}>
          <span className="mono dim ch-t">{formatClock(c.raceTimeSec)}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ch-text ellipsis">{c.text}</div>
            {!compact && c.reason && <div className="sublabel ellipsis">{c.reason}</div>}
          </div>
          {c.status === 'ISSUED' ? (
            <div className="row gap-4">
              <button className="btn xs" onClick={() => setCallStatus(race.id, car.id, c.id, 'CONFIRMED')} title="Driver acknowledged">
                ✓
              </button>
              <button className="btn xs ghost" onClick={() => setCallStatus(race.id, car.id, c.id, 'CANCELLED')} title="Cancel call">
                ✕
              </button>
            </div>
          ) : (
            <StatusBadge s={c.status} />
          )}
        </div>
      ))}
    </div>
  );
}

export function UpcomingCalls({ calls }: { calls: { key: string; text: string; priority: import('../../engine/types').CallPriority; reasons: string[] }[] }) {
  return (
    <div className="upcoming">
      {calls.length === 0 && <div className="sublabel">No further calls.</div>}
      {calls.map((c) => (
        <div key={c.key} className={`up-row p-${c.priority}`} title={c.reasons.join(' · ')}>
          <PriorityBadge p={c.priority} size="sm" />
          <span className="ellipsis">{c.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Strategy versions in race order — which plan is running and why it changed. */
export function StrategyVersionsCard({ race, car }: { race: Race; car: CarEntry }) {
  const versions = [...car.versions].reverse();
  return (
    <Panel
      title="Strategy versions"
      className="live-versions"
      scroll
      bodyClass="flush"
      meta={
        <Link className="btn xs ghost" to={`/app/race/${race.id}/strategy/versions`}>
          All
        </Link>
      }
    >
      {versions.length === 0 ? (
        <div className="empty">No versions saved yet.</div>
      ) : (
        <div className="ver-log">
          {versions.map((v, i) => (
            <div key={v.id} className={`ver-row ${i === 0 ? 'cur' : ''}`} title={v.reason}>
              <span className="mono ver-v">v{v.version}</span>
              <span className="mono dim ver-l">{v.lap ? `L${v.lap}` : 'PRE'}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="ellipsis">{v.label}</div>
                <div className="sublabel ellipsis">{v.reason}</div>
              </div>
              {i === 0 && <Badge size="sm" color="blue">Active</Badge>}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

import { useState } from 'react';
import { formatClock, formatLapMs } from '../../engine/format';
import { PIT_TEMPLATES, TEMPLATE_LABEL } from '../../engine/model';
import {
  addStint,
  applyTemplate,
  autoBalance,
  buildPlan,
  deleteStint,
  duplicateStint,
  moveStint,
  updateStint,
  updateStop,
  type Distribution,
} from '../../engine/planner';
import { calculateRequiredStops, calculateStintLength, type SimStint, type SimStop } from '../../engine/simulate';
import type { DriveMode, PitTemplate, StrategyPlan } from '../../engine/types';
import { IconDown, IconUp, IconCopy, IconPlus, IconTrash } from '../../components/icons';
import { Field, LapTimeInput, NumInput, Panel, Seg } from '../../components/ui';
import { isLive } from '../../lib/hooks';
import { useUnits } from '../../lib/units';
import { actualStints } from '../../engine/analysis';
import { liveSimOptions } from '../../engine/live';
import { useStore } from '../../store/store';
import { DriverChip } from '../../components/race/DriverChip';
import { marginClass } from '../../lib/margins';
import { DRIVE_MODES, MODE_LABEL } from '../../lib/labels';
import { flagClass, IssueList, RefillInput, type TabProps } from './shared';

export function BuilderTab({ race, car, res }: TabProps) {
  const setPlan = useStore((s) => s.setPlan);
  const [sel, setSel] = useState(0);
  const plan = car.plan;
  const edit = (p: StrategyPlan) => setPlan(race.id, car.id, p);
  const index = Math.min(sel, plan.stints.length - 1);
  return (
    <div className="builder">
      <Panel title="Plan flow" className="bld-flow" meta={<span className="sublabel">click a stint to edit</span>} bodyClass="flush">
        <PlanFlow tab={{ race, car, res }} sel={index} onSel={setSel} edit={edit} />
      </Panel>
      <div className="col gap-8" style={{ minWidth: 0 }}>
        <StintEditor tab={{ race, car, res }} index={index} edit={edit} />
      </div>
      <div className="col gap-8" style={{ minWidth: 0 }}>
        <PlanSettings tab={{ race, car, res }} edit={edit} />
        <AutoBuild tab={{ race, car, res }} edit={edit} />
        <Panel title="Plan check">
          <IssueList issues={res.issues} />
        </Panel>
      </div>
    </div>
  );
}

function PlanFlow({ tab, sel, onSel, edit }: { tab: TabProps; sel: number; onSel: (i: number) => void; edit: (p: StrategyPlan) => void }) {
  const { car, res } = tab;
  const u = useUnits();
  const plan = car.plan;
  const byIndex = new Map(res.stints.map((s) => [s.index, s]));
  const stopAfter = new Map(res.stops.map((s) => [s.afterStint, s]));
  // live: stints before the current one are history — shown as driven, not editable in structure
  const cur = isLive(car) ? car.live.stintIndex : -1;
  const done = new Map(cur > 0 ? actualStints(car).filter((a) => a.index < cur).map((a) => [a.index, a]) : []);
  const doneStop = new Map(cur > 0 ? car.live.stops.map((x) => [x.index, x]) : []);
  const act = (e: React.MouseEvent, fn: () => void) => {
    e.stopPropagation();
    fn();
  };
  return (
    <ol className="flow">
      <li className="flow-node flow-start">
        <span className="flow-dot" />
        <div>
          <div className="flow-t">START</div>
          <div className="sublabel">
            {plan.startCompound} {plan.startTireAge ? `+${plan.startTireAge} laps` : 'new'} · fuel {plan.startFuel === 'full' || plan.startFuel === 'auto' ? plan.startFuel.toUpperCase() : u.fuelU(plan.startFuel)}
            {car.setup.energyEnabled ? ` · energy ${plan.startEnergyPct}%` : ''}
          </div>
        </div>
      </li>
      {plan.stints.map((st, i) => {
        const s = byIndex.get(i);
        const a = done.get(i);
        const stop = stopAfter.get(i);
        const ds = doneStop.get(i);
        const locked = i <= cur; // completed or being driven: order and existence are fixed
        const unused = !s && !a;
        return (
          <li key={st.id} className="flow-group">
            <div className={`flow-node flow-stint ${sel === i ? 'sel' : ''} ${unused ? 'unused' : ''} ${a ? 'done' : ''}`} onClick={() => onSel(i)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSel(i)}>
              <span className="flow-bar" style={{ background: car.drivers.find((d) => d.id === st.driverId)?.color }} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row between">
                  <span className="row gap-8">
                    <b className="mono">S{i + 1}</b>
                    <DriverChip car={car} id={st.driverId} name />
                  </span>
                  <span className="mono">{s ? `L${s.startLap}–${s.endLap}` : a ? `L${a.startLap}–${a.endLap}` : 'not reached'}</span>
                </div>
                <div className="row between sublabel">
                  <span>
                    {a && !s ? `${a.laps} laps · ${a.compound} · driven` : `${s ? `${s.laps} laps` : `${st.targetLaps} planned`} · ${s?.compound ?? '—'} · ${MODE_LABEL[st.mode]}`}
                    {i === cur && ' · NOW'}
                  </span>
                  {s && (
                    <span>
                      <span className={marginClass(s.fuelMarginLaps)}>fuel {u.n(s.fuelMarginLaps, 1)}</span>
                      {!s.final && <span className={flagClass(s.flag)}> · {s.flag}</span>}
                      {s.final && ' · TO FLAG'}
                    </span>
                  )}
                </div>
              </div>
              <div className="flow-act">
                <button className="btn xs ghost icon" title="Move up" disabled={i === 0 || i <= cur + 1} onClick={(e) => act(e, () => (edit(moveStint(plan, i, i - 1)), onSel(i - 1)))}>
                  <IconUp size={12} />
                </button>
                <button className="btn xs ghost icon" title="Move down" disabled={i === plan.stints.length - 1 || locked} onClick={(e) => act(e, () => (edit(moveStint(plan, i, i + 1)), onSel(i + 1)))}>
                  <IconDown size={12} />
                </button>
                <button className="btn xs ghost icon" title="Duplicate stint" disabled={i < cur} onClick={(e) => act(e, () => edit(duplicateStint(plan, i)))}>
                  <IconCopy size={12} />
                </button>
                <button className="btn xs ghost icon" title="Add stint after" disabled={i < cur} onClick={(e) => act(e, () => (edit(addStint(plan, i)), onSel(i + 1)))}>
                  <IconPlus size={12} />
                </button>
                <button className="btn xs ghost icon" title="Delete stint" disabled={plan.stints.length <= 1 || locked} onClick={(e) => act(e, () => (edit(deleteStint(plan, i)), onSel(Math.max(0, i - 1))))}>
                  <IconTrash size={12} />
                </button>
              </div>
            </div>
            {stop && <PitNode stop={stop} />}
            {!stop && ds && (
              <div className="flow-node flow-pit">
                <span className="flow-pin" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row between">
                    <span className="flow-t">
                      PIT {ds.index + 1} · L{ds.lap}
                    </span>
                    <span className="mono">{u.n(ds.totalLossSec, 1)} s</span>
                  </div>
                  <div className="sublabel">
                    done · +{u.fuelU(ds.fuelAddedL)}
                    {ds.changeTires ? ` · ${ds.compound}` : ''} · {u.n(ds.stationarySec, 1)} s stationary
                  </div>
                </div>
              </div>
            )}
          </li>
        );
      })}
      <li className="flow-node flow-finish">
        <span className="flow-dot" />
        <div>
          <div className="flow-t">FINISH</div>
          <div className="sublabel">
            L{res.totalLaps} · {formatClock(res.finishSec)}
            {res.unusedStints > 0 && <span className="c-amber"> · {res.unusedStints} stint{res.unusedStints > 1 ? 's' : ''} not reached</span>}
          </div>
        </div>
      </li>
    </ol>
  );
}

function PitNode({ stop }: { stop: SimStop }) {
  const u = useUnits();
  return (
    <div className="flow-node flow-pit" title={stop.reason}>
      <span className="flow-pin" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row between">
          <span className="flow-t">
            PIT {stop.index + 1} · L{stop.lap}
          </span>
          <span className="mono">{u.n(stop.totalLossSec, 1)} s</span>
        </div>
        <div className="sublabel">
          {TEMPLATE_LABEL[stop.template]} · +{u.fuelU(stop.fuelAddedL)}
          {stop.changeTires ? ` · ${stop.compound}` : ''} · {u.n(stop.stationarySec, 1)} s stationary
        </div>
      </div>
    </div>
  );
}

function StintEditor({ tab, index, edit }: { tab: TabProps; index: number; edit: (p: StrategyPlan) => void }) {
  const { car, res } = tab;
  const u = useUnits();
  const plan = car.plan;
  const st = plan.stints[index];
  const s = res.stints.find((x) => x.index === index);
  const stop = res.stops.find((x) => x.afterStint === index);
  const isLast = index === plan.stints.length - 1;
  const set = (patch: Parameters<typeof updateStint>[2]) => edit(updateStint(plan, index, patch));
  const setStop = (patch: Parameters<typeof updateStop>[2]) => edit(updateStop(plan, index, patch));
  // a stint already driven is history: shown, not editable
  const completed = isLive(car) && index < car.live.stintIndex;
  if (!st) return null;
  return (
    <fieldset className="bare col gap-8" disabled={completed} title={completed ? 'Driven stint — history, not editable' : undefined}>
      <Panel
        title={`Stint ${index + 1}`}
        meta={
          s ? (
            <span className="sublabel">{s.final ? 'final stint — runs to the flag' : `limited by ${s.limiter}`}</span>
          ) : completed ? (
            <span className="sublabel">completed — see Analysis</span>
          ) : (
            <span className="sublabel c-amber">not reached by the race distance</span>
          )
        }
      >
        <div className="grid-3">
          <Field label="Driver">
            <select className="select" value={st.driverId} onChange={(e) => set({ driverId: e.target.value })}>
              {car.drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Target laps" hint={isLast ? 'Final stint runs to the flag' : undefined}>
            <NumInput value={isLast && s ? s.laps : st.targetLaps} decimals={0} min={1} disabled={isLast} onChange={(v) => set({ targetLaps: Math.round(v) })} />
          </Field>
          <Field label="Drive mode" hint="Effects are the user-defined values in Race Setup">
            <select className="select" value={st.mode} onChange={(e) => set({ mode: e.target.value as DriveMode })}>
              {DRIVE_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field group label="Lap time override" right={st.lapTimeOverrideMs != null && <button className="btn xs ghost" onClick={() => set({ lapTimeOverrideMs: undefined })}>clear</button>} hint="Blank = driver / car pace">
            <LapTimeInput value={st.lapTimeOverrideMs} onChange={(ms) => set({ lapTimeOverrideMs: ms })} onClear={() => set({ lapTimeOverrideMs: undefined })} />
          </Field>
          <Field group label={`Fuel/lap override (${u.fuelUnit})`} right={st.fuelPerLapOverrideL != null && <button className="btn xs ghost" onClick={() => set({ fuelPerLapOverrideL: undefined })}>clear</button>} hint="Blank = car value × driver factor">
            <NumInput value={st.fuelPerLapOverrideL == null ? null : u.fuelVal(st.fuelPerLapOverrideL)} decimals={3} step={0.01} min={0.01} placeholder="—" onChange={(v) => set({ fuelPerLapOverrideL: u.fuelFromDisplay(v) })} onClear={() => set({ fuelPerLapOverrideL: undefined })} />
          </Field>
          {car.setup.energyEnabled ? (
            <Field group label="Energy budget (%)" right={st.energyTargetPct != null && <button className="btn xs ghost" onClick={() => set({ energyTargetPct: undefined })}>clear</button>} hint="Optional stint energy budget">
              <NumInput value={st.energyTargetPct} decimals={1} min={0} max={100} placeholder="—" onChange={(v) => set({ energyTargetPct: v })} onClear={() => set({ energyTargetPct: undefined })} />
            </Field>
          ) : (
            <div />
          )}
        </div>
        <Field label="Notes" className="mt-8">
          <input className="input" value={st.notes ?? ''} placeholder="e.g. traffic expected at the start of this stint" onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </Panel>

      {!isLast && (
        <Panel title={`Pit stop after stint ${index + 1}`} meta={stop && <span className="sublabel">in-lap {stop.lap} · {formatClock(stop.entrySec)}</span>}>
          <div className="grid-3">
            <Field label="Template">
              <select className="select" value={st.stop.template} onChange={(e) => edit(applyTemplate(plan, index, e.target.value as PitTemplate, car.drivers))}>
                {PIT_TEMPLATES.map((t) => (
                  <option key={t} value={t}>
                    {TEMPLATE_LABEL[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field group label="Fuel">
              <RefillInput value={st.stop.fuel} unit={u.fuelUnit} toDisplay={u.fuelVal} fromDisplay={u.fuelFromDisplay} onChange={(v) => setStop({ fuel: v })} />
            </Field>
            {car.setup.energyEnabled ? (
              <Field group label="Energy">
                <RefillInput value={st.stop.energy} unit="%" onChange={(v) => setStop({ energy: v })} />
              </Field>
            ) : (
              <div />
            )}
            <Field group label="Tires">
              <div className="row gap-8">
                <label className="check">
                  <input type="checkbox" checked={st.stop.changeTires} onChange={(e) => setStop({ changeTires: e.target.checked })} /> Change
                </label>
                <select className="select" value={st.stop.compound} disabled={!st.stop.changeTires} onChange={(e) => setStop({ compound: e.target.value })}>
                  {car.setup.compounds.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Extra work (s)" hint="Repairs, penalties, custom work">
              <NumInput value={st.stop.extraSec} decimals={1} min={0} onChange={(v) => setStop({ extraSec: v })} />
            </Field>
            <Field label="Reason">
              <input className="input" value={st.stop.reason} placeholder="auto" onChange={(e) => setStop({ reason: e.target.value })} />
            </Field>
          </div>
          {stop && (
            <div className="row gap-16 mt-12 wrap">
              <span className="sublabel">Calculated:</span>
              <span className="mono">+{u.fuelU(stop.fuelAddedL)}</span>
              {car.setup.energyEnabled && <span className="mono c-violet">+{u.n(stop.energyAddedPct, 1)} %</span>}
              <span className="mono">fuel {u.n(stop.fuelSec, 1)} s</span>
              <span className="mono">tires {u.n(stop.tireSec, 1)} s</span>
              <span className="mono">driver {u.n(stop.driverSec, 1)} s</span>
              <span className="mono">stationary {u.n(stop.stationarySec, 1)} s</span>
              <b className="mono">total loss {u.n(stop.totalLossSec, 1)} s</b>
            </div>
          )}
        </Panel>
      )}

      {s && <StintResult s={s} tab={tab} />}
    </fieldset>
  );
}

function StintResult({ s, tab }: { s: SimStint; tab: TabProps }) {
  const u = useUnits();
  const energy = tab.car.setup.energyEnabled;
  const lim = (k: keyof SimStint['maxLaps']) => (isFinite(s.maxLaps[k]) ? s.maxLaps[k] : '—');
  return (
    <Panel title="Calculated stint" meta={<span className="tag-calc">CALCULATED</span>}>
      <div className="grid-2 kv-grid">
        <div className="kv">
          <span className="k">Laps</span>
          <span className="v">
            {s.startLap}–{s.endLap} ({s.laps})
          </span>
          <span className="k">Start</span>
          <span className="v">{formatClock(s.startSec)}</span>
          <span className="k">End</span>
          <span className="v">{formatClock(s.endSec)}</span>
          <span className="k">Avg lap</span>
          <span className="v">{formatLapMs(s.avgLapMs)}</span>
        </div>
        <div className="kv">
          <span className="k">Fuel start</span>
          <span className="v">{u.fuelU(s.fuelStartL)}</span>
          <span className="k">Used</span>
          <span className="v">
            {u.fuelU(s.fuelUsedL)} · {u.fpl(s.fuelPerLapL)}/lap
          </span>
          <span className="k">{s.final ? 'At flag' : 'At stop'}</span>
          <span className="v">{u.fuelU(s.fuelEndL)}</span>
          <span className="k">Margin</span>
          <span className={`v ${marginClass(s.fuelMarginLaps)}`}>{u.n(s.fuelMarginLaps, 2)} laps</span>
        </div>
        {energy ? (
          <div className="kv">
            <span className="k">Energy start</span>
            <span className="v">{u.pct(s.energyStartPct)} %</span>
            <span className="k">Used</span>
            <span className="v">
              {u.pct(s.energyUsedPct)} % · {u.n(s.energyPerLapPct, 2)}/lap
            </span>
            <span className="k">{s.final ? 'At flag' : 'At stop'}</span>
            <span className="v">{u.pct(s.energyEndPct)} %</span>
            <span className="k">Margin</span>
            <span className={`v ${marginClass(s.energyMarginLaps)}`}>{u.n(s.energyMarginLaps, 2)} laps</span>
          </div>
        ) : (
          <div />
        )}
        <div className="kv">
          <span className="k">Tires</span>
          <span className="v">
            {s.compound} {s.tireAgeStart}→{s.tireAgeEnd}
          </span>
          <span className="k">Max laps</span>
          <span className="v" title="fuel / energy / tire / driver">
            F {lim('fuel')} · E {lim('energy')} · T {lim('tire')} · D {lim('driver')}
          </span>
          <span className="k">Window</span>
          <span className="v">{s.final ? 'FLAG' : `L${s.window.earliest}–${s.window.latest}`}</span>
          <span className="k">Pit flag</span>
          <span className={`v ${flagClass(s.flag)}`}>{s.final ? 'FINAL' : s.flag}</span>
        </div>
      </div>
    </Panel>
  );
}

function PlanSettings({ tab, edit }: { tab: TabProps; edit: (p: StrategyPlan) => void }) {
  const { car } = tab;
  const u = useUnits();
  const plan = car.plan;
  const set = (patch: Partial<StrategyPlan>) => edit({ ...plan, ...patch });
  // start fuel, compound and energy only shape the race from lap 1
  const started = car.live.phase === 'racing' || car.live.phase === 'finished';
  return (
    <Panel title="Race start" meta={started ? <span className="sublabel">fixed once the race has started</span> : undefined}>
      <fieldset className="bare grid-2" disabled={started}>
        <Field label="Plan name" className="span-2">
          <input className="input" value={plan.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Start compound">
          <select className="select" value={plan.startCompound} onChange={(e) => set({ startCompound: e.target.value })}>
            {car.setup.compounds.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Start tire age (laps)">
          <NumInput value={plan.startTireAge} decimals={0} min={0} onChange={(v) => set({ startTireAge: Math.round(v) })} />
        </Field>
        <Field group label="Start fuel" className="span-2">
          <RefillInput value={plan.startFuel} unit={u.fuelUnit} toDisplay={u.fuelVal} fromDisplay={u.fuelFromDisplay} onChange={(v) => set({ startFuel: v })} />
        </Field>
        {car.setup.energyEnabled && (
          <Field label="Start energy (%)">
            <NumInput value={plan.startEnergyPct} decimals={1} min={0} max={100} onChange={(v) => set({ startEnergyPct: v })} />
          </Field>
        )}
      </fieldset>
    </Panel>
  );
}

function AutoBuild({ tab, edit }: { tab: TabProps; edit: (p: StrategyPlan) => void }) {
  const { race, car, res } = tab;
  const settings = useStore((s) => s.settings);
  // live: keep the stints driven so far and the current one; build the rest from the live state
  const live = isLive(car);
  const keepFirst = live ? Math.min(car.live.stintIndex + 1, car.plan.stints.length) : 0;
  const sim = live ? liveSimOptions(race, car, settings) : undefined;
  const full = calculateStintLength(car.setup, sim?.fuelPerLapL, sim?.energyPerLapPct, car.plan.startCompound);
  const lapsToBuild = live ? Math.max(0, res.totalLaps - (res.stints[0]?.endLap ?? car.live.lapsCompleted)) : res.totalLaps;
  const minStops = live ? (lapsToBuild > 0 ? 1 + calculateRequiredStops(lapsToBuild, full.overall) : 0) : calculateRequiredStops(res.totalLaps, full.overall);
  const [stops, setStops] = useState(Math.max(minStops, res.stops.length));
  const [tireEvery, setTireEvery] = useState(2);
  const [block, setBlock] = useState(1);
  const [mode, setMode] = useState<DriveMode>('normal');
  const [dist, setDist] = useState<Distribution>('even');
  const [order, setOrder] = useState(() => car.drivers.map((d) => d.id));
  // keep the chosen order, drop removed drivers and append new ones
  const ordered = [...order.filter((id) => car.drivers.some((d) => d.id === id)), ...car.drivers.filter((d) => !order.includes(d.id)).map((d) => d.id)];
  const limiter = full.overall === full.fuel ? 'fuel' : full.overall === full.energy ? 'energy' : full.overall === full.tire ? 'tires' : 'driver';
  return (
    <Panel title="Auto-build" meta={<span className="sublabel">{live ? 'replaces the stints after the current one' : 'replaces all stints'}</span>}>
      <div className="notice mb-8">
        Longest safe stint on a full tank: <b className="mono">{full.overall}</b> laps (limited by {limiter}{live ? ', measured rates' : ''}).{' '}
        {live ? (
          <>
            After the current stint: {lapsToBuild} laps — at least <b className="mono">{minStops}</b> more stop{minStops === 1 ? '' : 's'}.
          </>
        ) : (
          <>
            Minimum for {res.totalLaps} laps: <b className="mono">{minStops}</b> stops.
          </>
        )}
      </div>
      <div className="grid-2">
        <Field label={live ? 'Stops left' : 'Stops'}>
          <NumInput value={stops} decimals={0} min={0} onChange={(v) => setStops(Math.round(v))} />
        </Field>
        <Field group label="Stint laps">
          <Seg options={[{ value: 'even' as Distribution, label: 'Even' }, { value: 'maxFirst' as Distribution, label: 'Max first' }]} value={dist} onChange={setDist} />
        </Field>
        <Field group label="New tires">
          <Seg options={[1, 2, 3, 0].map((n) => ({ value: n, label: n === 0 ? 'Never' : n === 1 ? 'Every' : `×${n}` , title: n === 0 ? 'Never change tires' : n === 1 ? 'Every stop' : `Every ${n} stints` }))} value={tireEvery} onChange={setTireEvery} />
        </Field>
        <Field group label="Stints per driver">
          <Seg options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} value={block} onChange={setBlock} />
        </Field>
        <Field group label="Mode" className="span-2">
          <Seg options={DRIVE_MODES} value={mode} onChange={setMode} />
        </Field>
        <Field group label="Driver order" className="span-2">
          <div className="col gap-4">
            {ordered.map((id, i) => (
              <div key={id} className="row gap-4">
                <span className="mono dim" style={{ width: 16 }}>
                  {i + 1}
                </span>
                <DriverChip car={car} id={id} name />
                <span className="grow" />
                <button className="btn xs ghost icon" disabled={i === 0} onClick={() => setOrder(swap(ordered, i, i - 1))} title="Earlier">
                  <IconUp size={12} />
                </button>
                <button className="btn xs ghost icon" disabled={i === ordered.length - 1} onClick={() => setOrder(swap(ordered, i, i + 1))} title="Later">
                  <IconDown size={12} />
                </button>
              </div>
            ))}
          </div>
        </Field>
      </div>
      <div className="row gap-4 mt-12">
        <button
          className="btn primary grow"
          onClick={() => {
            if (!confirm(live ? 'Replace the stints after the current one with an auto-built plan?' : 'Replace all stints with an auto-built plan?')) return;
            edit(buildPlan(race.params, car.setup, car.drivers, { stops, tireEvery, driverOrder: ordered, driverBlock: block, mode, distribution: dist, compound: live ? car.live.compound : car.plan.startCompound, name: car.plan.name, base: car.plan, keepFirst, sim }));
          }}
        >
          Build plan
        </button>
        <button className="btn" onClick={() => edit(autoBalance(race.params, car.setup, car.drivers, car.plan, keepFirst, { distribution: dist, sim }))} title={live ? 'Keep stints, drivers and stops; re-distribute the laps after the current stint' : 'Keep stints, drivers and stops; re-distribute laps'}>
          Re-balance laps
        </button>
      </div>
    </Panel>
  );
}

function swap<T>(arr: T[], a: number, b: number): T[] {
  const out = [...arr];
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}

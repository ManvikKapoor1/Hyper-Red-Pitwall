import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { RaceContextBar, RaceNotFound } from '../components/race/RaceContextBar';
import { CarSelector } from '../components/race/RaceHeader';
import { DRIVER_COLORS } from '../engine/factory';
import { netEnergyPerLap } from '../engine/model';
import { planUsesCompound } from '../engine/planner';
import { calculateRequiredStops, calculateStintLength, estimateRaceLaps } from '../engine/simulate';
import type { CarEntry, CarSetup, CompoundSpec, DriveMode, Race, RaceParams } from '../engine/types';
import { IconPlus, IconTrash } from '../components/icons';
import { ClockInput, Field, LapTimeInput, NumInput, Panel, Seg, Stat } from '../components/ui';
import { activeCar, useRaceFromRoute } from '../lib/hooks';
import { useUnits } from '../lib/units';
import { CONCURRENCY, DRIVE_MODES } from '../lib/labels';
import { useStore } from '../store/store';

export function RaceSetupPage() {
  const race = useRaceFromRoute();
  if (!race) return <RaceNotFound />;
  return <RaceSetup race={race} car={activeCar(race)} />;
}

function RaceSetup({ race, car }: { race: Race; car: CarEntry }) {
  const addCar = useStore((s) => s.addCar);
  const removeCar = useStore((s) => s.removeCar);
  const updateCarMeta = useStore((s) => s.updateCarMeta);
  return (
    <>
      <RaceContextBar
        race={race}
        cars={false}
        actions={
          <Link className="btn sm primary" to={`/app/race/${race.id}/strategy`}>
            Strategy →
          </Link>
        }
      >
        <span className="sublabel">Every number here is your own input — STINT does not assume LMU values.</span>
      </RaceContextBar>
      <div className="page full">
        <div className="setup-grid">
          <RaceSection race={race} />
          <div className="col gap-8">
            <Panel
              title="Cars"
              meta={
                <button
                  className="btn xs"
                  disabled={race.status === 'LIVE' || race.status === 'FINISHED'}
                  onClick={() => addCar(race.id)}
                  title={race.status === 'LIVE' || race.status === 'FINISHED' ? 'Cars can only be added before the start' : "Add a car (copies the active car's setup and plan)"}
                >
                  <IconPlus size={12} /> Add car
                </button>
              }
            >
              <div className="row gap-12 wrap">
                <CarSelector race={race} />
                <Field label="Number">
                  <input className="input" style={{ width: 80 }} value={car.number} onChange={(e) => updateCarMeta(race.id, car.id, { number: e.target.value })} />
                </Field>
                <Field label="Team" className="grow">
                  <input className="input" value={car.teamName} onChange={(e) => updateCarMeta(race.id, car.id, { teamName: e.target.value })} />
                </Field>
                <button className="btn sm ghost" style={{ alignSelf: 'flex-end' }} disabled={race.cars.length <= 1} onClick={() => confirm(`Remove car #${car.number} and its live data?`) && removeCar(race.id, car.id)}>
                  <IconTrash size={12} /> Remove
                </button>
              </div>
            </Panel>
            <Derived race={race} car={car} />
          </div>
          <CarSection race={race} car={car} />
          <PitSection race={race} car={car} />
          <EnergySection race={race} car={car} />
          <TiresSection race={race} car={car} />
          <MarginsSection race={race} car={car} />
          <DriversSection race={race} car={car} />
        </div>
      </div>
    </>
  );
}

function RaceSection({ race }: { race: Race }) {
  const u = useUnits();
  const update = useStore((s) => s.updateRaceParams);
  const tracks = useStore((s) => s.library.tracks);
  const p = race.params;
  const set = (patch: Partial<RaceParams>) => update(race.id, patch);
  return (
    <Panel title="Race" className="span-2">
      <div className="grid-4">
        <Field label="Race name" className="span-2">
          <input className="input" value={p.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Track" hint="Pick from the library to fill the length">
          <input
            className="input"
            list="track-lib"
            value={p.track}
            onChange={(e) => {
              const t = tracks.find((x) => x.name === e.target.value);
              set(t ? { track: t.name, trackLengthKm: t.lengthKm } : { track: e.target.value });
            }}
          />
          <datalist id="track-lib">
            {tracks.map((t) => (
              <option key={t.id} value={t.name} />
            ))}
          </datalist>
        </Field>
        <Field label={`Track length (${u.distUnit})`}>
          <NumInput value={u.distVal(p.trackLengthKm)} decimals={3} min={0} onChange={(v) => set({ trackLengthKm: u.distFromDisplay(v) })} />
        </Field>
        <Field group label="Race length">
          <Seg options={[{ value: 'time' as const, label: 'Timed' }, { value: 'laps' as const, label: 'Laps' }]} value={p.lengthMode} onChange={(v) => set({ lengthMode: v })} />
        </Field>
        {p.lengthMode === 'time' ? (
          <Field label="Duration (h:mm:ss)">
            <ClockInput value={p.durationSec} onChange={(v) => set({ durationSec: v })} />
          </Field>
        ) : (
          <Field label="Laps">
            <NumInput value={p.laps} decimals={0} min={1} onChange={(v) => set({ laps: Math.round(v) })} />
          </Field>
        )}
        <Field label="Start (local)">
          <input className="input" type="datetime-local" value={p.startTimeISO} onChange={(e) => set({ startTimeISO: e.target.value })} />
        </Field>
        <Field label="Session">
          <input className="input" value={p.sessionType} onChange={(e) => set({ sessionType: e.target.value })} />
        </Field>
        <Field label="Weather">
          <input className="input" value={p.weather} onChange={(e) => set({ weather: e.target.value })} />
        </Field>
        <Field label="Track condition">
          <input className="input" value={p.trackCondition} onChange={(e) => set({ trackCondition: e.target.value })} />
        </Field>
        <Field label={`Air temp (${u.tempUnit})`}>
          <NumInput value={u.tempVal(p.airTempC)} decimals={0} onChange={(v) => set({ airTempC: u.tempFromDisplay(v) })} />
        </Field>
        <Field label={`Track temp (${u.tempUnit})`}>
          <NumInput value={u.tempVal(p.trackTempC)} decimals={0} onChange={(v) => set({ trackTempC: u.tempFromDisplay(v) })} />
        </Field>
        <Field label="Rain probability (%)">
          <NumInput value={p.rainProbabilityPct} decimals={0} min={0} max={100} onChange={(v) => set({ rainProbabilityPct: v })} />
        </Field>
        <Field label="Safety-car assumption" className="span-2">
          <input className="input" value={p.safetyCarAssumption} onChange={(e) => set({ safetyCarAssumption: e.target.value })} />
        </Field>
        <Field label="Slow-zone assumption" className="span-2">
          <input className="input" value={p.slowZoneAssumption} onChange={(e) => set({ slowZoneAssumption: e.target.value })} />
        </Field>
      </div>
    </Panel>
  );
}

function useSetup(race: Race, car: CarEntry) {
  const updateSetup = useStore((s) => s.updateSetup);
  return (patch: Partial<CarSetup>) => updateSetup(race.id, car.id, patch);
}

function Derived({ race, car }: { race: Race; car: CarEntry }) {
  const s = car.setup;
  const full = calculateStintLength(s, undefined, undefined, car.plan.startCompound);
  const laps = estimateRaceLaps(race.params, s);
  const fin = (v: number) => (isFinite(v) ? v : '—');
  return (
    <Panel title="From these inputs" meta={<span className="tag-calc">CALCULATED</span>}>
      <div className="row gap-16 wrap">
        <Stat k="Race laps (no stops)" v={laps} h={race.params.lengthMode === 'time' ? 'duration ÷ race pace' : 'entered'} />
        <Stat k="Max stint (fuel)" v={fin(full.fuel)} u="laps" />
        <Stat k="(energy)" v={fin(full.energy)} u="laps" />
        <Stat k="(tires)" v={fin(full.tire)} u="laps" h={car.plan.startCompound} />
        <Stat k="Min stops" v={calculateRequiredStops(laps, full.overall)} />
      </div>
      <div className="sublabel mt-8">Exact laps and stops come from the lap-by-lap simulation on the Strategy page.</div>
    </Panel>
  );
}

function CarSection({ race, car }: { race: Race; car: CarEntry }) {
  const u = useUnits();
  const set = useSetup(race, car);
  const s = car.setup;
  return (
    <Panel title="Car & pace">
      <div className="grid-2">
        <Field label="Car">
          <input className="input" value={s.car} onChange={(e) => set({ car: e.target.value })} />
        </Field>
        <Field label="Class">
          <input className="input" value={s.className} onChange={(e) => set({ className: e.target.value })} />
        </Field>
        <Field label={`Fuel capacity (${u.fuelUnit})`}>
          <NumInput value={u.fuelVal(s.fuelCapacityL)} decimals={1} min={1} onChange={(v) => set({ fuelCapacityL: u.fuelFromDisplay(v) })} />
        </Field>
        <Field label={`Fuel per lap (${u.fuelUnit})`} right={<span className="tag-assumption">ASSUMPTION</span>}>
          <NumInput value={u.fuelVal(s.fuelPerLapL)} decimals={3} step={0.01} min={0} onChange={(v) => set({ fuelPerLapL: u.fuelFromDisplay(v) })} />
        </Field>
        <Field label="Race pace">
          <LapTimeInput value={s.racePaceMs} onChange={(ms) => set({ racePaceMs: ms })} />
        </Field>
        <Field label="Qualifying pace">
          <LapTimeInput value={s.qualiPaceMs} onChange={(ms) => set({ qualiPaceMs: ms })} />
        </Field>
        <Field label="Wet pace">
          <LapTimeInput value={s.wetPaceMs} onChange={(ms) => set({ wetPaceMs: ms })} />
        </Field>
        <Field label={`Fuel weight effect (s per ${u.fuelUnit})`} hint="0 = ignore">
          <NumInput value={s.fuelEffectSecPerL / u.fuelVal(1)} decimals={3} step={0.001} min={0} onChange={(v) => set({ fuelEffectSecPerL: v * u.fuelVal(1) })} />
        </Field>
      </div>
    </Panel>
  );
}

function PitSection({ race, car }: { race: Race; car: CarEntry }) {
  const u = useUnits();
  const set = useSetup(race, car);
  const s = car.setup;
  return (
    <Panel title="Pit stops">
      <div className="grid-2">
        <Field label="Pit-lane loss (s)" hint="Drive-through time lost vs staying out">
          <NumInput value={s.pitLaneLossSec} decimals={1} min={0} onChange={(v) => set({ pitLaneLossSec: v })} />
        </Field>
        <Field label="Pit speed limit (km/h)">
          <NumInput value={s.pitSpeedKph} decimals={0} min={0} onChange={(v) => set({ pitSpeedKph: v })} />
        </Field>
        <Field label={`Refuel rate (${u.fuelUnit}/s)`}>
          <NumInput value={u.fuelVal(s.refuelRateLps)} decimals={2} step={0.1} min={0} onChange={(v) => set({ refuelRateLps: u.fuelFromDisplay(v) })} />
        </Field>
        <Field label="Tire change (s)">
          <NumInput value={s.tireChangeSec} decimals={1} min={0} onChange={(v) => set({ tireChangeSec: v })} />
        </Field>
        <Field label="Driver change (s)">
          <NumInput value={s.driverChangeSec} decimals={1} min={0} onChange={(v) => set({ driverChangeSec: v })} />
        </Field>
        <Field group label="Service order" className="span-2">
          <Seg options={CONCURRENCY} value={s.concurrency} onChange={(v) => set({ concurrency: v })} />
        </Field>
      </div>
    </Panel>
  );
}

function EnergySection({ race, car }: { race: Race; car: CarEntry }) {
  const set = useSetup(race, car);
  const s = car.setup;
  const on = s.energyEnabled;
  return (
    <Panel
      title={<span className="label c-violet">Virtual energy</span>}
      meta={
        <label className="check">
          <input type="checkbox" checked={on} onChange={(e) => set({ energyEnabled: e.target.checked })} /> Track energy
        </label>
      }
    >
      <fieldset className="plain-fs" disabled={!on}>
        <div className="grid-2">
          <Field label="Allocation (%)">
            <NumInput value={s.energyCapacityPct} decimals={1} min={1} onChange={(v) => set({ energyCapacityPct: v })} />
          </Field>
          <Field label="Use per lap (%)" right={<span className="tag-assumption">ASSUMPTION</span>}>
            <NumInput value={s.energyPerLapPct} decimals={2} step={0.05} min={0} onChange={(v) => set({ energyPerLapPct: v })} />
          </Field>
          <Field label="Recovery per lap (%)" hint={`Net ${netEnergyPerLap(s).toFixed(2)} %/lap`}>
            <NumInput value={s.energyRecoveryPerLapPct} decimals={2} step={0.05} min={0} onChange={(v) => set({ energyRecoveryPerLapPct: v })} />
          </Field>
          <Field label="Target per stint (%)">
            <NumInput value={s.energyTargetPerStintPct} decimals={1} min={0} onChange={(v) => set({ energyTargetPerStintPct: v })} />
          </Field>
          <Field label="Deploy target" className="span-2">
            <input className="input" value={s.energyDeployTarget} onChange={(e) => set({ energyDeployTarget: e.target.value })} />
          </Field>
        </div>
      </fieldset>
    </Panel>
  );
}

function MarginsSection({ race, car }: { race: Race; car: CarEntry }) {
  const set = useSetup(race, car);
  const s = car.setup;
  const mode = (m: DriveMode, patch: Partial<CarSetup['modes'][DriveMode]>) => set({ modes: { ...s.modes, [m]: { ...s.modes[m], ...patch } } });
  return (
    <Panel title="Margins & drive modes">
      <div className="grid-3">
        <Field label="Fuel reserve (laps)" hint="Kept in the tank at each planned stop">
          <NumInput value={s.fuelReserveLaps} decimals={2} step={0.1} min={0} onChange={(v) => set({ fuelReserveLaps: v })} />
        </Field>
        <Field label="Fuel safety margin (laps)" hint="Theoretical → safe laps">
          <NumInput value={s.fuelSafetyMarginLaps} decimals={2} step={0.1} min={0} onChange={(v) => set({ fuelSafetyMarginLaps: v })} />
        </Field>
        <Field label="Energy reserve (%)">
          <NumInput value={s.energyReservePct} decimals={1} min={0} onChange={(v) => set({ energyReservePct: v })} />
        </Field>
      </div>
      <table className="table compact mt-12">
        <thead>
          <tr>
            <th>Mode</th>
            <th className="n">Fuel %</th>
            <th className="n">Energy %</th>
            <th className="n">Lap time s</th>
          </tr>
        </thead>
        <tbody>
          {DRIVE_MODES.map((m) => (
            <tr key={m.value}>
              <td>{m.label}</td>
              <td className="n">{m.value === 'normal' ? '0' : <NumInput size="sm" value={s.modes[m.value].fuelPct} decimals={1} min={-90} max={200} onChange={(v) => mode(m.value, { fuelPct: v })} />}</td>
              <td className="n">{m.value === 'normal' ? '0' : <NumInput size="sm" value={s.modes[m.value].energyPct} decimals={1} min={-90} max={200} onChange={(v) => mode(m.value, { energyPct: v })} />}</td>
              <td className="n">{m.value === 'normal' ? '0' : <NumInput size="sm" value={s.modes[m.value].lapSec} decimals={2} step={0.05} onChange={(v) => mode(m.value, { lapSec: v })} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sublabel mt-4">Mode effects are your own estimates relative to normal running.</div>
    </Panel>
  );
}

function TiresSection({ race, car }: { race: Race; car: CarEntry }) {
  const set = useSetup(race, car);
  const renameCompound = useStore((s) => s.renameCompound);
  const cs = car.setup.compounds;
  const inUse = (name: string) => planUsesCompound(car.plan, name) || car.live.compound === name;
  const upd = (i: number, patch: Partial<CompoundSpec>) => set({ compounds: cs.map((c, k) => (k === i ? { ...c, ...patch } : c)) });
  const num = (i: number, k: keyof CompoundSpec, d: number, step = 1, min?: number): ReactNode => <NumInput size="sm" value={cs[i][k] as number} decimals={d} step={step} min={min} onChange={(v) => upd(i, { [k]: v })} />;
  return (
    <Panel
      title="Tire compounds"
      className="span-2"
      meta={
        <button className="btn xs" onClick={() => set({ compounds: [...cs, { name: `C${cs.length + 1}`, paceOffsetSec: 0, degSecPerLap: 0.03, targetLife: 40, maxLife: 50, cliffSecPerLap: 0.1 }] })}>
          <IconPlus size={12} /> Add compound
        </button>
      }
      bodyClass="flush"
    >
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th className="n">Pace offset s</th>
            <th className="n">Degradation s/lap</th>
            <th className="n">Target life laps</th>
            <th className="n">Max life laps</th>
            <th className="n">Cliff s/lap</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {cs.map((c, i) => (
            <tr key={i}>
              <td>
                <CompoundName name={c.name} taken={cs.map((x) => x.name)} onRename={(to) => renameCompound(race.id, car.id, c.name, to)} />
              </td>
              <td className="n">{num(i, 'paceOffsetSec', 2, 0.05)}</td>
              <td className="n">{num(i, 'degSecPerLap', 3, 0.005, 0)}</td>
              <td className="n">{num(i, 'targetLife', 0, 1, 1)}</td>
              <td className="n">{num(i, 'maxLife', 0, 1, 1)}</td>
              <td className="n">{num(i, 'cliffSecPerLap', 3, 0.01, 0)}</td>
              <td className="right">
                <button className="btn xs ghost icon" disabled={cs.length <= 1 || inUse(c.name)} title={inUse(c.name) ? 'Used by the plan or fitted to the car — change those first' : 'Remove compound'} onClick={() => set({ compounds: cs.filter((_, k) => k !== i) })}>
                  <IconTrash size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function DriversSection({ race, car }: { race: Race; car: CarEntry }) {
  const u = useUnits();
  const addDriver = useStore((s) => s.addDriver);
  const updateDriver = useStore((s) => s.updateDriver);
  const removeDriver = useStore((s) => s.removeDriver);
  return (
    <Panel
      title="Drivers"
      className="span-3 scroll-x"
      meta={
        <button className="btn xs" onClick={() => addDriver(race.id, car.id)}>
          <IconPlus size={12} /> Add driver
        </button>
      }
      bodyClass="flush"
    >
      <table className="table">
        <thead>
          <tr>
            <th>Colour</th>
            <th>Name</th>
            <th>Code</th>
            <th>#</th>
            <th>Race pace</th>
            <th className="n" title="Blank = car value">Fuel/lap {u.fuelUnit}</th>
            <th className="n" title="Preferred stint laps">Pref.</th>
            <th className="n" title="Minimum stint laps">Min</th>
            <th className="n" title="Maximum stint laps">Max</th>
            <th>Tire pref.</th>
            <th>Energy pref.</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {car.drivers.map((d) => {
            const set = (patch: Parameters<typeof updateDriver>[3]) => updateDriver(race.id, car.id, d.id, patch);
            return (
              <tr key={d.id}>
                <td>
                  <div className="swatches" role="radiogroup" aria-label={`${d.name} colour`}>
                    {DRIVER_COLORS.map((c) => (
                      <button key={c} role="radio" aria-checked={d.color === c} className={d.color === c ? 'on' : ''} style={{ background: c }} onClick={() => set({ color: c })} title={c} />
                    ))}
                  </div>
                </td>
                <td>
                  <input className="input sm" style={{ minWidth: 120 }} value={d.name} onChange={(e) => set({ name: e.target.value })} />
                </td>
                <td>
                  <input className="input sm mono" style={{ width: 64 }} maxLength={4} value={d.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
                </td>
                <td>
                  <input className="input sm" style={{ width: 48 }} value={d.number ?? ''} onChange={(e) => set({ number: e.target.value })} />
                </td>
                <td style={{ width: 104 }}>
                  <LapTimeInput size="sm" value={d.paceMs} onChange={(ms) => set({ paceMs: ms })} onClear={() => set({ paceMs: undefined })} />
                </td>
                <td className="n" style={{ width: 80 }}>
                  <NumInput size="sm" value={d.fuelPerLapL == null ? null : u.fuelVal(d.fuelPerLapL)} decimals={3} step={0.01} min={0.01} placeholder="car" onChange={(v) => set({ fuelPerLapL: u.fuelFromDisplay(v) })} onClear={() => set({ fuelPerLapL: undefined })} />
                </td>
                <td className="n" style={{ width: 64 }}>
                  <NumInput size="sm" value={d.preferredStintLaps} decimals={0} min={1} placeholder="—" onChange={(v) => set({ preferredStintLaps: Math.round(v) })} onClear={() => set({ preferredStintLaps: undefined })} />
                </td>
                <td className="n" style={{ width: 64 }}>
                  <NumInput size="sm" value={d.minStintLaps} decimals={0} min={1} placeholder="—" onChange={(v) => set({ minStintLaps: Math.round(v) })} onClear={() => set({ minStintLaps: undefined })} />
                </td>
                <td className="n" style={{ width: 64 }}>
                  <NumInput size="sm" value={d.maxStintLaps} decimals={0} min={1} placeholder="—" onChange={(v) => set({ maxStintLaps: Math.round(v) })} onClear={() => set({ maxStintLaps: undefined })} />
                </td>
                <td>
                  <input className="input sm" style={{ width: 84 }} value={d.tirePreference ?? ''} onChange={(e) => set({ tirePreference: e.target.value })} />
                </td>
                <td>
                  <input className="input sm" style={{ width: 104 }} value={d.energyPreference ?? ''} onChange={(e) => set({ energyPreference: e.target.value })} />
                </td>
                <td className="right">
                  <button className="btn xs ghost icon" disabled={car.drivers.length <= 1} title="Remove driver (their stints move to the first driver)" onClick={() => confirm(`Remove ${d.name}?`) && removeDriver(race.id, car.id, d.id)}>
                    <IconTrash size={12} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

/** Compound names commit on blur so every plan / live reference is renamed with them. */
function CompoundName({ name, taken, onRename }: { name: string; taken: string[]; onRename: (to: string) => void }) {
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const next = draft.trim().toUpperCase();
  const clash = next !== name && taken.includes(next);
  return (
    <input
      className={`input sm ${clash ? 'invalid' : ''}`}
      value={draft}
      title={clash ? 'Another compound already has this name' : 'Renames the compound in the plan and live data too'}
      onChange={(e) => setDraft(e.target.value.toUpperCase())}
      onBlur={() => (next && !clash && next !== name ? onRename(next) : setDraft(name))}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

import { useMemo, useRef, useState } from 'react';
import { RaceContextBar, RaceNotFound } from '../components/race/RaceContextBar';
import { assumptionRows, driverStats, type AssumptionKey } from '../engine/assumptions';
import { formatClock, formatDelta } from '../engine/format';
import { uid } from '../engine/planner';
import type { CarEntry, Race } from '../engine/types';
import { IconPlus, IconTrash } from '../components/icons';
import { ConfidenceBadge, LapTimeInput, NumInput, Panel } from '../components/ui';
import { activeCar, useRaceFromRoute } from '../lib/hooks';
import { useUnits, type Units } from '../lib/units';
import { downloadJSON } from '../store/persistence';
import { useStore } from '../store/store';
import { DriverChip } from '../components/race/DriverChip';

export function DataPage() {
  const race = useRaceFromRoute();
  if (!race) return <RaceNotFound />;
  return <Data race={race} car={activeCar(race)} />;
}

function fmtFor(u: Units, key: AssumptionKey): (v: number) => string {
  switch (key) {
    case 'fuelPerLapL':
      return (v) => `${u.fpl(v)} ${u.fuelUnit}`;
    case 'energyPerLapPct':
      return (v) => `${u.n(v, 2)} %`;
    case 'racePaceMs':
      return (v) => u.lap(v);
    case 'pitLaneLossSec':
      return (v) => `${u.n(v, 1)} s`;
    case 'refuelRateLps':
      return (v) => `${u.n(u.fuelVal(v), 2)} ${u.fuelUnit}/s`;
  }
}

function Data({ race, car }: { race: Race; car: CarEntry }) {
  return (
    <>
      <RaceContextBar race={race}>
        <span className="sublabel">
          {car.live.laps.length} laps · {car.live.stops.length} stops recorded for #{car.number}
        </span>
      </RaceContextBar>
      <div className="page full">
        <div className="data-grid">
          <div className="col gap-8" style={{ minWidth: 0 }}>
            <Assumptions race={race} car={car} />
            <Drivers car={car} />
            <LapTable race={race} car={car} />
          </div>
          <div className="col gap-8" style={{ minWidth: 0 }}>
            <ExportImport race={race} />
            <Stops car={car} />
            <InputLog car={car} />
            <Tracks />
          </div>
        </div>
      </div>
    </>
  );
}

function Assumptions({ race, car }: { race: Race; car: CarEntry }) {
  const u = useUnits();
  const adopt = useStore((s) => s.adoptAssumption);
  const rows = useMemo(() => assumptionRows(car, race.events), [car, race.events]);
  return (
    <Panel title="Assumptions vs measured" meta={<span className="sublabel">green, non-estimated laps compared with the plan’s per-lap assumption · timed stops only</span>} bodyClass="flush">
      <table className="table">
        <thead>
          <tr>
            <th>Input</th>
            <th className="n">Entered</th>
            <th>Tag</th>
            <th className="n">Measured</th>
            <th className="n">Δ</th>
            <th>Basis</th>
            <th>Confidence</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const f = fmtFor(u, r.key);
            const d = r.measured != null && r.entered ? ((r.measured - r.entered) / r.entered) * 100 : null;
            return (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="n">{f(r.entered)}</td>
                <td>{r.measured != null && r.samples >= 3 ? <span className="tag-measured">MEASURED</span> : <span className="tag-assumption">ASSUMED</span>}</td>
                <td className="n">{r.measured != null ? f(r.measured) : '—'}</td>
                <td className={`n ${d != null && Math.abs(d) >= 3 ? 'c-amber' : ''}`}>{d != null ? `${formatDelta(d, 1)} %` : '—'}</td>
                <td className="sublabel">{r.samples ? r.basis : 'no data yet'}</td>
                <td>{r.samples > 0 ? <ConfidenceBadge c={r.confidence} basis={r.basis} /> : <span className="dim">—</span>}</td>
                <td className="right">
                  <button className="btn xs" disabled={r.measured == null || r.samples < 3} onClick={() => adopt(race.id, car.id, r.key)} title={r.samples < 3 ? 'Needs at least 3 samples' : 'Write the measured value into Race Setup (driver offsets are kept)'}>
                    Use measured
                  </button>
                </td>
              </tr>
            );
          })}
          <tr>
            <td>Tire degradation</td>
            <td className="n dim">per compound</td>
            <td>
              <span className="tag-assumption">ASSUMED</span>
            </td>
            <td className="n dim">—</td>
            <td className="n dim">—</td>
            <td className="sublabel" colSpan={3}>
              Not measured — lap time mixes fuel, traffic and mode. Compare the lap trace on the Live screen.
            </td>
          </tr>
        </tbody>
      </table>
    </Panel>
  );
}

function Drivers({ car }: { car: CarEntry }) {
  const u = useUnits();
  const stats = useMemo(() => driverStats(car), [car]);
  return (
    <Panel title="Drivers — measured" bodyClass="flush">
      <table className="table">
        <thead>
          <tr>
            <th>Driver</th>
            <th className="n">Laps</th>
            <th className="n">Green</th>
            <th className="n">Avg lap</th>
            <th className="n">Best</th>
            <th className="n">Pace entered</th>
            <th className="n">Fuel/lap</th>
            <th className="n">Fuel entered</th>
            {car.setup.energyEnabled && <th className="n">Energy/lap</th>}
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => {
            const d = car.drivers.find((x) => x.id === s.driverId)!;
            return (
              <tr key={s.driverId}>
                <td>
                  <DriverChip car={car} id={s.driverId} name />
                </td>
                <td className="n">{s.laps}</td>
                <td className="n">{s.greenLaps}</td>
                <td className="n">{u.lap(s.avgLapMs)}</td>
                <td className="n">{u.lap(s.bestLapMs)}</td>
                <td className="n dim">{u.lap(d.paceMs ?? car.setup.racePaceMs)}</td>
                <td className="n">{s.fuelPerLapL != null ? u.fpl(s.fuelPerLapL) : '—'}</td>
                <td className="n dim">{u.fpl(d.fuelPerLapL ?? car.setup.fuelPerLapL)}</td>
                {car.setup.energyEnabled && <td className="n">{s.energyPerLapPct != null ? u.n(s.energyPerLapPct, 2) : '—'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function LapTable({ race, car }: { race: Race; car: CarEntry }) {
  const u = useUnits();
  const editLap = useStore((s) => s.editLap);
  const deleteLap = useStore((s) => s.deleteLap);
  const laps = [...car.live.laps].reverse();
  return (
    <Panel title="Lap data" meta={<span className="sublabel">edit a value to correct a typo · edited laps lose the estimated flag</span>} bodyClass="flush" className="scroll lap-table">
      {laps.length === 0 ? (
        <div className="empty">No laps recorded. Laps appear here from Quick update on the Live screen.</div>
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th className="n">Lap</th>
              <th className="n">Stint</th>
              <th>Driver</th>
              <th className="n">Ended</th>
              <th style={{ width: 120 }}>Lap time</th>
              <th className="n" style={{ width: 100 }}>
                Fuel used
              </th>
              <th className="n">Fuel after</th>
              {car.setup.energyEnabled && (
                <th className="n" style={{ width: 100 }}>
                  Energy used
                </th>
              )}
              <th className="n" style={{ width: 80 }}>
                Tire age
              </th>
              <th>Flags</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {laps.map((l) => {
              const set = (patch: Parameters<typeof editLap>[3]) => editLap(race.id, car.id, l.lap, patch);
              return (
                <tr key={l.lap}>
                  <td className="n">{l.lap}</td>
                  <td className="n">S{l.stint + 1}</td>
                  <td>
                    <DriverChip car={car} id={l.driverId} />
                  </td>
                  <td className="n dim">{formatClock(l.endSec)}</td>
                  <td>
                    <LapTimeInput size="sm" value={l.lapMs} onChange={(ms) => set({ lapMs: ms })} />
                  </td>
                  <td className="n">
                    <NumInput size="sm" value={l.fuelUsedL == null ? null : u.fuelVal(l.fuelUsedL)} decimals={2} min={0} placeholder="—" onChange={(v) => set({ fuelUsedL: u.fuelFromDisplay(v) })} />
                  </td>
                  <td className="n dim">{u.fuel(l.fuelAfterL)}</td>
                  {car.setup.energyEnabled && (
                    <td className="n">
                      <NumInput size="sm" value={l.energyUsedPct} decimals={2} min={0} placeholder="—" onChange={(v) => set({ energyUsedPct: v })} />
                    </td>
                  )}
                  <td className="n">
                    <NumInput size="sm" value={l.tireAge} decimals={0} min={0} onChange={(v) => set({ tireAge: Math.round(v) })} />
                  </td>
                  <td className="dim" style={{ fontSize: 11 }}>
                    {[l.pitIn && 'PIT IN', l.event && l.event.replace('_', ' '), l.estimated && 'ESTIMATED'].filter(Boolean).join(' · ')}
                  </td>
                  <td className="right">
                    <button className="btn xs ghost icon" title={`Delete lap ${l.lap}`} onClick={() => confirm(`Delete lap ${l.lap}? Projections use the remaining laps.`) && deleteLap(race.id, car.id, l.lap)}>
                      <IconTrash size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Stops({ car }: { car: CarEntry }) {
  const u = useUnits();
  return (
    <Panel title="Recorded pit stops" bodyClass="flush">
      {car.live.stops.length === 0 ? (
        <div className="empty">No stops recorded.</div>
      ) : (
        <table className="table compact">
          <thead>
            <tr>
              <th>#</th>
              <th className="n">Lap</th>
              <th className="n">Fuel +</th>
              <th>Tires</th>
              <th>Driver</th>
              <th className="n">Stat.</th>
              <th className="n">Total</th>
            </tr>
          </thead>
          <tbody>
            {car.live.stops.map((s) => (
              <tr key={s.index}>
                <td className="mono">P{s.index + 1}</td>
                <td className="n">{s.lap}</td>
                <td className="n">{u.fuel(s.fuelAddedL)}</td>
                <td className={s.changeTires ? '' : 'dim'}>{s.changeTires ? s.compound : 'NO'}</td>
                <td>{s.fromDriverId !== s.toDriverId ? <DriverChip car={car} id={s.toDriverId} /> : <span className="dim">—</span>}</td>
                <td className="n">{u.n(s.stationarySec, 1)}</td>
                <td className="n">
                  {u.n(s.totalLossSec, 1)}
                  {s.underEvent && <span className="c-amber"> *</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function InputLog({ car }: { car: CarEntry }) {
  const inputs = [...car.live.inputs].reverse().slice(0, 40);
  return (
    <Panel title="Input log" meta={<span className="sublabel">last {inputs.length}</span>} bodyClass="flush" className="scroll input-log">
      {inputs.length === 0 ? (
        <div className="empty">No manual inputs yet.</div>
      ) : (
        <table className="table compact">
          <tbody>
            {inputs.map((i) => (
              <tr key={i.id}>
                <td className="n dim">{formatClock(i.raceTimeSec)}</td>
                <td className="n">L{i.lap}</td>
                <td className="ellipsis" style={{ maxWidth: 260 }} title={i.summary}>
                  {i.summary}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function ExportImport({ race }: { race: Race }) {
  const races = useStore((s) => s.races);
  const settings = useStore((s) => s.settings);
  const library = useStore((s) => s.library);
  const importAll = useStore((s) => s.importAll);
  const toast = useStore((s) => s.toast);
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = race.params.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return (
    <Panel title="Export / import" meta={<span className="sublabel">JSON · stays on this computer</span>}>
      <div className="row gap-4 wrap">
        <button className="btn sm" onClick={() => downloadJSON(`stint-${slug}-${stamp}.json`, { app: 'STINT', version: 1, races: [race], settings, library })}>
          Export this race
        </button>
        <button className="btn sm" onClick={() => downloadJSON(`stint-all-${stamp}.json`, { app: 'STINT', version: 1, races, settings, library })}>
          Export everything
        </button>
        <button className="btn sm warn" onClick={() => file.current?.click()}>
          Import…
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const data = JSON.parse(await f.text());
              if (!confirm('Importing replaces all races, settings and the library in this browser. Continue?')) return;
              if (importAll(data)) {
                setErr(null);
                toast('Data imported', 'ok');
              } else setErr('Not a STINT export (no races array).');
            } catch {
              setErr('Could not read the file as JSON.');
            }
          }}
        />
      </div>
      {err && <div className="notice red mt-8">{err}</div>}
    </Panel>
  );
}

function Tracks() {
  const u = useUnits();
  const tracks = useStore((s) => s.library.tracks);
  const upsertTrack = useStore((s) => s.upsertTrack);
  const removeTrack = useStore((s) => s.removeTrack);
  return (
    <Panel
      title="Track library"
      meta={
        <button className="btn xs" onClick={() => upsertTrack({ id: uid('trk'), name: 'New track', lengthKm: 5, notes: '' })}>
          <IconPlus size={12} /> Add
        </button>
      }
      bodyClass="flush"
    >
      <table className="table compact">
        <thead>
          <tr>
            <th>Name</th>
            <th className="n" style={{ width: 90 }}>
              Length {u.distUnit}
            </th>
            <th>Notes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {tracks.map((t) => (
            <tr key={t.id}>
              <td>
                <input className="input sm" value={t.name} onChange={(e) => upsertTrack({ ...t, name: e.target.value })} />
              </td>
              <td className="n">
                <NumInput size="sm" value={u.distVal(t.lengthKm)} decimals={3} min={0} onChange={(v) => upsertTrack({ ...t, lengthKm: u.distFromDisplay(v) })} />
              </td>
              <td>
                <input className="input sm" value={t.notes} onChange={(e) => upsertTrack({ ...t, notes: e.target.value })} />
              </td>
              <td className="right">
                <button className="btn xs ghost icon" title="Remove track" onClick={() => removeTrack(t.id)}>
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

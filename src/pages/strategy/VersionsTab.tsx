import { useMemo, useState } from 'react';
import { formatClock, formatDelta } from '../../engine/format';
import { calculateStrategy } from '../../engine/simulate';
import type { StrategyVersion } from '../../engine/types';
import { Badge, Panel } from '../../components/ui';
import { useUnits } from '../../lib/units';
import { useStore } from '../../store/store';
import type { TabProps } from './shared';

export function VersionsTab({ race, car, res }: TabProps) {
  const u = useUnits();
  const restoreVersion = useStore((s) => s.restoreVersion);
  const library = useStore((s) => s.library.strategies);
  const applyLibraryStrategy = useStore((s) => s.applyLibraryStrategy);
  const deleteLibraryStrategy = useStore((s) => s.deleteLibraryStrategy);
  const versions = [...car.versions].reverse();
  const [cmp, setCmp] = useState<string | null>(versions[0]?.id ?? null);
  const chosen = car.versions.find((v) => v.id === cmp);
  return (
    <div className="grid-side">
      <div className="col gap-8">
        <Panel title="Strategy versions" meta={<span className="sublabel">{car.versions.length} saved · restoring creates a new version</span>} bodyClass="flush">
          {versions.length === 0 ? (
            <div className="empty">No versions yet. Use “Save version” to snapshot the plan before the race or when it changes.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Label</th>
                  <th>Reason</th>
                  <th className="n">Race lap</th>
                  <th className="n">Saved</th>
                  <th className="n">Stops</th>
                  <th className="n">Laps</th>
                  <th className="n">Finish</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {versions.map((v, i) => (
                  <tr key={v.id} className={v.id === cmp ? 'sel' : ''} onClick={() => setCmp(v.id)} style={{ cursor: 'pointer' }}>
                    <td className="mono">
                      v{v.version} {i === 0 && <Badge size="sm" color="blue">Latest</Badge>}
                    </td>
                    <td>{v.label}</td>
                    <td className="ellipsis" style={{ maxWidth: 320 }} title={v.reason}>
                      {v.reason}
                    </td>
                    <td className="n">{v.lap != null && v.lap > 0 ? `L${v.lap}` : 'pre-race'}</td>
                    <td className="n">{new Date(v.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="n">{v.summary.stops}</td>
                    <td className="n">{v.summary.laps}</td>
                    <td className="n">{formatClock(v.summary.totalSec)}</td>
                    <td className="right">
                      <button
                        className="btn xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Restore v${v.version}? The current plan is replaced; a new version records the restore.`)) restoreVersion(race.id, car.id, v.id);
                        }}
                      >
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Strategy library" meta={<span className="sublabel">plans kept across races · stints map onto this car’s drivers by position</span>} bodyClass="flush">
          {library.length === 0 ? (
            <div className="empty">Library is empty. “Save to library” keeps a copy of the current plan.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Track</th>
                  <th>Car</th>
                  <th className="n">Stints</th>
                  <th className="n">Saved</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {library.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td>{l.track}</td>
                    <td>{l.car}</td>
                    <td className="n">{l.plan.stints.length}</td>
                    <td className="n">{new Date(l.createdAt).toLocaleDateString()}</td>
                    <td className="right">
                      <div className="row gap-4" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn xs" onClick={() => confirm(`Load “${l.name}” into #${car.number}? The plan and car setup are replaced.`) && applyLibraryStrategy(race.id, car.id, l.id)}>
                          Load
                        </button>
                        <button className="btn xs ghost" onClick={() => confirm(`Delete “${l.name}” from the library?`) && deleteLibraryStrategy(l.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
      <Panel title={chosen ? `v${chosen.version} vs current plan` : 'Compare'}>{chosen ? <VersionDiff v={chosen} tab={{ race, car, res }} u={u} /> : <div className="empty">Select a version to compare.</div>}</Panel>
    </div>
  );
}

function VersionDiff({ v, tab, u }: { v: StrategyVersion; tab: TabProps; u: ReturnType<typeof useUnits> }) {
  const { race, car, res } = tab;
  const old = useMemo(() => calculateStrategy(race.params, v.setup, v.plan, car.drivers), [race.params, v, car.drivers]);
  const setupDiffs: string[] = [];
  const keys: [keyof typeof v.setup, string, (x: number) => string][] = [
    ['fuelPerLapL', 'Fuel per lap', (x) => u.fpl(x)],
    ['energyPerLapPct', 'Energy per lap', (x) => `${u.n(x, 2)} %`],
    ['racePaceMs', 'Race pace', (x) => `${(x / 1000).toFixed(3)} s`],
    ['pitLaneLossSec', 'Pit-lane loss', (x) => `${u.n(x, 1)} s`],
    ['refuelRateLps', 'Refuel rate', (x) => `${u.n(u.fuelVal(x), 2)} ${u.fuelUnit}/s`],
    ['fuelCapacityL', 'Fuel capacity', (x) => u.fuelU(x)],
  ];
  for (const [k, label, f] of keys) {
    const a = v.setup[k] as number;
    const b = car.setup[k] as number;
    if (a !== b) setupDiffs.push(`${label}: ${f(a)} → ${f(b)}`);
  }
  const n = Math.max(old.stints.length, res.stints.length);
  return (
    <div className="col gap-8">
      <table className="table compact">
        <thead>
          <tr>
            <th />
            <th className="n">v{v.version}</th>
            <th className="n">Current</th>
            <th className="n">Δ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="label">Stops</td>
            <td className="n">{old.stops.length}</td>
            <td className="n">{res.stops.length}</td>
            <td className="n dim">{formatDelta(res.stops.length - old.stops.length, 0)}</td>
          </tr>
          <tr>
            <td className="label">Laps</td>
            <td className="n">{old.totalLaps}</td>
            <td className="n">{res.totalLaps}</td>
            <td className="n dim">{formatDelta(res.totalLaps - old.totalLaps, 0)}</td>
          </tr>
          <tr>
            <td className="label">Finish</td>
            <td className="n">{formatClock(old.finishSec)}</td>
            <td className="n">{formatClock(res.finishSec)}</td>
            <td className="n dim">{formatDelta(res.finishSec - old.finishSec, 0)} s</td>
          </tr>
          <tr>
            <td className="label">Min fuel margin</td>
            <td className="n">{u.n(old.minFuelMarginLaps, 2)}</td>
            <td className="n">{u.n(res.minFuelMarginLaps, 2)}</td>
            <td className="n dim">{formatDelta(res.minFuelMarginLaps - old.minFuelMarginLaps, 2)}</td>
          </tr>
        </tbody>
      </table>
      <div>
        <div className="label mb-8">Setup changes</div>
        {setupDiffs.length ? (
          <ul className="plain">
            {setupDiffs.map((d) => (
              <li key={d} className="mono">
                {d}
              </li>
            ))}
          </ul>
        ) : (
          <div className="sublabel">No changes to the key setup inputs.</div>
        )}
      </div>
      <div>
        <div className="label mb-8">Stints (laps)</div>
        <table className="table compact">
          <thead>
            <tr>
              <th>Stint</th>
              <th className="n">v{v.version}</th>
              <th className="n">Current</th>
              <th className="n">In-lap v{v.version}</th>
              <th className="n">In-lap now</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: n }, (_, i) => {
              const a = old.stints[i];
              const b = res.stints[i];
              const changed = a?.laps !== b?.laps || a?.endLap !== b?.endLap;
              return (
                <tr key={i} className={changed ? 'sel' : ''}>
                  <td className="mono">S{i + 1}</td>
                  <td className="n">{a?.laps ?? '—'}</td>
                  <td className="n">{b?.laps ?? '—'}</td>
                  <td className="n">{a ? (a.final ? 'FLAG' : a.endLap) : '—'}</td>
                  <td className="n">{b ? (b.final ? 'FLAG' : b.endLap) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

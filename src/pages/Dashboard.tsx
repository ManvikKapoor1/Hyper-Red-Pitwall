import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatClock, formatDurationShort } from '../engine/format';
import { raceNowSec } from '../engine/live';
import { calculateStrategy } from '../engine/simulate';
import type { Race } from '../engine/types';
import { RaceStatusBadge } from '../components/race/RaceStatusBadge';
import { IconCopy, IconLive, IconPlus, IconTrash } from '../components/icons';
import { Panel, SampleBadge, Stat } from '../components/ui';
import { useStore } from '../store/store';

const GROUPS: { key: string; title: string; match: (r: Race) => boolean; empty: string }[] = [
  { key: 'live', title: 'Live now', match: (r) => r.status === 'LIVE', empty: 'No race running.' },
  { key: 'next', title: 'Planning & upcoming', match: (r) => r.status === 'PLANNING' || r.status === 'READY', empty: 'Nothing planned — create a race to start.' },
  { key: 'done', title: 'Finished', match: (r) => r.status === 'FINISHED', empty: 'No finished races yet.' },
];

export function DashboardPage() {
  const races = useStore((s) => s.races);
  const library = useStore((s) => s.library);
  const createRace = useStore((s) => s.createRace);
  const loadDemo = useStore((s) => s.loadDemo);
  const nav = useNavigate();
  const sorted = useMemo(() => [...races].sort((a, b) => a.params.startTimeISO.localeCompare(b.params.startTimeISO)), [races]);
  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1 className="head" style={{ fontSize: 26 }}>
            Races
          </h1>
          <div className="sub">Plan stints, run the pitwall live and review afterwards. STINT suggests calls — you decide and relay them.</div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => nav(`/app/race/${loadDemo()}/live`)} title="Reload the 6H Fuji demo (SAMPLE DATA) in live mode">
            <IconLive size={14} /> Live demo
          </button>
          <button className="btn primary" onClick={() => nav(`/app/race/${createRace()}/setup`)}>
            <IconPlus size={14} /> New race
          </button>
        </div>
      </div>

      <div className="dash-cols">
        {GROUPS.map((g) => {
          const list = sorted.filter(g.match);
          if (g.key === 'done') list.reverse();
          return (
            <section key={g.key} className="dash-group">
              <div className="label mb-8">
                {g.title} <span className="dim">· {list.length}</span>
              </div>
              {list.length === 0 ? (
                <div className="notice">{g.empty}</div>
              ) : (
                <div className="col">
                  {list.map((r) => (
                    <RaceCard key={r.id} race={r} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="grid-3 mt-16">
        <Panel title="Getting started">
          <ol className="steps">
            <li>
              <b>Race setup</b> — race length, car, tires, pit and energy numbers. Every value is yours; STINT never assumes LMU physics.
            </li>
            <li>
              <b>Strategy</b> — build stints, check fuel / energy / tire margins, compare alternatives, save a version.
            </li>
            <li>
              <b>Live race</b> — type lap, fuel and energy as the race runs; STINT re-projects and suggests the next call.
            </li>
            <li>
              <b>Analysis</b> — planned vs actual once the flag falls.
            </li>
          </ol>
        </Panel>
        <Panel title="Library" meta={<span className="sublabel">shared across races</span>}>
          <div className="row gap-16">
            <Stat k="Saved strategies" v={library.strategies.length} />
            <Stat k="Tracks" v={library.tracks.length} />
            <Stat k="Teams" v={library.teams.length} />
          </div>
          <div className="sublabel mt-8">Manage tracks and export / import all data from a race’s Data page.</div>
        </Panel>
        <Panel title="Keyboard (live race)">
          <div className="kv">
            <span className="k">U</span>
            <span className="v l">Focus quick update</span>
            <span className="k">C</span>
            <span className="v l">Confirm the next call</span>
            <span className="k">O</span>
            <span className="v l">Override</span>
            <span className="k">P</span>
            <span className="v l">Record pit stop</span>
            <span className="k">F</span>
            <span className="v l">Focus mode</span>
            <span className="k">Space / L</span>
            <span className="v l">Demo clock / advance lap</span>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function RaceCard({ race }: { race: Race }) {
  const nav = useNavigate();
  const duplicateRace = useStore((s) => s.duplicateRace);
  const deleteRace = useStore((s) => s.deleteRace);
  const car = race.cars.find((c) => c.id === race.activeCarId) ?? race.cars[0];
  const res = useMemo(() => calculateStrategy(race.params, car.setup, car.plan, car.drivers), [race.params, car.setup, car.plan, car.drivers]);
  const start = new Date(race.params.startTimeISO);
  const live = race.status === 'LIVE';
  const now = live ? raceNowSec(race.clock) : 0;
  const open = live ? 'live' : race.status === 'FINISHED' ? 'analysis' : 'strategy';
  const length = race.params.lengthMode === 'time' ? formatDurationShort(race.params.durationSec) : `${race.params.laps} laps`;
  return (
    <article className={`race-card ${live ? 'is-live' : ''}`}>
      <header className="row between">
        <div className="row gap-4">
          <RaceStatusBadge status={race.status} size="sm" />
          {race.sample && <SampleBadge />}
        </div>
        <span className="sublabel">{isNaN(start.getTime()) ? '—' : start.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      </header>
      <Link to={`/app/race/${race.id}/${open}`} className="rc-title">
        {race.params.name}
      </Link>
      <div className="sublabel">
        {race.params.track} · {length} · {race.cars.map((c) => `#${c.number}`).join(' ')} · {car.setup.car}
      </div>
      <div className="rc-stats">
        {live ? (
          <>
            <Stat k="Lap" v={car.live.lapsCompleted} u={`/ ${res.totalLaps}`} />
            <Stat k="Race time" v={formatClock(now)} />
            <Stat k="Stint" v={car.live.stintIndex + 1} u={`/ ${car.plan.stints.length}`} />
          </>
        ) : race.status === 'FINISHED' ? (
          <>
            <Stat k="Laps" v={car.live.lapsCompleted} />
            <Stat k="Stops" v={car.live.stops.length} />
            <Stat k="Versions" v={car.versions.length} />
          </>
        ) : (
          <>
            <Stat k="Plan" v={res.stops.length} u="stops" />
            <Stat k="Laps" v={res.totalLaps} />
            <Stat k="Check" v={<span className={res.feasible ? '' : 'c-red'}>{res.feasible ? 'OK' : 'ISSUES'}</span>} />
          </>
        )}
      </div>
      <footer className="row gap-4">
        <Link className="btn sm" to={`/app/race/${race.id}/setup`}>
          Setup
        </Link>
        <Link className="btn sm" to={`/app/race/${race.id}/strategy`}>
          Strategy
        </Link>
        <Link className={`btn sm ${live ? 'go' : ''}`} to={`/app/race/${race.id}/live`}>
          Live
        </Link>
        {race.status === 'FINISHED' && (
          <Link className="btn sm" to={`/app/race/${race.id}/analysis`}>
            Analysis
          </Link>
        )}
        <span className="grow" />
        <button className="btn sm ghost icon" title="Duplicate as a new race" onClick={() => nav(`/app/race/${duplicateRace(race.id)}/setup`)}>
          <IconCopy size={13} />
        </button>
        <button className="btn sm ghost icon" title="Delete race" onClick={() => confirm(`Delete “${race.params.name}”? This cannot be undone.`) && deleteRace(race.id)}>
          <IconTrash size={13} />
        </button>
      </footer>
    </article>
  );
}

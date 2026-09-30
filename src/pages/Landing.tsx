import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { generateRaceCalls } from '../engine/calls';
import { projectLive } from '../engine/live';
import type { Race } from '../engine/types';
import { PriorityBadge } from '../components/race/RaceStatusBadge';
import { blocksFromLive, StrategyTimeline } from '../components/race/StrategyTimeline';
import { Logo, SampleBadge } from '../components/ui';
import { activeCar } from '../lib/hooks';
import { useUnits } from '../lib/units';
import { useStore } from '../store/store';

const FEATURES = [
  {
    k: 'Plan',
    t: 'Build the race stint by stint',
    d: 'Drivers, laps, drive modes, fuel and energy refills, tire changes and pit work. Lap-by-lap simulation shows margins, windows and every stop before the green flag.',
  },
  {
    k: 'Live',
    t: 'Adjust the strategy mid-race',
    d: 'Type lap, fuel, energy and tire age as the race runs. STINT re-projects the rest of the race and predicts where to gain — fewer stops, fresher tires, boxing under a safety car — with risk and confidence for each.',
  },
  {
    k: 'Calls',
    t: 'Suggested calls, your decision',
    d: 'BOX, FUEL SAVE, TAKE TIRES — each with reasons, confidence and an alternative. You confirm, override or ignore, then relay it over your own radio.',
  },
  {
    k: 'Review',
    t: 'Planned vs actual',
    d: 'Every version, override and pit stop is logged. After the flag, compare the plan with what happened stint by stint.',
  },
];

const PRINCIPLES = [
  ['Your numbers only', 'Every projection comes from values you entered, explicit assumptions or calculations. Demo values are labelled SAMPLE DATA.'],
  ['No “best” strategy', 'Alternatives get neutral tags — lower pit loss, higher fuel margin, higher risk. The strategist decides.'],
  ['Colour means state', 'Green OK, amber warning, red critical, blue info, violet energy. Nothing else is coloured.'],
  ['Stays on your machine', 'Runs in the browser and stores data locally. Export and import JSON whenever you like.'],
];

export function LandingPage() {
  const nav = useNavigate();
  const loadDemo = useStore((s) => s.loadDemo);
  const demo = useStore((s) => s.races.find((r) => r.isDemo));
  return (
    <div className="landing">
      <header className="ld-nav">
        <Logo size={20} />
        <nav className="row gap-8">
          <Link className="btn ghost sm" to="/app">
            Races
          </Link>
          <button className="btn sm" onClick={() => nav(`/app/race/${loadDemo()}/live`)}>
            Live demo
          </button>
          <Link className="btn primary sm" to="/app">
            Open pitwall
          </Link>
        </nav>
      </header>

      <section className="ld-hero">
        <div className="ld-copy">
          <div className="label">Le Mans Ultimate · endurance strategy</div>
          <h1>
            Strategy, stints
            <br />
            &amp; race calls
            <br />
            for the pitwall.
          </h1>
          <p>STINT turns the numbers your team enters during an endurance race into stint plans, fuel and energy projections, pit windows and suggested calls. The strategist decides; STINT never talks to the driver.</p>
          <div className="row gap-8 mt-16">
            <Link className="btn primary lg" to="/app">
              Open pitwall
            </Link>
            <button className="btn lg" onClick={() => nav(`/app/race/${loadDemo()}/live`)}>
              Try the 6H Fuji demo
            </button>
          </div>
        </div>
        {demo && <DemoPreview race={demo} />}
      </section>

      <section className="ld-features">
        {FEATURES.map((f) => (
          <article key={f.k}>
            <div className="label">{f.k}</div>
            <h3>{f.t}</h3>
            <p>{f.d}</p>
          </article>
        ))}
      </section>

      <section className="ld-principles">
        {PRINCIPLES.map(([t, d]) => (
          <div key={t}>
            <h4>{t}</h4>
            <p>{d}</p>
          </div>
        ))}
      </section>

      <footer className="ld-foot">
        <Logo size={14} />
        <span className="sublabel">Unofficial tool for sim-racing teams. Not affiliated with Le Mans Ultimate or its developers. Demo values are illustrative SAMPLE DATA, not LMU physics.</span>
      </footer>
    </div>
  );
}

/** Real engine output on the demo race — so the preview never shows invented numbers. */
function DemoPreview({ race }: { race: Race }) {
  const u = useUnits();
  const settings = useStore((s) => s.settings);
  const car = activeCar(race);
  const { p, top } = useMemo(() => {
    const p = projectLive(race, car, settings, race.clock.anchorRaceSec);
    return { p, top: generateRaceCalls(race, car, p, settings)[0] };
  }, [race, car, settings]);
  const tl = useMemo(() => blocksFromLive(car, p), [car, p]);
  return (
    <div className="ld-preview">
      <div className="row between">
        <span className="label">
          {race.params.name} · #{car.number} · lap {p.currentLap}
        </span>
        <SampleBadge />
      </div>
      {top && (
        <div className={`ld-call pr-${top.priority}`}>
          <PriorityBadge p={top.priority} size="sm" />
          <div className="ld-call-t">{top.text}</div>
          <div className="sublabel">{top.reasons[0]}</div>
        </div>
      )}
      <div className="ld-kpis">
        <div>
          <span className="label">Fuel</span>
          <b className="mono">{u.fuelU(car.live.fuelL)}</b>
        </div>
        <div>
          <span className="label">Per lap</span>
          <b className="mono">{u.fpl(p.fuelRate.value)}</b>
        </div>
        <div>
          <span className="label">Pit window</span>
          <b className="mono">{p.isFinalStint ? 'FLAG' : p.window.earliest === p.window.latest ? `L${p.window.latest}` : `L${p.window.earliest}–${p.window.latest}`}</b>
        </div>
        {car.setup.energyEnabled && (
          <div>
            <span className="label c-violet">Energy</span>
            <b className="mono">{u.pct(car.live.energyPct)} %</b>
          </div>
        )}
      </div>
      <StrategyTimeline car={car} blocks={tl.blocks} stops={tl.stops} totalLaps={Math.max(p.totalLaps, car.live.lapsCompleted)} totalSec={Math.max(p.finishSec, race.params.durationSec)} nowLap={p.currentLap} zoomable={false} compact />
    </div>
  );
}

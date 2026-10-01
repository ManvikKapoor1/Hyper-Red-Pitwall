import { Link } from 'react-router-dom';
import { Logo } from '../components/ui';

const FEATURES = [
  {
    k: 'Plan',
    t: 'Build the race stint by stint',
    d: 'Drivers, laps, drive modes, fuel and energy refills, tire changes and pit work. Lap-by-lap simulation shows margins, windows and every stop before the green flag.',
  },
  {
    k: 'Live',
    t: 'Adjust the strategy mid-race',
    d: 'Type lap, fuel, energy and tire age as the race runs. STINT re-projects the rest of the race and predicts where to gain — fewer stops, fresher tires, saving to the flag — with risk and confidence for each.',
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
  ['Your numbers only', 'Every projection comes from values you entered, explicit assumptions or calculations.'],
  ['No “best” strategy', 'Alternatives get neutral tags — lower pit loss, higher fuel margin, higher risk. The strategist decides.'],
  ['Colour means state', 'Green OK, amber warning, red critical, blue info and main actions, violet energy. Nothing else is coloured.'],
  ['Stays on your machine', 'Runs in the browser and stores data locally. Export and import JSON whenever you like.'],
];

export function LandingPage() {
  return (
    <div className="landing">
      <header className="ld-nav">
        <Logo size={20} />
        <nav className="row gap-8">
          <Link className="btn ghost sm" to="/app">
            Races
          </Link>
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
          </div>
        </div>
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
        <span className="sublabel">Unofficial tool for sim-racing teams. Not affiliated with Le Mans Ultimate or its developers.</span>
      </footer>
    </div>
  );
}

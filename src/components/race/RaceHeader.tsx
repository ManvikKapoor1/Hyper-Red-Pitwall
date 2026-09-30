import { useNavigate } from 'react-router-dom';
import type { RaceCall } from '../../engine/calls';
import { formatClock, wallClock } from '../../engine/format';
import type { LiveProjection } from '../../engine/live';
import type { CarEntry, Race } from '../../engine/types';
import { driverName } from '../../lib/hooks';
import { useStore } from '../../store/store';
import { IconFocus, IconPause, IconPlay, IconStep } from '../icons';
import { SampleBadge } from '../ui';
import { planStatus } from './RaceStatusBadge';

export function CarSelector({ race, compact }: { race: Race; compact?: boolean }) {
  const setActiveCar = useStore((s) => s.setActiveCar);
  if (race.cars.length <= 1 && compact) return null;
  return (
    <div className="car-sel" role="tablist" aria-label="Car">
      {race.cars.map((c) => (
        <button key={c.id} role="tab" className={c.id === race.activeCarId ? 'on' : ''} onClick={() => setActiveCar(race.id, c.id)} title={`#${c.number} ${c.setup.car}`}>
          #{c.number}
        </button>
      ))}
    </div>
  );
}

export function RaceClock({ race, nowSec }: { race: Race; nowSec: number }) {
  const remaining = race.params.lengthMode === 'time' ? Math.max(0, race.params.durationSec - nowSec) : null;
  const h24 = useStore((s) => s.settings.time.clock24h);
  return (
    <div className="race-clock">
      <div className="stat">
        <span className="k">Race time</span>
        <span className="v mono">{formatClock(nowSec)}</span>
      </div>
      {remaining != null && (
        <div className="stat">
          <span className="k">Remaining</span>
          <span className={`v mono ${remaining < 600 ? 'c-amber' : ''}`}>{formatClock(remaining)}</span>
        </div>
      )}
      <div className="stat sm">
        <span className="k">Local</span>
        <span className="v mono t2">{wallClock(race.params.startTimeISO, nowSec, h24)}</span>
      </div>
    </div>
  );
}

export function RaceHeader({ race, car, p, top, nowSec, focus, onFocus }: { race: Race; car: CarEntry; p: LiveProjection; top?: RaceCall; nowSec: number; focus: boolean; onFocus: () => void }) {
  const nav = useNavigate();
  const st = planStatus(car, p, top);
  const setClockRunning = useStore((s) => s.setClockRunning);
  const setClockSpeed = useStore((s) => s.setClockSpeed);
  const demoAdvance = useStore((s) => s.demoAdvance);
  const racing = car.live.phase === 'racing';
  return (
    <header className="race-header">
      <div className="rh-left">
        <div className="row gap-12">
          <CarSelector race={race} />
          <div className="col gap-4" style={{ minWidth: 0 }}>
            <div className="rh-title ellipsis">{race.params.name}</div>
            <div className="rh-sub ellipsis">
              <span className="mono">#{car.number}</span> {car.setup.car.toUpperCase()} · {car.setup.className} · {race.params.track}
            </div>
          </div>
        </div>
      </div>
      <div className="rh-lap">
        <span className="k label">Lap</span>
        <span className="mono big">{Math.max(0, p.currentLap)}</span>
        <span className="mono of">/ {p.totalLaps}</span>
        <span className="rh-proj label" title="Projected total laps from the current strategy and measured pace">PROJ</span>
      </div>
      <RaceClock race={race} nowSec={nowSec} />
      <div className="rh-stint">
        <div className="stat">
          <span className="k">Stint</span>
          <span className="v mono">
            {car.live.stintIndex + 1}
            <span className="u">/ {Math.max(p.totalStints, car.live.stintIndex + 1)}</span>
          </span>
        </div>
        <div className="stat">
          <span className="k">Driver</span>
          <span className="v" style={{ fontFamily: 'var(--font-head)', fontWeight: 700, letterSpacing: '.05em' }}>
            {driverName(car, car.live.driverId).toUpperCase()}
          </span>
        </div>
      </div>
      <div className="rh-state">
        <span className={`badge lg ${st.color ?? ''}`}>{st.text}</span>
        <span className="rh-racestate label">{p.state}</span>
      </div>
      <div className="rh-right">
        {race.sample && <SampleBadge />}
        {race.isDemo && racing && (
          <div className="demo-ctl" title="Demo mode — simulated feed stands in for manual data entry">
            <span className="label" style={{ color: 'var(--amber)' }}>
              DEMO
            </span>
            <button className="btn sm icon" onClick={() => setClockRunning(race.id, !race.clock.running)} title={race.clock.running ? 'Pause race clock (Space)' : 'Run race clock (Space)'}>
              {race.clock.running ? <IconPause size={13} /> : <IconPlay size={13} />}
            </button>
            <select className="select sm" style={{ width: 62 }} value={race.clock.speed} onChange={(e) => setClockSpeed(race.id, Number(e.target.value))} title="Clock speed">
              {[1, 5, 10, 30, 60].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
            <button className="btn sm" onClick={() => demoAdvance(race.id, 1)} title="Advance lap (L)">
              <IconStep size={12} /> Advance lap
            </button>
            <button className="btn sm ghost" onClick={() => demoAdvance(race.id, 5)} title="Advance 5 laps">
              +5
            </button>
          </div>
        )}
        {!race.isDemo && racing && (
          <div className="demo-ctl">
            <button className="btn sm icon" onClick={() => setClockRunning(race.id, !race.clock.running)} title={race.clock.running ? 'Pause race clock' : 'Run race clock'}>
              {race.clock.running ? <IconPause size={13} /> : <IconPlay size={13} />}
            </button>
          </div>
        )}
        <button className={`btn sm icon ghost ${focus ? 'on' : ''}`} onClick={onFocus} title="Focus mode — hide navigation (F)">
          <IconFocus size={14} />
        </button>
        <button className="btn sm ghost" onClick={() => nav(`/app/race/${race.id}/strategy`)} title="Open strategy builder">
          Strategy
        </button>
      </div>
    </header>
  );
}

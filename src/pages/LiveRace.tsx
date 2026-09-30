import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RaceNotFound } from '../components/race/RaceContextBar';
import { deriveAlerts } from '../engine/calls';
import { formatClock } from '../engine/format';
import { TEMPLATE_LABEL } from '../engine/model';
import { AlertPanel, CurrentStintCard, EnergyCard, FuelCard, PaceCard, PitWindowCard, RaceCallHistory, RaceStatePanel, StrategyVersionsCard, TireCard, UpcomingCalls } from '../components/race/LiveCards';
import { PitStopRecorder } from '../components/race/PitStopRecorder';
import { QuickUpdatePanel } from '../components/race/QuickUpdatePanel';
import { OverrideModal, RaceCallCard, useApplyCall } from '../components/race/RaceCallCard';
import { RaceHeader } from '../components/race/RaceHeader';
import { ScenarioPanel } from '../components/race/ScenarioPanel';
import { WhereToGain } from '../components/race/WhereToGain';
import { blocksFromLive, StrategyTimeline } from '../components/race/StrategyTimeline';
import { Panel } from '../components/ui';
import { activeCar, driverName, useHotkeys, useLive, useRaceFromRoute, useRaceNow } from '../lib/hooks';
import { marginClass } from '../lib/margins';
import { useUnits } from '../lib/units';
import { useStore } from '../store/store';
import type { CarEntry, Race } from '../engine/types';

export function LiveRacePage() {
  const race = useRaceFromRoute();
  if (!race) return <RaceNotFound />;
  return <LiveRace race={race} car={activeCar(race)} />;
}

function LiveRace({ race, car }: { race: Race; car: CarEntry }) {
  const u = useUnits();
  const nowSec = useRaceNow(race);
  const { p, calls } = useLive(race, car, nowSec);
  const settings = useStore((s) => s.settings);
  const demoSync = useStore((s) => s.demoSync);
  const demoAdvance = useStore((s) => s.demoAdvance);
  const setClockRunning = useStore((s) => s.setClockRunning);
  const logCall = useStore((s) => s.logCall);
  const [override, setOverride] = useState(false);
  const [stop, setStop] = useState<{ fuelAfterL?: number } | null>(null);
  const [focus, setFocus] = useState(false);
  const top = calls[0];
  const rest = calls.slice(1);
  const apply = useApplyCall(race, car, p);
  const alerts = useMemo(() => deriveAlerts(car, p, settings, 0), [car, p, settings]);
  const tl = useMemo(() => blocksFromLive(car, p), [car, p]);

  // demo: laps complete automatically while the clock runs
  useEffect(() => {
    if (race.isDemo && race.clock.running) demoSync(race.id, nowSec);
  }, [Math.floor(nowSec)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.body.classList.toggle('focus-mode', focus);
    return () => document.body.classList.remove('focus-mode');
  }, [focus]);

  useHotkeys(
    {
      l: () => race.isDemo && demoAdvance(race.id, 1),
      ' ': () => car.live.phase === 'racing' && setClockRunning(race.id, !race.clock.running),
      c: () => {
        if (!top) return;
        logCall(race.id, car.id, top.text, top.priority, top.reasons.join(' · '), 'ISSUED', 'system');
        apply(top.action, `Call accepted: ${top.text}`);
      },
      o: () => setOverride(true),
      p: () => car.live.phase === 'racing' && setStop({}),
      f: () => setFocus((f) => !f),
    },
    [race, car, top],
  );

  const nextStints = p.sim.stints.slice(1, 4);
  const crit = settings.alerts.fuelMarginCritLaps;

  return (
    <div className="live">
      <RaceHeader race={race} car={car} p={p} top={top} nowSec={nowSec} focus={focus} onFocus={() => setFocus((f) => !f)} />
      <div className="live-left">
        <CurrentStintCard race={race} car={car} p={p} />
        <RaceStatePanel race={race} car={car} p={p} onRecordStop={() => setStop({})} />
        <QuickUpdatePanel race={race} car={car} nowSec={nowSec} onRecordStop={(pre) => setStop(pre ?? {})} />
        <StrategyVersionsCard race={race} car={car} />
      </div>
      <div className="live-center">
        <Panel
          title="Strategy timeline"
          className="live-tl"
          meta={
            <>
              <span className="sublabel">
                {p.sim.stops.length} stops left · proj. {p.totalLaps} laps · finish {formatClock(p.finishSec)}
              </span>
              <Link className="btn xs ghost" to={`/app/race/${race.id}/strategy/timeline`}>
                Expand
              </Link>
            </>
          }
          bodyClass="tight"
        >
          <StrategyTimeline car={car} blocks={tl.blocks} stops={tl.stops} totalLaps={Math.max(p.totalLaps, car.live.lapsCompleted)} totalSec={Math.max(p.finishSec, race.params.durationSec)} nowLap={car.live.phase === 'racing' ? p.currentLap : undefined} events={race.events} calls={car.live.calls} versions={car.versions} compact={false} zoomable />
        </Panel>
        <Panel title="Upcoming stints" className="live-next" bodyClass="flush" meta={<Link className="btn xs ghost" to={`/app/race/${race.id}/strategy/stints`}>Stint planner</Link>}>
          <table className="table compact">
            <thead>
              <tr>
                <th>Stint</th>
                <th>Driver</th>
                <th className="n">Laps</th>
                <th className="n">In-lap</th>
                <th>Stop before</th>
                <th>Tires</th>
                <th className="n">Fuel +</th>
                <th className="n">Fuel margin</th>
                {car.setup.energyEnabled && <th className="n">Energy margin</th>}
                <th>Pit flag</th>
              </tr>
            </thead>
            <tbody>
              {p.current && (
                <tr className="cur">
                  <td className="mono">S{p.current.index + 1}</td>
                  <td className="ellipsis" style={{ maxWidth: 140 }}>{driverName(car, p.current.driverId)}</td>
                  <td className="n">{p.current.laps}</td>
                  <td className="n">{p.current.final ? 'FLAG' : p.current.endLap}</td>
                  <td className="dim">NOW</td>
                  <td>{p.current.compound}</td>
                  <td className="n dim">—</td>
                  <td className={`n ${marginClass(p.current.fuelMarginLaps, crit)}`}>{u.n(p.current.fuelMarginLaps, 1)}</td>
                  {car.setup.energyEnabled && <td className={`n ${marginClass(p.current.energyMarginLaps)}`}>{u.n(p.current.energyMarginLaps, 1)}</td>}
                  <td className="dim">{p.current.final ? 'FINAL' : p.current.flag}</td>
                </tr>
              )}
              {nextStints.map((s, i) => {
                const stp = p.sim.stops[i];
                return (
                  <tr key={s.index}>
                    <td className="mono">S{s.index + 1}</td>
                    <td className="ellipsis" style={{ maxWidth: 140 }}>{driverName(car, s.driverId)}</td>
                    <td className="n">{s.laps}</td>
                    <td className="n">{s.final ? 'FLAG' : s.endLap}</td>
                    <td className="ellipsis" style={{ maxWidth: 170 }}>{stp ? TEMPLATE_LABEL[stp.template] : ''}</td>
                    <td className={s.newTires ? '' : 'dim'}>{s.newTires ? `NEW ${s.compound}` : `${s.compound} +${s.tireAgeStart}`}</td>
                    <td className="n">{stp ? u.fuel(stp.fuelAddedL) : '—'}</td>
                    <td className={`n ${marginClass(s.fuelMarginLaps, crit)}`}>{u.n(s.fuelMarginLaps, 1)}</td>
                    {car.setup.energyEnabled && <td className={`n ${marginClass(s.energyMarginLaps)}`}>{u.n(s.energyMarginLaps, 1)}</td>}
                    <td className="dim">{s.final ? 'FINAL' : s.flag}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
        <WhereToGain race={race} car={car} />
        <Panel className="live-scen" bodyClass="tight">
          <ScenarioPanel race={race} car={car} p={p} nowSec={nowSec} />
          <AlertPanel alerts={alerts} />
        </Panel>
      </div>
      <div className="live-right">
        <RaceCallCard race={race} car={car} p={p} call={top} onOverride={() => setOverride(true)} />
        <PitWindowCard race={race} car={car} p={p} nowSec={nowSec} onOverride={() => setOverride(true)} />
        <Panel title="Call queue" className="live-queue" meta={<span className="sublabel">{rest.length}</span>} scroll>
          <UpcomingCalls calls={rest} />
        </Panel>
      </div>
      <div className="live-bottom">
        <FuelCard race={race} car={car} p={p} />
        <TireCard car={car} p={p} />
        <EnergyCard car={car} p={p} />
        <PaceCard car={car} p={p} />
        <Panel title="Call history" scroll className="kpi hist" meta={<Link className="btn xs ghost" to={`/app/race/${race.id}/calls`}>All</Link>} bodyClass="flush">
          <RaceCallHistory race={race} car={car} limit={30} compact />
        </Panel>
      </div>
      {override && <OverrideModal race={race} car={car} p={p} call={top} onClose={() => setOverride(false)} />}
      {stop && <PitStopRecorder race={race} car={car} p={p} nowSec={nowSec} prefill={stop} onClose={() => setStop(null)} />}
    </div>
  );
}

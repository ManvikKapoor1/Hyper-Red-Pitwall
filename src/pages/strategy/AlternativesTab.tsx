import { useMemo, useState } from 'react';
import { compareStrategies, generateAlternatives, type StrategyTag } from '../../engine/alternatives';
import { formatClock, formatDelta, formatLapMs } from '../../engine/format';
import { blocksFromResult, StrategyTimeline } from '../../components/race/StrategyTimeline';
import { Badge, Panel } from '../../components/ui';
import { useUnits } from '../../lib/units';
import { useStore } from '../../store/store';
import { IssueList, marginClass, type TabProps } from './shared';

const TAG_COLOR: Partial<Record<StrategyTag, 'blue' | 'amber'>> = {
  CURRENT: 'blue',
  'HIGHER STRATEGY RISK': 'amber',
};

export function AlternativesTab({ race, car }: TabProps) {
  const u = useUnits();
  const setPlan = useStore((s) => s.setPlan);
  const metrics = useMemo(() => compareStrategies(race.params, car, generateAlternatives({ race: race.params, car })), [race.params, car]);
  const [sel, setSel] = useState('current');
  const chosen = metrics.find((m) => m.option.id === sel) ?? metrics[0];
  const tl = blocksFromResult(chosen.result);
  return (
    <div className="col gap-8">
      <div className="notice">
        Alternatives are generated from your plan and entered assumptions. STINT describes the consequences with neutral tags — it does not rank or pick a strategy. Δ time is measured over the current plan’s distance.
      </div>
      <Panel title="Compare" bodyClass="flush" className="scroll-x">
        <table className="table">
          <thead>
            <tr>
              <th>Strategy</th>
              <th className="n">Stops</th>
              <th className="n">Laps</th>
              <th className="n">Finish</th>
              <th className="n">Δ same distance</th>
              <th className="n">Pit loss</th>
              <th className="n">Min fuel margin</th>
              <th className="n">Max tire age</th>
              <th className="n">Sets</th>
              <th className="n">Avg green lap</th>
              <th>Tags</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.option.id} className={m.option.id === chosen.option.id ? 'sel' : ''} onClick={() => setSel(m.option.id)} style={{ cursor: 'pointer' }}>
                <td>
                  <div style={{ fontWeight: 600 }}>{m.option.name}</div>
                  <div className="sublabel">{m.option.description}</div>
                </td>
                <td className="n">{m.stops}</td>
                <td className="n">{m.totalLaps}</td>
                <td className="n">{formatClock(m.finishSec)}</td>
                <td className="n">{m.option.current ? '—' : `${formatDelta(m.deltaSameDistanceSec, 1)} s`}</td>
                <td className="n">{u.n(m.pitLossSec, 0)} s</td>
                <td className={`n ${marginClass(m.minFuelMarginLaps)}`}>{u.n(m.minFuelMarginLaps, 2)}</td>
                <td className="n">{m.maxTireAge}</td>
                <td className="n">{m.tireSets}</td>
                <td className="n">{formatLapMs(m.avgPaceMs)}</td>
                <td>
                  <div className="row wrap gap-4">
                    {m.tags.map((t) => (
                      <Badge key={t} size="sm" color={TAG_COLOR[t]}>
                        {t}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="right">
                  {!m.option.current && (
                    <button
                      className="btn xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Replace the current plan with “${m.option.name}”? Save a version first if you want to keep it.`)) setPlan(race.id, car.id, { ...m.option.plan, name: m.option.name });
                      }}
                    >
                      Apply
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="grid-side">
        <Panel title={`Preview — ${chosen.option.name}`} bodyClass="tight">
          <StrategyTimeline car={car} blocks={tl.blocks} stops={tl.stops} totalLaps={chosen.totalLaps} totalSec={chosen.finishSec} zoomable={false} compact />
        </Panel>
        <Panel title="Assumptions & risks">
          <ul className="plain">
            {chosen.option.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
          <div className="mt-8">
            <IssueList issues={chosen.result.issues} empty="No issues flagged for this option." />
          </div>
        </Panel>
      </div>
    </div>
  );
}

import { memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatDelta } from '../../engine/format';
import { findOpportunities, type Opportunity, type Risk } from '../../engine/opportunities';
import { clonePlan } from '../../engine/planner';
import type { CarEntry, Race } from '../../engine/types';
import { useStore } from '../../store/store';
import { Badge, ConfidenceBadge, Panel } from '../ui';

const RISK_COLOR: Record<Risk, 'green' | 'amber' | 'red'> = { LOW: 'green', MEDIUM: 'amber', HIGH: 'red' };

export function gainText(o: Pick<Opportunity, 'gainLaps' | 'gainSec'>): string {
  if (o.gainLaps !== 0) return `${o.gainLaps > 0 ? '+' : '−'}${Math.abs(o.gainLaps)} LAP${Math.abs(o.gainLaps) === 1 ? '' : 'S'}`;
  return `${formatDelta(o.gainSec, 1)} s`;
}

/**
 * Predictions of where the rest of the race could go better — every option is
 * re-simulated from the current lap with measured rates. The pitwall decides.
 */
export const WhereToGain = memo(function WhereToGain({ race, car }: { race: Race; car: CarEntry }) {
  const settings = useStore((s) => s.settings);
  const setPlan = useStore((s) => s.setPlan);
  const saveVersion = useStore((s) => s.saveVersion);
  const setPitOverride = useStore((s) => s.setPitOverride);
  const scan = useMemo(() => findOpportunities(race, car, settings), [race, car, settings]);
  if (!scan) return null;
  const better = scan.list.filter((o) => o.better);
  const racing = car.live.phase === 'racing';

  const apply = (o: Opportunity) => {
    if (!confirm(`Apply “${o.title}”? The remaining stints are replaced and a new strategy version is saved.`)) return;
    const reason = `Predicted ${gainText(o)} · ${o.changes.join(' · ') || o.detail}`;
    setPlan(race.id, car.id, clonePlan(o.option.plan));
    const boxLap = racing ? o.option.simOverrides?.[car.live.stintIndex] : undefined;
    if (boxLap != null) setPitOverride(race.id, car.id, car.live.stintIndex, boxLap, reason);
    else saveVersion(race.id, car.id, `Applied: ${o.title}`, reason);
  };

  return (
    <Panel
      title="Where to gain"
      className="w2g"
      bodyClass="flush"
      meta={
        <>
          <span className="sublabel ellipsis" title={scan.basis}>
            predicted · {scan.checked} options from {racing ? `lap ${car.live.lapsCompleted + 1}` : 'the grid'}
          </span>
          <Link className="btn xs ghost" to={`/app/race/${race.id}/strategy/alternatives`}>
            Compare
          </Link>
        </>
      }
    >
      {better.length === 0 && (
        <div className="w2g-none">
          <b>Current plan is the quickest safe option</b> of {scan.checked} checked. <span className="sublabel">{scan.basis}</span>
        </div>
      )}
      <table className="table compact w2g-t">
        <thead>
          <tr>
            <th>Option</th>
            <th className="n">Predicted</th>
            <th>What changes</th>
            <th>Risk</th>
            <th>Confidence</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {scan.list.map((o) => (
            <tr key={o.id} className={o.better ? 'better' : 'done'}>
              <td>
                <div className="w2g-name">{o.title}</div>
                <div className="sublabel ellipsis">{o.detail}</div>
              </td>
              <td className="n">
                <b className="w2g-gain">{gainText(o)}</b>
              </td>
              <td className="ellipsis w2g-ch" title={o.changes.join('\n')}>
                {o.changes.join(' · ') || '—'}
              </td>
              <td title={o.riskReasons.join('\n') || 'No new problems vs the current plan'}>
                <Badge size="sm" color={RISK_COLOR[o.risk]}>
                  {o.risk}
                </Badge>
                {o.riskReasons[0] && <div className="sublabel ellipsis w2g-why">{o.riskReasons[0]}</div>}
              </td>
              <td>
                <ConfidenceBadge c={o.confidence} basis={scan.basis} />
              </td>
              <td className="right">
                <button className={`btn xs ${o.better ? 'info' : 'ghost'}`} disabled={o.risk === 'HIGH'} onClick={() => apply(o)} title={o.risk === 'HIGH' ? 'Runs out of fuel / energy or breaks a limit — not applicable' : 'Replace the remaining stints and save a strategy version'}>
                  Apply
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
});

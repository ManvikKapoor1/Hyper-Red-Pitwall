import type { ReactNode } from 'react';
import type { SimIssue, SimStint, StrategyResult } from '../../engine/simulate';
import type { CarEntry, Race, RefillAmount } from '../../engine/types';
import { NumInput } from '../../components/ui';

export interface TabProps {
  race: Race;
  car: CarEntry;
  res: StrategyResult;
}


export function flagClass(flag?: string): string {
  return flag === 'LATE' ? 'c-red' : flag === 'EARLY' ? 'c-amber' : '';
}

export function IssueList({ issues, empty = 'No issues — plan covers the race within entered limits.' }: { issues: SimIssue[]; empty?: ReactNode }) {
  if (!issues.length) return <div className="notice green">{empty}</div>;
  return (
    <div className="issues">
      {issues.map((i, k) => (
        <div key={k} className={`notice ${i.severity === 'critical' ? 'red' : i.severity === 'warning' ? 'amber' : ''}`}>
          <b className="upper" style={{ fontSize: 11, letterSpacing: '0.08em', marginRight: 6 }}>
            {i.severity}
          </b>
          {i.stint != null && <span className="mono dim">S{i.stint + 1} </span>}
          {i.message}
        </div>
      ))}
    </div>
  );
}

/** auto / full / fixed amount editor for fuel & energy refills. */
export function RefillInput({ value, onChange, unit, decimals = 1, toDisplay = (v) => v, fromDisplay = (v) => v }: { value: RefillAmount; onChange: (v: RefillAmount) => void; unit: string; decimals?: number; toDisplay?: (v: number) => number; fromDisplay?: (v: number) => number }) {
  const mode = typeof value === 'number' ? 'fixed' : value;
  return (
    <div className="row gap-4">
      <select className="select" style={{ width: 96 }} value={mode} onChange={(e) => onChange(e.target.value === 'fixed' ? 0 : (e.target.value as 'auto' | 'full'))}>
        <option value="auto">Auto</option>
        <option value="full">Full</option>
        <option value="fixed">Fixed</option>
      </select>
      {typeof value === 'number' ? (
        <NumInput value={toDisplay(value)} decimals={decimals} min={0} unit={unit} onChange={(v) => onChange(fromDisplay(v))} />
      ) : (
        <span className="sublabel">{value === 'auto' ? 'Enough for next stint + reserve' : 'Fill to capacity'}</span>
      )}
    </div>
  );
}

export function limiterText(s: SimStint): string {
  return s.final ? 'FLAG' : s.limiter;
}

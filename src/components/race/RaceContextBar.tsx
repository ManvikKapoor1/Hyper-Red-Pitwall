import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Race } from '../../engine/types';
import { SampleBadge } from '../ui';
import { CarSelector } from './RaceHeader';
import { RaceStatusBadge } from './RaceStatusBadge';

/** Sticky page header shared by the race pages: name, car, status, sample tag, page info, actions. */
export function RaceContextBar({ race, cars = true, children, actions }: { race: Race; cars?: boolean; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ctx-bar">
      <span className="title ellipsis">{race.params.name}</span>
      {cars && <CarSelector race={race} />}
      <RaceStatusBadge status={race.status} size="sm" />
      {race.sample && <SampleBadge />}
      {children}
      {actions && (
        <div className="row gap-4" style={{ marginLeft: 'auto' }}>
          {actions}
        </div>
      )}
    </div>
  );
}

export function RaceNotFound() {
  return (
    <div className="empty">
      Race not found. <Link to="/app">Back to dashboard</Link>
    </div>
  );
}

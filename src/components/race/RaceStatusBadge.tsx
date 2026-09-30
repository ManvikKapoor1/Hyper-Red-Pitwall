import type { RaceCall } from '../../engine/calls';
import type { LiveProjection } from '../../engine/live';
import type { CallPriority, CarEntry, RaceStatus } from '../../engine/types';
import { Badge } from '../ui';

export function RaceStatusBadge({ status, size }: { status: RaceStatus; size?: 'sm' | 'lg' }) {
  const color = status === 'LIVE' ? 'red' : status === 'READY' ? 'blue' : status === 'FINISHED' ? undefined : 'amber';
  return (
    <Badge color={color} size={size} dot={status === 'LIVE'}>
      {status}
    </Badge>
  );
}

export type PlanStatus = { text: string; color: 'green' | 'amber' | 'red' | 'blue' | undefined };

/** "ON PLAN" style summary of the current strategy state. */
export function planStatus(car: CarEntry, p: LiveProjection, top?: RaceCall): PlanStatus {
  if (car.live.phase === 'pre') return { text: 'PRE-RACE', color: undefined };
  if (car.live.phase === 'grid') return { text: 'ON GRID', color: 'blue' };
  if (car.live.phase === 'finished') return { text: 'FINISHED', color: undefined };
  if (p.sim.issues.some((i) => i.severity === 'critical')) return { text: 'PLAN INVALID', color: 'red' };
  if (top?.priority === 'CRITICAL') return { text: 'ACTION NOW', color: 'red' };
  if (p.window.state === 'MISSED') return { text: 'OFF PLAN', color: 'red' };
  if (car.live.pitLapOverrides[car.live.stintIndex] != null) return { text: 'OVERRIDE ACTIVE', color: 'blue' };
  if (p.fuelSavePct > 0.3 || p.energySavePct > 0.3 || top?.key === 'BOX_EARLY') return { text: 'AT RISK', color: 'amber' };
  return { text: 'ON PLAN', color: 'green' };
}

export const PRIORITY_LABEL: Record<CallPriority, string> = {
  CRITICAL: 'CRITICAL',
  ACTION: 'ACTION REQUIRED',
  UPCOMING: 'UPCOMING',
  INFO: 'INFORMATION',
};

export function priorityColor(p: CallPriority): 'red' | 'amber' | 'blue' | undefined {
  return p === 'CRITICAL' ? 'red' : p === 'ACTION' ? 'amber' : p === 'UPCOMING' ? 'blue' : undefined;
}

export function PriorityBadge({ p, size }: { p: CallPriority; size?: 'sm' | 'lg' }) {
  return (
    <Badge color={priorityColor(p)} size={size} solid={p === 'CRITICAL'}>
      {PRIORITY_LABEL[p]}
    </Badge>
  );
}

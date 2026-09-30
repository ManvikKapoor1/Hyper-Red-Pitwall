import type { CarEntry } from '../../engine/types';

/** Driver colour bar + code (and optionally name) — the code keeps identity readable without colour. */
export function DriverChip({ car, id, name = false }: { car: CarEntry; id: string; name?: boolean }) {
  const d = car.drivers.find((x) => x.id === id);
  return (
    <span className="drv-chip" title={d?.name}>
      <i style={{ background: d?.color ?? 'var(--line-3)' }} />
      <b>{d?.code ?? '—'}</b>
      {name && <span className="ellipsis">{d?.name ?? 'Unassigned'}</span>}
    </span>
  );
}

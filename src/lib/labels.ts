/** Display labels shared by pages (engine values stay the source of truth). */
import type { DriveMode, ServiceConcurrency } from '../engine/types';

export const DRIVE_MODES: { value: DriveMode; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'fuelSave', label: 'Fuel save' },
  { value: 'energySave', label: 'Energy save' },
  { value: 'push', label: 'Push' },
];

export const MODE_LABEL = Object.fromEntries(DRIVE_MODES.map((m) => [m.value, m.label])) as Record<DriveMode, string>;

export const CONCURRENCY: { value: ServiceConcurrency; label: string; title: string }[] = [
  { value: 'sequential', label: 'Sequential', title: 'Fuel, then tires, then driver' },
  { value: 'fuelDriverThenTires', label: 'Fuel ∥ driver', title: 'Fuel and driver change together, then tires' },
  { value: 'parallel', label: 'Parallel', title: 'All service at once — the longest counts' },
];

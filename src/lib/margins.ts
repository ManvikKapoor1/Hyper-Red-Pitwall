/**
 * Colour class for a margin in laps. Colour only when the margin is race-critical:
 * below zero is red, below the warning threshold amber. A margin of exactly the
 * threshold (e.g. the 1-lap planning reserve) is fine, so floats get an epsilon.
 */
export function marginClass(laps: number, warn = 1): string {
  const eps = 1e-6;
  return laps < -eps ? 'c-red' : laps < warn - eps ? 'c-amber' : '';
}

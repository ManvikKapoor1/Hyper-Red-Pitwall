/**
 * Where to gain — predictions of how the rest of the race could go better.
 *
 * Every option is re-simulated from the current lap with the measured fuel,
 * energy and pace rates (liveSimOptions), then compared with the current plan
 * over the same distance. Gains, risks and confidence all come from that
 * calculation and the entered assumptions; nothing is guessed. The pitwall
 * still decides.
 */
import { minConfidence } from './calls';
import { compareStrategies, generateAlternatives, type StrategyMetrics, type StrategyOption } from './alternatives';
import { liveSimOptions, measureEnergyPerLap, measureFuelPerLap } from './live';
import { fuelRateText } from './format';
import { getCompound } from './model';
import type { SimOptions, StrategyResult } from './simulate';
import type { CarEntry, Confidence, Race, Settings } from './types';

export type Risk = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Opportunity {
  id: string;
  title: string;
  detail: string;
  option: StrategyOption;
  metrics: StrategyMetrics;
  /** Seconds faster than the current plan over the current plan's distance (negative = slower). */
  gainSec: number;
  /** Extra laps completed by the flag (timed races). */
  gainLaps: number;
  changes: string[];
  risk: Risk;
  riskReasons: string[];
  confidence: Confidence;
  better: boolean;
}

export interface OpportunityScan {
  base: StrategyMetrics;
  list: Opportunity[];
  checked: number;
  basis: string;
}

const lower = (c: Confidence): Confidence => (c === 'HIGH' ? 'MEDIUM' : 'LOW');

/** Human-readable differences between the current projection and an option. */
function describeChanges(base: StrategyResult, opt: StrategyResult, option: StrategyOption, fromStint: number): string[] {
  const out: string[] = [];
  if (opt.stops.length !== base.stops.length) out.push(`Stops left ${base.stops.length} → ${opt.stops.length}`);
  const b0 = base.stops[0];
  const o0 = opt.stops[0];
  if (o0 && b0 && o0.lap !== b0.lap) out.push(`Box L${o0.lap} (plan L${b0.lap})`);
  else if (o0 && !b0) out.push(`Box L${o0.lap}`);
  if (o0 && b0 && o0.changeTires !== b0.changeTires) out.push(o0.changeTires ? `Tires at next stop (${o0.compound})` : 'No tires at next stop');
  if (opt.tireSets !== base.tireSets) out.push(`Tire sets ${base.tireSets} → ${opt.tireSets}`);
  const save = option.plan.stints.findIndex((s, i) => i >= fromStint && s.mode === 'fuelSave');
  if (save >= 0) out.push(`Fuel-save mode from S${save + 1}`);
  return out;
}

/**
 * Risk of an option relative to the current plan: only problems the option
 * adds count (a warning the current plan already carries is not new risk).
 */
function assessRisk(m: StrategyMetrics, base: StrategyMetrics, car: CarEntry, option: StrategyOption, warnLaps: number): { risk: Risk; reasons: string[] } {
  const r = m.result;
  const known = new Set(base.result.issues.map((i) => i.message));
  const fresh = r.issues.filter((i) => !known.has(i.message));
  const critical = fresh.filter((i) => i.severity === 'critical');
  const reasons: string[] = [];
  const energy = car.setup.energyEnabled;
  if (r.minFuelMarginLaps < 0) reasons.push(`Fuel runs short (${r.minFuelMarginLaps.toFixed(1)} laps)`);
  if (energy && r.minEnergyMarginLaps < 0) reasons.push(`Energy runs short (${r.minEnergyMarginLaps.toFixed(1)} laps)`);
  critical.forEach((i) => reasons.push(i.message));
  if (reasons.length || !r.feasible) return { risk: 'HIGH', reasons };
  fresh.filter((i) => i.severity === 'warning').forEach((i) => reasons.push(i.message));
  if (r.minFuelMarginLaps < warnLaps - 1e-6 && r.minFuelMarginLaps < base.result.minFuelMarginLaps - 0.05) reasons.push(`Fuel margin ${r.minFuelMarginLaps.toFixed(1)} laps`);
  if (option.plan.stints.some((s) => s.mode === 'fuelSave')) reasons.push('Relies on the entered fuel-save effect');
  const overTarget = (res: StrategyResult) => res.stints.filter((s) => s.tireAgeEnd > getCompound(car.setup, s.compound).targetLife).length;
  if (overTarget(r) > overTarget(base.result)) reasons.push('More stints beyond tire target life');
  return { risk: reasons.length ? 'MEDIUM' : 'LOW', reasons };
}

/**
 * Scan the options open to the car from where it is now. `better` marks
 * options that finish ahead of the current plan (more laps, or ≥ 1 s quicker
 * over the same distance) without running out of fuel / energy; those come
 * first, each group ordered by predicted gain.
 */
export function findOpportunities(race: Race, car: CarEntry, settings: Settings): OpportunityScan | null {
  const { live } = car;
  if (live.phase === 'finished') return null;
  const racing = live.phase === 'racing';
  const sim: SimOptions | undefined = racing ? liveSimOptions(race, car, settings) : { events: race.plannedEvents, earlyThresholdLaps: settings.defaults.earlyPitThresholdLaps };
  const keepFirst = racing ? Math.min(live.stintIndex + 1, car.plan.stints.length) : 0;
  const options = generateAlternatives({ race: race.params, car, sim, keepFirst });
  const metrics = compareStrategies(race.params, car, options, sim);
  const base = metrics.find((m) => m.option.current) ?? metrics[0];

  const fuelRate = measureFuelPerLap(car, settings);
  const energyRate = measureEnergyPerLap(car, settings);
  const dataConf = racing ? minConfidence(fuelRate.confidence, car.setup.energyEnabled ? energyRate.confidence : 'HIGH') : 'MEDIUM';
  const warnLaps = settings.alerts.fuelMarginCritLaps;

  const list: Opportunity[] = metrics
    .filter((m) => !m.option.current)
    .map((m) => {
      const gainSec = -m.deltaSameDistanceSec;
      const gainLaps = m.totalLaps - base.totalLaps;
      const { risk, reasons } = assessRisk(m, base, car, m.option, warnLaps);
      const usesSave = m.option.plan.stints.some((s, i) => i >= keepFirst && s.mode === 'fuelSave');
      return {
        id: m.option.id,
        title: m.option.name,
        detail: m.option.description,
        option: m.option,
        metrics: m,
        gainSec,
        gainLaps,
        changes: describeChanges(base.result, m.result, m.option, keepFirst),
        risk,
        riskReasons: reasons,
        confidence: usesSave ? lower(dataConf) : dataConf,
        better: risk !== 'HIGH' && (gainLaps > 0 || (gainLaps === 0 && gainSec >= 1)),
      };
    })
    .sort((a, b) => Number(b.better) - Number(a.better) || b.gainLaps - a.gainLaps || b.gainSec - a.gainSec);

  const basis = racing
    ? `From lap ${live.lapsCompleted + 1} · fuel ${fuelRateText(fuelRate.value, settings.units.fuel)} (${fuelRate.source})${car.setup.energyEnabled ? ` · energy ${energyRate.value.toFixed(2)} %/lap` : ''}`
    : 'Pre-race · entered assumptions and planned scenarios';
  return { base, list, checked: options.length - 1, basis };
}

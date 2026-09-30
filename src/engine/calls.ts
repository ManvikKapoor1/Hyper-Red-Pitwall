/**
 * Race-call generation. Produces SUGGESTED pitwall calls from the live
 * projection. Nothing is sent to the driver — the strategist decides.
 */
import { TEMPLATE_LABEL } from './model';
import type { LiveProjection } from './live';
import type { CallPriority, CarEntry, Confidence, DriveMode, Race, Settings } from './types';

export type CallAction =
  | { type: 'boxLap'; lap: number }
  | { type: 'mode'; mode: DriveMode }
  | { type: 'none' };

export interface RaceCall {
  key: string;
  text: string;
  priority: CallPriority;
  reasons: string[];
  confidence: Confidence;
  alternative?: string;
  category: 'pit' | 'fuel' | 'tire' | 'energy' | 'driver' | 'strategy' | 'data' | 'info';
  boxLap?: number;
  action?: CallAction;
  altAction?: CallAction;
  /** Unplanned stop (splash): what to put in. */
  pit?: { fuelAddedL: number; energyAddedPct: number };
}

export interface AlertItem {
  level: 'critical' | 'warning' | 'info';
  code: string;
  text: string;
}

const PRIORITY_ORDER: Record<CallPriority, number> = { CRITICAL: 0, ACTION: 1, UPCOMING: 2, INFO: 3 };

export function minConfidence(...cs: Confidence[]): Confidence {
  if (cs.includes('LOW')) return 'LOW';
  if (cs.includes('MEDIUM')) return 'MEDIUM';
  return 'HIGH';
}

function lapsTxt(n: number) {
  return `${n} LAP${Math.abs(n) === 1 ? '' : 'S'}`;
}

const f1 = (n: number) => (isFinite(n) ? n.toFixed(1) : '∞');
const f2 = (n: number) => (isFinite(n) ? n.toFixed(2) : '∞');

/** Extra saving (%) switching from `from` to `to` gives, relative to what the car burns now. */
export function modeSaving(setup: CarEntry['setup'], from: DriveMode, to: DriveMode, kind: 'fuel' | 'energy'): number {
  const k = kind === 'fuel' ? 'fuelPct' : 'energyPct';
  const a = 1 + (setup.modes[from]?.[k] ?? 0) / 100;
  const b = 1 + (setup.modes[to]?.[k] ?? 0) / 100;
  return a > 0 ? Math.max(0, (1 - b / a) * 100) : 0;
}

/** Whether switching to `mode` for the rest of the stint keeps fuel ≥ `warnLaps` and energy above reserve. */
function affordable(car: CarEntry, p: LiveProjection, mode: DriveMode, warnLaps: number): boolean {
  const { setup, live } = car;
  const cur = p.current;
  if (!cur) return false;
  const lapsLeft = Math.max(1, cur.endLap - p.currentLap + 1);
  const ff = (1 + (setup.modes[mode]?.fuelPct ?? 0) / 100) / (1 + (setup.modes[live.driveMode]?.fuelPct ?? 0) / 100);
  const fuelEnd = cur.fuelEndL - p.fuelRate.value * (ff - 1) * lapsLeft;
  if (!(p.fuelRate.value > 0) || fuelEnd / (p.fuelRate.value * ff) < warnLaps) return false;
  if (setup.energyEnabled && p.energyRate.value > 0) {
    const ef = (1 + (setup.modes[mode]?.energyPct ?? 0) / 100) / (1 + (setup.modes[live.driveMode]?.energyPct ?? 0) / 100);
    const energyEnd = cur.energyEndPct - p.energyRate.value * (ef - 1) * lapsLeft;
    if (energyEnd < setup.energyReservePct + p.energyRate.value * ef) return false;
  }
  return true;
}

/**
 * Fuel / energy to add at an unplanned stop on `boxLap` so the car reaches the
 * flag with the planning reserve (measured rates, current mode).
 */
export function splashAmounts(car: CarEntry, p: LiveProjection, boxLap: number) {
  const { setup, live } = car;
  const lapsTo = Math.max(0, boxLap - p.currentLap + 1);
  const lapsAfter = Math.max(0, p.totalLaps - boxLap);
  // plan with the rate plus its scatter and keep the larger of reserve / safety margin at the flag
  const fpl = p.fuelRate.value * (1 + p.fuelRate.spread);
  const epl = p.energyRate.value * (1 + p.energyRate.spread);
  const fuelAtPit = Math.max(0, live.fuelL - p.fuelRate.value * lapsTo);
  const fuelNeed = fpl * (lapsAfter + Math.max(setup.fuelReserveLaps, setup.fuelSafetyMarginLaps));
  const energyAtPit = Math.max(0, live.energyPct - p.energyRate.value * lapsTo);
  const energyNeed = epl * lapsAfter + setup.energyReservePct;
  return {
    fuelAddedL: Math.min(Math.max(0, setup.fuelCapacityL - fuelAtPit), Math.max(0, fuelNeed - fuelAtPit)),
    energyAddedPct: setup.energyEnabled ? Math.min(Math.max(0, setup.energyCapacityPct - energyAtPit), Math.max(0, energyNeed - energyAtPit)) : 0,
  };
}

export function generateRaceCalls(_race: Race, car: CarEntry, p: LiveProjection, settings: Settings): RaceCall[] {
  const { live, setup, drivers } = car;
  const calls: RaceCall[] = [];
  const dname = (id?: string) => drivers.find((d) => d.id === id)?.name.toUpperCase() ?? '—';
  const conf = minConfidence(p.fuelRate.confidence, setup.energyEnabled ? p.energyRate.confidence : 'HIGH');
  const L = p.currentLap;
  const T = p.window.target;
  const ns = p.nextStop;

  // ── pre-race / finished ─────────────────────────────────────────────────────
  if (live.phase === 'pre' || live.phase === 'grid') {
    const s0 = p.sim.stints[0];
    calls.push({
      key: 'GRID',
      text: `STINT 1 — ${dname(s0?.driverId)} · BOX LAP ${s0?.endLap ?? '—'}`,
      priority: 'INFO',
      reasons: [
        `Plan: ${p.sim.stops.length} stops · ${p.sim.totalLaps} laps projected`,
        `Start fuel ${f1(s0?.fuelStartL ?? 0)} L · ${s0?.compound ?? ''} tires`,
      ],
      confidence: 'LOW',
      category: 'info',
    });
    return calls;
  }
  if (live.phase === 'finished') {
    calls.push({ key: 'FINISHED', text: 'CHEQUERED FLAG', priority: 'INFO', reasons: ['Race complete — review post-race analysis'], confidence: 'HIGH', category: 'info' });
    return calls;
  }

  // ── in pit lane: service instructions ──────────────────────────────────────
  if (live.pitPhase) {
    const s = ns;
    calls.push({
      key: 'PIT_SERVICE',
      text: s
        ? `${TEMPLATE_LABEL[s.template]} · +${f1(s.fuelAddedL)} L`
        : 'PIT SERVICE',
      priority: 'ACTION',
      reasons: s
        ? [
            s.changeTires ? `Tires: ${s.compound}` : 'Tires: NO CHANGE',
            s.driverChange ? `Driver: ${dname(s.fromDriverId)} → ${dname(s.toDriverId)}` : 'Driver: NO CHANGE',
            `Stationary ≈ ${f1(s.stationarySec)} s · total loss ≈ ${f1(s.totalLossSec)} s`,
          ]
        : ['Record the stop when complete'],
      confidence: conf,
      category: 'pit',
    });
  }

  const fuelSafe = p.fuelRange.safeWhole; // whole laps incl. current
  const energySafe = setup.energyEnabled ? p.energyRange.safeWhole : Infinity;
  const resSafe = Math.min(fuelSafe, energySafe);
  const limiter = fuelSafe <= energySafe ? 'Fuel' : 'Energy';
  const ev = p.activeEvent;

  if (!live.pitPhase) {
    if (p.isFinalStint) {
      // final stint: can we make the flag?
      const s = p.current;
      const marginLaps = s ? s.fuelMarginLaps : Infinity;
      const eMargin = s ? s.energyMarginLaps : Infinity;
      const worst = Math.min(marginLaps, eMargin);
      const res = marginLaps <= eMargin ? 'Fuel' : 'Energy';
      const saveMode: DriveMode = res === 'Fuel' ? 'fuelSave' : 'energySave';
      const need = res === 'Fuel' ? p.fuelSavePct : p.energySavePct;
      const avail = modeSaving(setup, live.driveMode, saveMode, res === 'Fuel' ? 'fuel' : 'energy');
      if (worst < 0) {
        const canSave = need > 0 && need <= avail;
        const boxLap = Math.max(L, L + resSafe - 1);
        const amounts = splashAmounts(car, p, boxLap);
        const when = boxLap <= L ? 'THIS LAP' : boxLap === L + 1 ? 'NEXT LAP' : `LAP ${boxLap}`;
        const splashTxt = `SPLASH — BOX ${when}`;
        calls.push({
          key: canSave ? 'SAVE_TO_FLAG' : 'SPLASH_REQUIRED',
          text: canSave ? `${res.toUpperCase()} SAVE TO FLAG` : splashTxt,
          priority: 'CRITICAL',
          reasons: [
            `${res} short by ${f1(Math.abs(worst))} laps at the flag`,
            res === 'Fuel'
              ? `Target ${f2(p.fuelRequiredPerLap)} L/lap (now ${f2(p.fuelRate.value)})`
              : `Target ${f2(p.energyRequiredPerLap)} %/lap (now ${f2(p.energyRate.value)})`,
            canSave ? `${res === 'Fuel' ? 'Fuel' : 'Energy'} save mode gives −${f1(avail)}% (need −${f1(need)}%)` : `Splash +${f1(amounts.fuelAddedL)} L${setup.energyEnabled ? ` · +${f1(amounts.energyAddedPct)} % energy` : ''}`,
          ],
          confidence: conf,
          alternative: canSave ? splashTxt : avail > 0 ? `${res.toUpperCase()} SAVE ${f1(avail)}% (NOT ENOUGH)` : undefined,
          category: res === 'Fuel' ? 'fuel' : 'energy',
          boxLap: canSave ? undefined : boxLap,
          action: canSave ? { type: 'mode', mode: saveMode } : { type: 'boxLap', lap: boxLap },
          altAction: canSave ? { type: 'boxLap', lap: boxLap } : undefined,
          pit: amounts,
        });
      } else if (worst < settings.alerts.fuelMarginCritLaps && avail > 0 && need > 0) {
        calls.push({
          key: 'SAVE_TO_FLAG_MARGIN',
          text: `${res.toUpperCase()} SAVE — MARGIN ${f1(worst)} LAPS`,
          priority: 'ACTION',
          reasons: [`${res} margin at flag ${f1(worst)} laps (below ${settings.alerts.fuelMarginCritLaps})`, `Save mode gives −${f1(avail)}%`],
          confidence: conf,
          alternative: 'MAINTAIN PACE',
          category: res === 'Fuel' ? 'fuel' : 'energy',
          action: { type: 'mode', mode: saveMode },
        });
      } else if (worst < settings.alerts.fuelMarginWarnLaps || !affordable(car, p, 'push', settings.alerts.fuelMarginWarnLaps)) {
        calls.push({
          key: 'MAINTAIN_TO_FLAG',
          text: worst < settings.alerts.fuelMarginWarnLaps ? 'MAINTAIN PACE — TIGHT TO FLAG' : 'MAINTAIN PACE TO FLAG',
          priority: worst < settings.alerts.fuelMarginWarnLaps ? 'ACTION' : 'INFO',
          reasons: [`${res} margin at flag ${f1(worst)} laps`],
          confidence: conf,
          alternative: avail > 0 ? `${res.toUpperCase()} SAVE` : undefined,
          category: 'fuel',
          altAction: avail > 0 ? { type: 'mode', mode: saveMode } : undefined,
        });
      } else {
        calls.push({
          key: 'PUSH_TO_FLAG',
          text: 'PUSH TO THE FLAG',
          priority: 'INFO',
          reasons: [`Fuel margin at flag ${f1(marginLaps)} laps`, setup.energyEnabled ? `Energy margin ${f1(eMargin)} laps` : 'No further stops planned', 'Push mode still keeps the margin (entered effect)'],
          confidence: conf,
          alternative: 'MAINTAIN PACE',
          category: 'info',
          action: { type: 'mode', mode: 'push' },
        });
      }
    } else if (resSafe <= 0) {
      calls.push({
        key: 'BOX_NOW',
        text: 'BOX THIS LAP',
        priority: 'CRITICAL',
        reasons: [
          `${limiter} safe range exhausted (${f2(limiter === 'Fuel' ? p.fuelRange.theoretical : p.energyRange.theoretical)} theoretical laps)`,
          T > L ? `Planned lap ${T} not reachable` : 'Target stint complete',
        ],
        confidence: conf,
        alternative: resSafe < 0 ? undefined : `${limiter.toUpperCase()} SAVE — STAY OUT 1 LAP (UNSAFE)`,
        category: limiter === 'Fuel' ? 'fuel' : 'energy',
        boxLap: L,
        action: { type: 'boxLap', lap: L },
        altAction: resSafe < 0 ? undefined : { type: 'boxLap', lap: L + 1 },
      });
    } else if (ev && ev.pitOpen && L >= p.window.earliest && T - L >= 1) {
      const green = setup.pitLaneLossSec;
      const under = ev.pitLossUnderEventSec;
      calls.push({
        key: 'BOX_EVENT',
        text: 'BOX THIS LAP',
        priority: 'ACTION',
        reasons: [
          `${ev.label} — pit lane open`,
          under != null ? `Pit-lane loss ≈ ${f1(under)} s vs ${f1(green)} s green (entered)` : 'Reduced relative pit loss (not quantified)',
          `Inside window (earliest lap ${p.window.earliest})`,
        ],
        confidence: minConfidence(conf, 'MEDIUM'),
        alternative: `STAY OUT — TARGET LAP ${T}`,
        category: 'pit',
        boxLap: L,
        action: { type: 'boxLap', lap: L },
        altAction: { type: 'none' },
      });
    } else if (ev && !ev.pitOpen && T - L <= 1) {
      calls.push({
        key: 'PIT_CLOSED',
        text: 'STAY OUT — PIT CLOSED',
        priority: 'ACTION',
        reasons: [`${ev.label} — pit entry closed`, `Safe range ${resSafe} laps`],
        confidence: conf,
        alternative: resSafe <= 1 ? 'EMERGENCY STOP' : `BOX WHEN OPEN`,
        category: 'pit',
      });
    } else if (T > L + resSafe - 1) {
      // target beyond safe range → save or box early
      const latest = L + resSafe - 1;
      const savePct = limiter === 'Fuel' ? p.fuelSavePct : p.energySavePct;
      const modeSave = modeSaving(setup, live.driveMode, limiter === 'Fuel' ? 'fuelSave' : 'energySave', limiter === 'Fuel' ? 'fuel' : 'energy');
      const canSave = savePct > 0 && savePct <= modeSave;
      if (canSave) {
        calls.push({
          key: limiter === 'Fuel' ? 'FUEL_SAVE' : 'ENERGY_SAVE',
          text: limiter === 'Fuel' ? `FUEL SAVE — ${f2(p.fuelRequiredPerLap)} L/LAP` : `ENERGY SAVE — ${f2(p.energyRequiredPerLap)} %/LAP`,
          priority: 'ACTION',
          reasons: [
            `Target lap ${T} needs −${f1(savePct)}% ${limiter.toLowerCase()} use`,
            limiter === 'Fuel'
              ? `Current ${f2(p.fuelRate.value)} L/lap · safe range to lap ${latest}`
              : `Current ${f2(p.energyRate.value)} %/lap · safe range to lap ${latest}`,
            `${limiter === 'Fuel' ? 'Fuel' : 'Energy'} save mode gives −${f1(modeSave)}% from the current mode`,
          ],
          confidence: conf,
          alternative: `BOX LAP ${latest}`,
          category: limiter === 'Fuel' ? 'fuel' : 'energy',
          action: { type: 'mode', mode: limiter === 'Fuel' ? 'fuelSave' : 'energySave' },
          altAction: { type: 'boxLap', lap: Math.max(L, latest) },
        });
      } else {
        calls.push({
          key: 'BOX_EARLY',
          text: latest <= L ? 'BOX THIS LAP' : latest === L + 1 ? 'BOX NEXT LAP' : `BOX LAP ${latest}`,
          priority: latest <= L + 1 ? 'CRITICAL' : 'ACTION',
          reasons: [
            `${limiter} safe range ends lap ${latest} (target ${T})`,
            modeSave > 0 ? `Saving needed −${f1(savePct)}% exceeds what save mode gives (−${f1(modeSave)}%)` : `Already in save mode — needs −${f1(savePct)}% more`,
          ],
          confidence: conf,
          alternative: `${limiter.toUpperCase()} SAVE ${f1(savePct)}%`,
          category: 'pit',
          boxLap: latest,
          action: { type: 'boxLap', lap: Math.max(L, latest) },
          altAction: { type: 'mode', mode: limiter === 'Fuel' ? 'fuelSave' : 'energySave' },
        });
      }
    } else if (T <= L) {
      const reasons = [`Target stint complete (lap ${T})`, `Fuel at pit ${f1(p.fuelAtPitL)} L · ${f1(p.fuelAtPitLaps)} laps margin`];
      if (ns?.driverChange) reasons.push(`Driver change → ${dname(ns.toDriverId)}`);
      if (ns) reasons.push(ns.changeTires ? `Tires: ${ns.compound}` : 'No tire change');
      calls.push({
        key: 'BOX_THIS_LAP',
        text: 'BOX THIS LAP',
        priority: 'CRITICAL',
        reasons,
        confidence: conf,
        alternative: p.extendLaps > 0 ? `EXTEND ${lapsTxt(Math.min(p.extendLaps, 3))}` : undefined,
        category: 'pit',
        boxLap: L,
        action: { type: 'boxLap', lap: L },
        altAction: p.extendLaps > 0 ? { type: 'boxLap', lap: T + Math.min(p.extendLaps, 3) } : undefined,
      });
    } else if (T === L + 1) {
      const reasons = [`Fuel margin at pit ${f1(p.fuelAtPitLaps)} laps`, `Target stint length reached`];
      if (ns?.driverChange) reasons.push(`Driver change scheduled → ${dname(ns.toDriverId)}`);
      calls.push({
        key: 'BOX_NEXT_LAP',
        text: 'BOX NEXT LAP',
        priority: 'ACTION',
        reasons,
        confidence: conf,
        alternative: p.extendLaps > 0 ? `EXTEND ${lapsTxt(Math.min(p.extendLaps, 3))}` : 'BOX THIS LAP',
        category: 'pit',
        boxLap: T,
        action: { type: 'boxLap', lap: T },
        altAction: p.extendLaps > 0 ? { type: 'boxLap', lap: T + Math.min(p.extendLaps, 3) } : { type: 'boxLap', lap: L },
      });
    } else if (T - L <= settings.alerts.pitWindowWarnLaps + 1) {
      calls.push({
        key: 'PREPARE_PIT',
        text: `PREPARE PIT — BOX LAP ${T}`,
        priority: 'UPCOMING',
        reasons: [`${lapsTxt(T - L)} to target`, ns ? `${TEMPLATE_LABEL[ns.template]} · +${f1(ns.fuelAddedL)} L` : ''].filter(Boolean),
        confidence: conf,
        alternative: p.extendLaps > 0 ? `EXTEND ${lapsTxt(Math.min(p.extendLaps, 3))}` : undefined,
        category: 'pit',
        boxLap: T,
        action: { type: 'boxLap', lap: T },
        altAction: p.extendLaps > 0 ? { type: 'boxLap', lap: T + Math.min(p.extendLaps, 3) } : undefined,
      });
    } else {
      const reasons = [`Target lap ${T} · ${lapsTxt(T - L)} to go`, `Safe range ${resSafe} laps (${limiter.toLowerCase()})`];
      calls.push({
        key: 'STAY_OUT',
        text: `STAY OUT — TARGET LAP ${T}`,
        priority: 'INFO',
        reasons,
        confidence: conf,
        alternative: L >= p.window.earliest ? `BOX EARLY — LAP ${Math.max(L, p.window.earliest)}` : `WINDOW OPENS LAP ${p.window.earliest}`,
        category: 'pit',
        boxLap: T,
        action: { type: 'boxLap', lap: T },
        altAction: L >= p.window.earliest ? { type: 'boxLap', lap: Math.max(L, p.window.earliest) } : undefined,
      });
    }
  }

  // ── secondary calls ─────────────────────────────────────────────────────────
  if (!p.isFinalStint && !live.pitPhase) {
    if (p.window.state === 'OPEN' && T > L)
      calls.push({ key: 'WINDOW_OPEN', text: 'PIT WINDOW OPEN', priority: 'INFO', reasons: [`Laps ${p.window.earliest}–${p.window.latest}`], confidence: conf, category: 'pit' });
    if (p.window.state === 'CLOSING')
      calls.push({ key: 'WINDOW_CLOSING', text: `PIT WINDOW CLOSING — LATEST LAP ${p.window.latest}`, priority: 'ACTION', reasons: [`${limiter} safe range`], confidence: conf, category: 'pit' });
    if (ns?.driverChange && T - L <= 6)
      calls.push({ key: 'DRIVER_NEXT', text: `DRIVER CHANGE NEXT STOP → ${dname(ns.toDriverId)}`, priority: 'UPCOMING', reasons: [`Stop at lap ${ns.lap}`], confidence: 'HIGH', category: 'driver' });
    if (ns && T - L <= 6)
      calls.push({
        key: ns.changeTires ? 'TAKE_TIRES' : 'NO_TIRES',
        text: ns.changeTires ? `TAKE TIRES — ${ns.compound}` : 'NO TIRE CHANGE',
        priority: 'UPCOMING',
        reasons: [ns.changeTires ? `Tire age at pit ${p.tireAgeAtPit} laps` : `Next stint ends on ${p.nextStint?.tireAgeEnd ?? '—'}-lap tires`],
        confidence: 'HIGH',
        category: 'tire',
      });
  }

  // tires
  const cur = p.current;
  if (cur) {
    const spec = setup.compounds.find((c) => c.name === live.compound);
    if (spec && live.tireAge >= spec.maxLife)
      calls.push({ key: 'TIRE_MAX', text: 'TIRES AT MAXIMUM LIFE', priority: 'CRITICAL', reasons: [`${live.compound} ${live.tireAge}/${spec.maxLife} laps`], confidence: 'HIGH', category: 'tire', alternative: 'TAKE TIRES NEXT STOP' });
    else if (spec && live.tireAge >= spec.targetLife)
      calls.push({ key: 'TIRE_SAVE', text: 'TIRE SAVE REQUIRED', priority: 'ACTION', reasons: [`${live.compound} ${live.tireAge} laps ≥ target ${spec.targetLife}`], confidence: 'MEDIUM', category: 'tire' });
    else if (spec && ns && !ns.changeTires && p.nextStint && p.nextStint.tireAgeEnd > spec.targetLife)
      calls.push({ key: 'TIRE_EXTEND', text: 'TIRE SAVE — DOUBLE STINT', priority: 'UPCOMING', reasons: [`Tires reach ${p.nextStint.tireAgeEnd} laps next stint (target ${spec.targetLife})`], confidence: 'MEDIUM', category: 'tire', alternative: 'TAKE TIRES' });
  }

  // energy
  if (setup.energyEnabled && !p.isFinalStint && p.energyRate.value > 0 && !live.pitPhase) {
    const surplusLaps = (p.energyAtPitPct - setup.energyReservePct) / p.energyRate.value;
    if (p.energySavePct > 0.5 && !calls.some((c) => c.key === 'ENERGY_SAVE'))
      calls.push({ key: 'ENERGY_SAVE', text: `ENERGY SAVE ${f1(p.energySavePct)}%`, priority: 'ACTION', reasons: [`Need ${f2(p.energyRequiredPerLap)} %/lap to reach lap ${T}`, `Current ${f2(p.energyRate.value)} %/lap`], confidence: p.energyRate.confidence, category: 'energy', action: { type: 'mode', mode: 'energySave' } });
    else if (surplusLaps >= 1.5)
      calls.push({ key: 'ENERGY_DEPLOY', text: `ENERGY DEPLOY +${f1(p.energyAtPitPct - setup.energyReservePct)}%`, priority: 'INFO', reasons: [`Projected ${f1(p.energyAtPitPct)}% at pit vs reserve ${setup.energyReservePct}%`], confidence: p.energyRate.confidence, category: 'energy' });
  }

  // fuel info / push
  if (!p.isFinalStint && !live.pitPhase && isFinite(p.fuelAtPitLaps)) {
    const m = p.fuelAtPitLaps;
    if (m >= 0 && m < settings.alerts.fuelMarginCritLaps)
      calls.push({ key: 'FUEL_MARGIN_CRIT', text: `FUEL MARGIN ${f1(m)} LAPS AT PIT`, priority: 'ACTION', reasons: [`Below ${settings.alerts.fuelMarginCritLaps}-lap threshold`], confidence: conf, category: 'fuel' });
    else if (m >= 0)
      calls.push({ key: 'FUEL_MARGIN', text: `FUEL MARGIN +${f1(m)} LAPS`, priority: 'INFO', reasons: [`${f1(p.fuelAtPitL)} L projected at lap ${T}`], confidence: conf, category: 'fuel' });
    if (live.driveMode !== 'push' && (!setup.energyEnabled || p.energySavePct === 0) && affordable(car, p, 'push', settings.alerts.fuelMarginWarnLaps))
      calls.push({ key: 'PUSH', text: 'PUSH', priority: 'INFO', reasons: ['Push mode keeps fuel & energy margin to the stop (entered effect)'], confidence: conf, category: 'info', action: { type: 'mode', mode: 'push' } });
    else if (m >= 0)
      calls.push({ key: 'MAINTAIN', text: 'MAINTAIN PACE', priority: 'INFO', reasons: ['Margins within plan'], confidence: conf, category: 'info' });
  }

  // strategy validity downstream
  const future = p.sim.issues.filter((i) => i.severity === 'critical' && (i.stint ?? 0) > p.stintIndex);
  if (future.length)
    calls.push({ key: 'STRATEGY_UPDATE', text: 'STRATEGY UPDATE REQUIRED', priority: 'ACTION', reasons: future.slice(0, 2).map((i) => i.message), confidence: conf, category: 'strategy' });

  // stale data
  if (p.dataAgeLaps >= settings.alerts.staleDataLaps)
    calls.push({ key: 'DATA_STALE', text: 'DATA UPDATE REQUIRED', priority: 'ACTION', reasons: [`Last manual input lap ${live.lastUpdateLap} (${p.dataAgeLaps} laps ago)`], confidence: 'LOW', category: 'data' });

  // de-dupe + order (primary call remains first within its priority)
  const seen = new Set<string>();
  const primary = calls[0];
  const rest = calls
    .slice(1)
    .filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)))
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  if (!primary) return rest;
  // escalate: a CRITICAL secondary outranks an INFO/UPCOMING primary
  const top = rest.find((c) => c.priority === 'CRITICAL' && PRIORITY_ORDER[primary.priority] > 0);
  if (top) return [top, primary, ...rest.filter((c) => c !== top)];
  return [primary, ...rest];
}

/** Primary suggested call (first of generateRaceCalls). */
export function generateRaceCall(race: Race, car: CarEntry, p: LiveProjection, settings: Settings): RaceCall | undefined {
  return generateRaceCalls(race, car, p, settings)[0];
}

export function deriveAlerts(car: CarEntry, p: LiveProjection, settings: Settings, pendingWarnings: number): AlertItem[] {
  const out: AlertItem[] = [];
  const { live, setup } = car;
  if (live.phase !== 'racing') return out;
  const L = p.currentLap;
  if (!p.isFinalStint) {
    if (p.window.state === 'OPEN') out.push({ level: 'info', code: 'WINDOW_OPEN', text: 'PIT WINDOW OPEN' });
    else if (p.window.state === 'CLOSED' && p.window.earliest - L <= 2 && p.window.earliest > L)
      out.push({ level: 'info', code: 'WINDOW_SOON', text: `PIT WINDOW IN ${p.window.earliest - L} LAP${p.window.earliest - L > 1 ? 'S' : ''}` });
    if (p.window.state === 'CLOSING') out.push({ level: 'warning', code: 'WINDOW_CLOSING', text: 'PIT WINDOW CLOSING' });
    if (p.window.state === 'MISSED') out.push({ level: 'critical', code: 'WINDOW_MISSED', text: 'SAFE RANGE EXCEEDED' });
  }
  const fuelMargin = p.isFinalStint ? (p.current?.fuelMarginLaps ?? Infinity) : p.fuelAtPitLaps;
  if (fuelMargin < settings.alerts.fuelMarginCritLaps)
    out.push({ level: 'critical', code: 'FUEL_MARGIN', text: `FUEL MARGIN < ${settings.alerts.fuelMarginCritLaps} LAP` });
  else if (fuelMargin < settings.alerts.fuelMarginWarnLaps)
    out.push({ level: 'warning', code: 'FUEL_MARGIN_WARN', text: `FUEL MARGIN < ${settings.alerts.fuelMarginWarnLaps} LAPS` });
  const spec = setup.compounds.find((c) => c.name === live.compound);
  if (spec && live.tireAge >= spec.targetLife * (settings.alerts.tireWarnPctOfTarget / 100))
    out.push({ level: live.tireAge >= spec.maxLife ? 'critical' : 'warning', code: 'TIRE_TARGET', text: live.tireAge >= spec.targetLife ? 'TIRE TARGET REACHED' : 'TIRE TARGET APPROACHING' });
  if (setup.energyEnabled && p.energyTargetPct != null && live.energyPct < p.energyTargetPct - settings.alerts.energyMarginWarnPct)
    out.push({ level: 'warning', code: 'ENERGY_TARGET', text: 'ENERGY TARGET MISSED' });
  if (p.sim.issues.some((i) => i.severity === 'critical'))
    out.push({ level: 'critical', code: 'STRATEGY_INVALID', text: 'STRATEGY INVALIDATED' });
  if (pendingWarnings > 0) out.push({ level: 'warning', code: 'DATA_CONFLICT', text: 'DATA INPUT CONFLICT' });
  if (p.nextStop?.driverChange && p.window.target - L <= 2) out.push({ level: 'info', code: 'DRIVER_DUE', text: 'DRIVER CHANGE DUE' });
  if (p.dataAgeLaps >= settings.alerts.staleDataLaps) out.push({ level: 'warning', code: 'STALE', text: 'DATA STALE' });
  return out;
}

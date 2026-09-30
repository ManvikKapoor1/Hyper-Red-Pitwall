import { formatLapMs } from '../engine/format';
import type { FuelMethod, Settings } from '../engine/types';
import { Field, NumInput, Panel, Seg } from '../components/ui';
import { useUnits } from '../lib/units';
import { useStore } from '../store/store';

export function SettingsPage() {
  const s = useStore((st) => st.settings);
  const update = useStore((st) => st.updateSettings);
  const resetAll = useStore((st) => st.resetAll);
  const toast = useStore((st) => st.toast);
  const u = useUnits();
  const d = s.defaults;
  const a = s.alerts;
  const setD = (patch: Partial<Settings['defaults']>) => update({ defaults: patch });
  const setA = (patch: Partial<Settings['alerts']>) => update({ alerts: patch });
  return (
    <div className="page">
      <div className="page-h">
        <div>
          <h1 className="head" style={{ fontSize: 26 }}>
            Settings
          </h1>
          <div className="sub">Stored in this browser. Internal values stay metric; units only change what you see and type.</div>
        </div>
      </div>
      <div className="settings-grid">
        <Panel title="Units & display">
          <div className="col gap-12">
            <Field group label="Fuel">
              <Seg options={[{ value: 'L' as const, label: 'Litres' }, { value: 'gal' as const, label: 'US gallons' }]} value={s.units.fuel} onChange={(v) => update({ units: { fuel: v } })} />
            </Field>
            <Field group label="Temperature">
              <Seg options={[{ value: 'C' as const, label: '°C' }, { value: 'F' as const, label: '°F' }]} value={s.units.temp} onChange={(v) => update({ units: { temp: v } })} />
            </Field>
            <Field group label="Distance">
              <Seg options={[{ value: 'km' as const, label: 'km' }, { value: 'mi' as const, label: 'miles' }]} value={s.units.distance} onChange={(v) => update({ units: { distance: v } })} />
            </Field>
            <Field group label="Lap-time decimals" hint={`Example ${formatLapMs(95212, s.time.lapDecimals)}`}>
              <Seg options={[1, 2, 3].map((n) => ({ value: n as 1 | 2 | 3, label: String(n) }))} value={s.time.lapDecimals} onChange={(v) => update({ time: { lapDecimals: v } })} />
            </Field>
            <Field group label="Clock">
              <Seg options={[{ value: '24', label: '24 h' }, { value: '12', label: '12 h' }]} value={s.time.clock24h ? '24' : '12'} onChange={(v) => update({ time: { clock24h: v === '24' } })} />
            </Field>
            <Field group label="Fuel decimals" hint={`Example ${u.fuelU(18.37)}`}>
              <Seg options={[1, 2].map((n) => ({ value: n as 1 | 2, label: String(n) }))} value={s.numbers.fuelDecimals} onChange={(v) => update({ numbers: { fuelDecimals: v } })} />
            </Field>
            <Field group label="Decimal separator">
              <Seg options={[{ value: 'dot', label: '1.5' }, { value: 'comma', label: '1,5' }]} value={s.numbers.decimalComma ? 'comma' : 'dot'} onChange={(v) => update({ numbers: { decimalComma: v === 'comma' } })} />
            </Field>
          </div>
        </Panel>

        <Panel title="Theme">
          <div className="col gap-12">
            <Seg
              options={[
                { value: 'dark' as const, label: 'Dark', title: 'Default pitwall theme' },
                { value: 'contrast' as const, label: 'High contrast', title: 'Brighter text and lines for bright rooms / projectors' },
                { value: 'light' as const, label: 'Light' },
              ]}
              value={s.theme}
              onChange={(v) => update({ theme: v })}
            />
            <div className="sublabel">Colour is reserved for race-critical state in every theme: green OK · amber warning · red critical · blue info / alternative · violet energy.</div>
            <div className="row gap-4 wrap">
              <span className="badge green">OK</span>
              <span className="badge amber">Warning</span>
              <span className="badge red">Critical</span>
              <span className="badge blue">Info</span>
              <span className="badge violet">Energy</span>
            </div>
          </div>
        </Panel>

        <Panel title="Defaults for new cars & races">
          <div className="grid-2">
            <Field label="Fuel reserve (laps)">
              <NumInput value={d.fuelReserveLaps} decimals={2} step={0.1} min={0} onChange={(v) => setD({ fuelReserveLaps: v })} />
            </Field>
            <Field label="Fuel safety margin (laps)">
              <NumInput value={d.fuelSafetyMarginLaps} decimals={2} step={0.1} min={0} onChange={(v) => setD({ fuelSafetyMarginLaps: v })} />
            </Field>
            <Field label="Energy reserve (%)">
              <NumInput value={d.energyReservePct} decimals={1} min={0} onChange={(v) => setD({ energyReservePct: v })} />
            </Field>
            <Field label="Early-pit threshold (laps)" hint="Stops this far before the safe limit are flagged EARLY">
              <NumInput value={d.earlyPitThresholdLaps} decimals={0} min={0} onChange={(v) => setD({ earlyPitThresholdLaps: Math.round(v) })} />
            </Field>
            <Field group label="Tire strategy" className="span-2">
              <Seg options={[{ value: 'double' as const, label: 'Double stint' }, { value: 'every' as const, label: 'Every stop' }]} value={d.tireStrategy} onChange={(v) => setD({ tireStrategy: v })} />
            </Field>
            <Field label="Fuel method">
              <select className="select" value={d.fuelMethod} onChange={(e) => setD({ fuelMethod: e.target.value as FuelMethod })}>
                <option value="lastN">Last N laps</option>
                <option value="stint">Stint average</option>
                <option value="race">Race average</option>
                <option value="user">User value</option>
              </select>
            </Field>
            <Field label="N (last laps)">
              <NumInput value={d.lastN} decimals={0} min={1} onChange={(v) => setD({ lastN: Math.round(v) })} />
            </Field>
          </div>
        </Panel>

        <Panel title="Alert thresholds">
          <div className="grid-2">
            <Field label="Fuel margin warning (laps)">
              <NumInput value={a.fuelMarginWarnLaps} decimals={1} step={0.1} min={0} onChange={(v) => setA({ fuelMarginWarnLaps: v })} />
            </Field>
            <Field label="Fuel margin critical (laps)">
              <NumInput value={a.fuelMarginCritLaps} decimals={1} step={0.1} min={0} onChange={(v) => setA({ fuelMarginCritLaps: v })} />
            </Field>
            <Field label="Energy margin warning (%)">
              <NumInput value={a.energyMarginWarnPct} decimals={1} min={0} onChange={(v) => setA({ energyMarginWarnPct: v })} />
            </Field>
            <Field label="Tire warning (% of target life)">
              <NumInput value={a.tireWarnPctOfTarget} decimals={0} min={0} max={200} onChange={(v) => setA({ tireWarnPctOfTarget: v })} />
            </Field>
            <Field label="Pit window warning (laps)">
              <NumInput value={a.pitWindowWarnLaps} decimals={0} min={0} onChange={(v) => setA({ pitWindowWarnLaps: Math.round(v) })} />
            </Field>
            <Field label="Stale data (laps without input)">
              <NumInput value={a.staleDataLaps} decimals={0} min={1} onChange={(v) => setA({ staleDataLaps: Math.round(v) })} />
            </Field>
            <Field label="Consumption change (%)" hint="Flags a lap that differs this much from the average">
              <NumInput value={a.consumptionChangePct} decimals={0} min={0} onChange={(v) => setA({ consumptionChangePct: v })} />
            </Field>
            <Field label="Lap-time deviation (%)">
              <NumInput value={a.lapTimeDeviationPct} decimals={0} min={0} onChange={(v) => setA({ lapTimeDeviationPct: v })} />
            </Field>
          </div>
        </Panel>

        <Panel title="Data" className="span-2">
          <div className="row gap-12 wrap">
            <div className="sublabel grow">
              Everything is stored in this browser (localStorage key <span className="mono">stint.v1</span>). Export a backup from any race’s Data page first. Reset removes your races, library and settings and reloads the SAMPLE DATA races.
            </div>
            <button
              className="btn danger"
              onClick={() => {
                if (!confirm('Delete all races, strategies, library entries and settings in this browser? This cannot be undone.')) return;
                resetAll();
                toast('All data reset — sample races reloaded', 'warn');
              }}
            >
              Reset all data
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

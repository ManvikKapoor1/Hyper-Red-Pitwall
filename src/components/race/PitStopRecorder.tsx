import { useState } from 'react';
import type { LiveProjection } from '../../engine/live';
import { splashAmounts } from '../../engine/calls';
import { activeEventAt, calculatePitLoss } from '../../engine/model';
import type { CarEntry, Race } from '../../engine/types';
import { useUnits } from '../../lib/units';
import { useStore } from '../../store/store';
import { Field, Modal, NumInput } from '../ui';

/** Records a completed pit stop — the human confirms what actually happened. */
export function PitStopRecorder({ race, car, p, nowSec, prefill, onClose }: { race: Race; car: CarEntry; p: LiveProjection; nowSec: number; prefill?: { fuelAfterL?: number }; onClose: () => void }) {
  const u = useUnits();
  const recordStop = useStore((s) => s.recordStop);
  const ns = p.nextStop;
  const { live, setup } = car;
  const nextDriver = ns?.toDriverId ?? live.driverId;
  const [inLap, setInLap] = useState(live.lapsCompleted + 1);
  // fuel / energy when the car reaches the box: the in-lap still burns one lap unless it is already counted
  const inLapPending = live.lapsCompleted + 1;
  const entryFuel = Math.max(0, live.fuelL - p.fuelRate.value);
  const entryEnergy = Math.max(0, live.energyPct - p.energyRate.value);
  // planned stop, or — with no stop left in the plan — a splash sized to reach the flag
  const planned = ns ? { fuelAddedL: ns.fuelAddedL, energyAddedPct: ns.energyAddedPct } : splashAmounts(car, p, inLapPending);
  const [fuelAdded, setFuelAdded] = useState<number>(prefill?.fuelAfterL != null ? Math.max(0, prefill.fuelAfterL - entryFuel) : Math.min(planned.fuelAddedL, setup.fuelCapacityL - entryFuel));
  const [energyAfter, setEnergyAfter] = useState<number>(Math.min(setup.energyCapacityPct, entryEnergy + planned.energyAddedPct));
  const [tires, setTires] = useState<boolean>(ns?.changeTires ?? false);
  const [compound, setCompound] = useState<string>(ns?.compound ?? live.compound);
  const [driver, setDriver] = useState<string>(nextDriver);
  const est = calculatePitLoss(setup, { fuelAddedL: fuelAdded, changeTires: tires, driverChange: driver !== live.driverId });
  const [stationary, setStationary] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const ev = activeEventAt(race.events, nowSec);
  const stat = stationary ?? est.stationarySec;
  const tot = total ?? (ev?.pitLossUnderEventSec != null ? ev.pitLossUnderEventSec + stat : est.laneSec + stat);

  return (
    <Modal
      title="Record pit stop"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn go"
            onClick={() => {
              recordStop(race.id, car.id, {
                inLap,
                fuelAddedL: fuelAdded,
                energyAfterPct: setup.energyEnabled ? energyAfter : undefined,
                changeTires: tires,
                compound,
                toDriverId: driver,
                stationarySec: stat,
                totalLossSec: tot,
                stationaryTimed: stationary != null,
                totalTimed: total != null,
                note,
                underEvent: ev?.type,
              });
              onClose();
            }}
          >
            Confirm stop · start stint {live.stintIndex + 2}
          </button>
        </>
      }
    >
      <div className="notice mb-8">
        {ns ? (
          <>
            Plan for this stop: <b>{`+${u.fuel(ns.fuelAddedL)} ${u.fuelUnit} · ${ns.changeTires ? 'tires ' + ns.compound : 'no tires'} · ${ns.driverChange ? 'driver change' : 'same driver'}`}</b>.
          </>
        ) : (
          <>
            No stop left in the plan — suggested splash to reach the flag: <b>+{u.fuelU(planned.fuelAddedL)}</b>.
          </>
        )}{' '}
        Enter what actually happened.
        {ev && <span className="c-amber"> Stop under {ev.label}.</span>}
      </div>
      <div className="grid-4">
        <Field label="In-lap" hint={inLap === live.lapsCompleted + 1 ? 'Completes current lap' : 'Already counted'}>
          <NumInput value={inLap} decimals={0} min={Math.max(1, live.lapsCompleted)} max={live.lapsCompleted + 1} onChange={setInLap} />
        </Field>
        <Field label={`Fuel added (${u.fuelUnit})`} hint={`Tank ${u.fuel(setup.fuelCapacityL)} · now ${u.fuel(live.fuelL)}`}>
          <NumInput value={u.fuelVal(fuelAdded)} decimals={1} step={0.5} min={0} onChange={(v) => setFuelAdded(u.fuelFromDisplay(v))} />
        </Field>
        {setup.energyEnabled && (
          <Field label="Energy after (%)" hint={`Now ${u.pct(live.energyPct)}%`}>
            <NumInput value={energyAfter} decimals={1} min={0} max={setup.energyCapacityPct} onChange={setEnergyAfter} />
          </Field>
        )}
        <Field label="Driver out">
          <select className="select" value={driver} onChange={(e) => setDriver(e.target.value)}>
            {car.drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.id === live.driverId ? ' (same)' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tires">
          <select className="select" value={tires ? 'change' : 'keep'} onChange={(e) => setTires(e.target.value === 'change')}>
            <option value="keep">No change</option>
            <option value="change">Change</option>
          </select>
        </Field>
        <Field label="Compound">
          <select className="select" value={compound} disabled={!tires} onChange={(e) => setCompound(e.target.value)}>
            {setup.compounds.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Stationary (s)" hint={`Estimate ${u.n(est.stationarySec, 1)} s`}>
          <NumInput value={stat} decimals={1} min={0} onChange={setStationary} />
        </Field>
        <Field label="Total pit loss (s)" hint={`Estimate ${u.n(est.laneSec + est.stationarySec, 1)} s`}>
          <NumInput value={tot} decimals={1} min={0} onChange={setTotal} />
        </Field>
      </div>
      <Field label="Note" className="mt-8">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. slow left-rear" />
      </Field>
    </Modal>
  );
}

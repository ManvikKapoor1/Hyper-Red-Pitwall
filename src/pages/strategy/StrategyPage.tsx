import { useState, type ReactNode } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { formatClock } from '../../engine/format';
import type { CarEntry, Race } from '../../engine/types';
import { CarSelector } from '../../components/race/RaceHeader';
import { RaceStatusBadge } from '../../components/race/RaceStatusBadge';
import { Badge, Field, Modal, SampleBadge, Stat } from '../../components/ui';
import { activeCar, usePlanResult, useRaceFromRoute } from '../../lib/hooks';
import { useUnits } from '../../lib/units';
import { useStore } from '../../store/store';
import { AlternativesTab } from './AlternativesTab';
import { BuilderTab } from './BuilderTab';
import { EnergyTab } from './EnergyTab';
import { FuelTab } from './FuelTab';
import { PitStopsTab } from './PitStopsTab';
import { marginClass, type TabProps } from './shared';
import { SimulationTab } from './SimulationTab';
import { StintsTab } from './StintsTab';
import { TimelineTab } from './TimelineTab';
import { TiresTab } from './TiresTab';
import { VersionsTab } from './VersionsTab';

const TABS: { key: string; label: string; el: (p: TabProps) => ReactNode }[] = [
  { key: 'builder', label: 'Builder', el: (p) => <BuilderTab {...p} /> },
  { key: 'stints', label: 'Stints', el: (p) => <StintsTab {...p} /> },
  { key: 'pitstops', label: 'Pit stops', el: (p) => <PitStopsTab {...p} /> },
  { key: 'fuel', label: 'Fuel', el: (p) => <FuelTab {...p} /> },
  { key: 'tires', label: 'Tires', el: (p) => <TiresTab {...p} /> },
  { key: 'energy', label: 'Energy', el: (p) => <EnergyTab {...p} /> },
  { key: 'alternatives', label: 'Alternatives', el: (p) => <AlternativesTab {...p} /> },
  { key: 'simulation', label: 'Simulation', el: (p) => <SimulationTab {...p} /> },
  { key: 'timeline', label: 'Timeline', el: (p) => <TimelineTab {...p} /> },
  { key: 'versions', label: 'Versions', el: (p) => <VersionsTab {...p} /> },
];

export function StrategyPage() {
  const race = useRaceFromRoute();
  if (!race) return <div className="empty">Race not found. <Link to="/app">Back to dashboard</Link></div>;
  return <Strategy race={race} car={activeCar(race)} />;
}

function Strategy({ race, car }: { race: Race; car: CarEntry }) {
  const { tab = 'builder' } = useParams();
  const res = usePlanResult(race, car);
  const current = TABS.find((t) => t.key === tab) ?? TABS[0];
  const [saving, setSaving] = useState(false);
  const saveToLibrary = useStore((s) => s.saveToLibrary);
  return (
    <>
      <div className="ctx-bar">
        <span className="title ellipsis">{race.params.name}</span>
        <CarSelector race={race} />
        <span className="sublabel">
          #{car.number} {car.setup.car} · plan “{car.plan.name}”
        </span>
        <RaceStatusBadge status={race.status} size="sm" />
        {race.sample && <SampleBadge />}
        {car.planDirty && (
          <Badge size="sm" color="amber" title="The plan has edits that are not saved as a version yet">
            Unsaved changes
          </Badge>
        )}
        <div className="row gap-4" style={{ marginLeft: 'auto' }}>
          <button className="btn sm ghost" onClick={() => saveToLibrary(race.id, car.id, `${car.plan.name} — ${race.params.track}`)} title="Keep a copy of this plan in the strategy library">
            Save to library
          </button>
          <button className="btn sm primary" onClick={() => setSaving(true)}>
            Save version
          </button>
          <Link className="btn sm" to={`/app/race/${race.id}/live`}>
            Live race
          </Link>
        </div>
      </div>
      <div className="page full">
        <PlanSummary car={car} res={res} />
        <nav className="tabs" aria-label="Strategy sections">
          {TABS.map((t) => (
            <NavLink key={t.key} to={`/app/race/${race.id}/strategy/${t.key}`} className={t.key === current.key ? 'on' : ''}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div key={car.id}>{current.el({ race, car, res })}</div>
      </div>
      {saving && <SaveVersionModal race={race} car={car} onClose={() => setSaving(false)} />}
    </>
  );
}

function PlanSummary({ car, res }: { car: CarEntry; res: TabProps['res'] }) {
  const u = useUnits();
  const crit = res.issues.filter((i) => i.severity === 'critical').length;
  const warn = res.issues.filter((i) => i.severity === 'warning').length;
  return (
    <div className="plan-summary">
      <Stat k="Stops" v={res.stops.length} size="lg" />
      <Stat k="Stints" v={res.stints.length} size="lg" />
      <Stat k="Race laps" v={res.totalLaps} size="lg" />
      <Stat k="Finish" v={formatClock(res.finishSec)} size="lg" h="race time at flag" />
      <Stat k="Pit loss" v={u.n(res.totalPitLossSec, 0)} u="s" size="lg" />
      <Stat k="Fuel used" v={u.fuel(res.fuelUsedL, 0)} u={u.fuelUnit} size="lg" />
      <Stat k="Min fuel margin" v={<span className={marginClass(res.minFuelMarginLaps)}>{u.n(res.minFuelMarginLaps, 1)}</span>} u="laps" size="lg" />
      {car.setup.energyEnabled && <Stat k="Min energy margin" v={<span className={marginClass(res.minEnergyMarginLaps)}>{u.n(res.minEnergyMarginLaps, 1)}</span>} u="laps" size="lg" />}
      <Stat k="Tire sets" v={res.tireSets} size="lg" h={`max age ${res.maxTireAge} laps`} />
      <div className="stat">
        <span className="k">Plan check</span>
        <span className="row gap-4" style={{ marginTop: 4 }}>
          {crit > 0 && <Badge color="red">{crit} critical</Badge>}
          {warn > 0 && <Badge color="amber">{warn} warning{warn > 1 ? 's' : ''}</Badge>}
          {!crit && !warn && <Badge color="green">Feasible</Badge>}
        </span>
      </div>
    </div>
  );
}

function SaveVersionModal({ race, car, onClose }: { race: Race; car: CarEntry; onClose: () => void }) {
  const saveVersion = useStore((s) => s.saveVersion);
  const [label, setLabel] = useState(car.versions.length ? 'Plan update' : 'Pre-race');
  const [reason, setReason] = useState('');
  return (
    <Modal
      title="Save strategy version"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!label.trim()}
            onClick={() => {
              saveVersion(race.id, car.id, label.trim(), reason.trim() || 'No reason given');
              onClose();
            }}
          >
            Save version
          </button>
        </>
      }
    >
      <div className="col gap-12">
        <Field label="Label">
          <input className="input" value={label} autoFocus onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Reason" hint="Why the plan changed — shown in the version history and on the timeline">
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

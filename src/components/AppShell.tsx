import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useStore } from '../store/store';
import { IconAnalysis, IconCalls, IconChevronLeft, IconChevronRight, IconDash, IconData, IconLive, IconSettings, IconSetup, IconStrategy } from './icons';
import { Logo, Toasts } from './ui';
import { RaceStatusBadge } from './race/RaceStatusBadge';

export function AppShell() {
  const { raceId } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const races = useStore((s) => s.races);
  const activeRaceId = useStore((s) => s.activeRaceId);
  const setActiveRace = useStore((s) => s.setActiveRace);
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const theme = useStore((s) => s.settings.theme);
  const isLive = /\/live$/.test(loc.pathname);
  const [collapsed, setCollapsed] = useState(false);
  const rid = raceId ?? activeRaceId ?? races[0]?.id;
  const race = races.find((r) => r.id === rid);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (raceId && raceId !== activeRaceId) setActiveRace(raceId);
  }, [raceId, activeRaceId, setActiveRace]);

  const mini = isLive || collapsed;
  const items = [
    { to: '/app', label: 'Dashboard', icon: <IconDash />, end: true },
    { to: rid ? `/app/race/${rid}/setup` : '/app', label: 'Race Setup', icon: <IconSetup /> },
    { to: rid ? `/app/race/${rid}/strategy` : '/app', label: 'Strategy', icon: <IconStrategy /> },
    { to: rid ? `/app/race/${rid}/live` : '/app', label: 'Live Race', icon: <IconLive />, live: true },
    { to: rid ? `/app/race/${rid}/calls` : '/app', label: 'Calls', icon: <IconCalls /> },
    { to: rid ? `/app/race/${rid}/data` : '/app', label: 'Data', icon: <IconData /> },
    { to: rid ? `/app/race/${rid}/analysis` : '/app', label: 'Analysis', icon: <IconAnalysis /> },
    { to: '/app/settings', label: 'Settings', icon: <IconSettings /> },
  ];

  return (
    <div className={`shell ${mini ? 'mini' : ''}`}>
      <aside className="sidebar">
        <button className="brand" onClick={() => nav('/')} title="STINT — home">
          <Logo size={mini ? 16 : 18} word={!mini} />
        </button>
        {!mini && race && (
          <div className="side-race" title={race.params.name}>
            <div className="label">Active race</div>
            <div className="ellipsis t2" style={{ fontWeight: 500 }}>
              {race.params.name}
            </div>
            <div className="row mt-4">
              <RaceStatusBadge status={race.status} size="sm" />
              {race.sample && <span className="badge sample sm">Sample</span>}
            </div>
          </div>
        )}
        <nav className="nav">
          {items.map((it) => (
            <NavLink key={it.label} to={it.to} end={it.end} className={({ isActive }) => `nav-i ${isActive ? 'on' : ''} ${it.live ? 'nav-live' : ''}`} title={it.label}>
              <span className="nav-ic">{it.icon}</span>
              <span className="nav-t">{it.label}</span>
              {it.live && race?.status === 'LIVE' && <span className="live-dot" />}
            </NavLink>
          ))}
        </nav>
        {!isLive && (
          <button className="btn ghost sm collapse" onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
            {collapsed ? <IconChevronRight size={14} /> : <IconChevronLeft size={14} />}
          </button>
        )}
      </aside>
      <main className="main">
        <Outlet />
      </main>
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

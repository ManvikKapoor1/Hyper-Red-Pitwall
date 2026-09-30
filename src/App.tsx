import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AnalysisPage } from './pages/Analysis';
import { CallsPage } from './pages/Calls';
import { DashboardPage } from './pages/Dashboard';
import { DataPage } from './pages/Data';
import { LandingPage } from './pages/Landing';
import { LiveRacePage } from './pages/LiveRace';
import { RaceSetupPage } from './pages/RaceSetup';
import { SettingsPage } from './pages/Settings';
import { StrategyPage } from './pages/strategy/StrategyPage';
import { useStore } from './store/store';

export function App() {
  const hydrated = useStore((s) => s.seeded);
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<AppShell />}>
          <Route index element={hydrated ? <DashboardPage /> : <Loading />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="race/:raceId/setup" element={<RaceSetupPage />} />
          <Route path="race/:raceId/strategy" element={<StrategyPage />} />
          <Route path="race/:raceId/strategy/:tab" element={<StrategyPage />} />
          <Route path="race/:raceId/live" element={<LiveRacePage />} />
          <Route path="race/:raceId/calls" element={<CallsPage />} />
          <Route path="race/:raceId/data" element={<DataPage />} />
          <Route path="race/:raceId/analysis" element={<AnalysisPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}

function Loading() {
  return <div className="empty">Loading sample data…</div>;
}

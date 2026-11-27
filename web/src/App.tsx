import { NavLink, Route, Routes } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from './stores/session';
import Dashboard from './pages/Dashboard';
import ScanPage from './pages/ScanPage';
import ContainersPage from './pages/ContainersPage';
import FinishPage from './pages/FinishPage';
import SearchPage from './pages/SearchPage';
import PrintCenter from './pages/PrintCenter';
import PrintDocument from './pages/PrintDocument';
import DemoPanel from './pages/DemoPanel';
import ReviewPage from './pages/ReviewPage';
import HandoverPage from './pages/HandoverPage';
import TripPicker from './TripPicker';
import TripPlanPage from './pages/TripPlanPage';
import { currentTripId, selectApiTrip } from './api/client';

function ToastHost() {
  const toast = useSession((s) => s.toast);
  const clear = useSession((s) => s.clearToast);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.type}`} role="status" onClick={clear}>
      <div style={{ fontWeight: 700 }}>{toast.title}</div>
      {toast.message && <div className="muted" style={{ marginTop: 4 }}>{toast.message}</div>}
      {toast.hint && (
        <div style={{ marginTop: 6, fontSize: 13, color: 'var(--accent)' }}>{toast.hint}</div>
      )}
    </div>
  );
}

export default function App() {
  const refreshStats = useSession((s) => s.refreshStats);
  const refreshContainers = useSession((s) => s.refreshContainers);
  const clearTripView = useSession((s) => s.clearTripView);
  const [tripId, setTripId] = useState(currentTripId);
  const selectTrip = useCallback((id: string) => {
    if (id === currentTripId()) return;
    selectApiTrip(id);
    clearTripView();
    setTripId(id);
  }, [clearTripView]);

  useEffect(() => {
    refreshStats();
    refreshContainers();
    const t = setInterval(() => {
      refreshStats();
      refreshContainers();
    }, 8000);
    return () => clearInterval(t);
  }, [refreshStats, refreshContainers, tripId]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="logo">
          Исходящая почта · ОПС 114000
        </div>
        <nav>
          <NavLink to="/" end>
            Рабочий стол
          </NavLink>
          <NavLink to="/scan">Сборка</NavLink>
          <NavLink to="/review">Разбор</NavLink>
          <NavLink to="/containers">Ёмкости</NavLink>
          <NavLink to="/finish">Завершение</NavLink>
          <NavLink to="/search">Поиск</NavLink>
          <NavLink to="/print">Печать</NavLink>
          <NavLink to="/demo">Демо</NavLink>
        </nav>
        <div className="app-header-note">
          Хакатон · синтетические данные
        </div>
      </header>

      <main className="app-main">
        <TripPicker selected={tripId} onSelect={selectTrip} />
        <Routes key={tripId}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/trip-plan" element={<TripPlanPage />} />
          <Route path="/containers" element={<ContainersPage />} />
          <Route path="/finish" element={<FinishPage />} />
          <Route path="/finish/:id/handover" element={<HandoverPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/print" element={<PrintCenter />} />
          <Route path="/print/:type/:id" element={<PrintDocument />} />
          <Route path="/demo" element={<DemoPanel />} />
        </Routes>
      </main>

      <footer className="app-footer">
        Все персональные данные и адреса вымышленные, созданы для хакатона. Не являются реальными ПДн.
      </footer>
      <ToastHost />
    </div>
  );
}

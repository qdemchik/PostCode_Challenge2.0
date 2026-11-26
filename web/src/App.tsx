import { NavLink, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import { useSession } from './stores/session';
import Dashboard from './pages/Dashboard';
import ScanPage from './pages/ScanPage';
import ContainersPage from './pages/ContainersPage';
import FinishPage from './pages/FinishPage';
import SearchPage from './pages/SearchPage';
import PrintCenter from './pages/PrintCenter';
import DemoPanel from './pages/DemoPanel';

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

  useEffect(() => {
    refreshStats();
    refreshContainers();
    const t = setInterval(() => {
      refreshStats();
      refreshContainers();
    }, 8000);
    return () => clearInterval(t);
  }, [refreshStats, refreshContainers]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="logo">
          <span className="logo-mark">П</span>
          Исходящая почта · ОПС 114000
        </div>
        <nav>
          <NavLink to="/" end>
            Рабочий стол
          </NavLink>
          <NavLink to="/scan">Сборка</NavLink>
          <NavLink to="/containers">Ёмкости</NavLink>
          <NavLink to="/finish">Завершение</NavLink>
          <NavLink to="/search">Поиск</NavLink>
          <NavLink to="/print">Печать</NavLink>
          <NavLink to="/demo">Демо</NavLink>
        </nav>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-secondary)' }}>
          Хакатон · синтетические данные
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/scan" element={<ScanPage />} />
          <Route path="/containers" element={<ContainersPage />} />
          <Route path="/finish" element={<FinishPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/print" element={<PrintCenter />} />
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

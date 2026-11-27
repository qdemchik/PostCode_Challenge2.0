import { Link } from 'react-router-dom';
import { useSession } from '../stores/session';
import { api } from '../api/client';
import { useState } from 'react';

export default function Dashboard() {
  const stats = useSession((s) => s.stats);
  const refreshStats = useSession((s) => s.refreshStats);
  const refreshContainers = useSession((s) => s.refreshContainers);
  const showToast = useSession((s) => s.showToast);
  const [busy, setBusy] = useState(false);

  const remaining = stats
    ? Math.max(0, (stats.eligible || 0) - (stats.placed || 0))
    : 0;

  const runPreAssign = async () => {
    setBusy(true);
    try {
      const res = await api.preAssign();
      showToast({
        type: 'success',
        title: 'Pre-assignment выполнен',
        message: `Создано ёмкостей: ${res.containersCreated}, назначено отправлений: ${res.assigned}`,
      });
      await refreshStats();
      await refreshContainers();
    } catch (e: any) {
      showToast({ type: 'error', title: 'Ошибка', message: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <h1 style={{ margin: 0, fontSize: 24 }}>Исходящая почта сегодня</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            ОПС 114000 · автоматическая сборка ёмкостей по плану направлений
          </p>
        </div>
        <div className="flex">
          <button className="btn btn-ghost" onClick={runPreAssign} disabled={busy}>
            Pre-assign ёмкости
          </button>
          <Link to="/scan" className="btn btn-primary">
            Начать сборку
          </Link>
        </div>
      </div>

      <div className="grid-4">
        <div className="card">
          <div className="card-title">К отправке</div>
          <div className="stat-value">{stats?.eligible ?? '—'}</div>
          <div className="stat-label">eligible отправлений</div>
        </div>
        <div className="card">
          <div className="card-title">Вложено</div>
          <div className="stat-value">
            {stats?.placed ?? '—'}
          </div>
          <div className="stat-label">в ёмкости</div>
        </div>
        <div className="card">
          <div className="card-title">Осталось</div>
          <div className="stat-value">
            {remaining}
          </div>
          <div className="stat-label">ещё отсканировать</div>
        </div>
        <div className="card">
          <div className="card-title">Ёмкости</div>
          <div className="stat-value">
            {stats ? `${stats.containersOpen}/${stats.containersClosed}` : '—'}
          </div>
          <div className="stat-label">открыто / закрыто</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Статусы отправлений</div>
          <table className="table">
            <tbody>
              <tr>
                <td>Ожидают</td>
                <td className="mono">{stats?.pending ?? 0}</td>
              </tr>
              <tr>
                <td>Найдены / проверены</td>
                <td className="mono">
                  {(stats?.found || 0) + (stats?.verified || 0)}
                </td>
              </tr>
              <tr>
                <td>Вложены</td>
                <td className="mono status-placed">{stats?.placed ?? 0}</td>
              </tr>
              <tr>
                <td>Ошибки</td>
                <td className="mono status-error">{stats?.error ?? 0}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-title">Быстрые действия</div>
          <div className="stack">
            <Link to="/scan" className="btn btn-primary">
              Экран сборки (скан)
            </Link>
            <Link to="/containers" className="btn btn-ghost">
              Управление ёмкостями
            </Link>
            <Link to="/finish" className="btn btn-ghost">
              Формирование накладных ф.23а
            </Link>
            <Link to="/search" className="btn btn-ghost">
              Поиск и повторная печать
            </Link>
            <button
              className="btn btn-ghost"
              onClick={() => {
                refreshStats();
                refreshContainers();
                showToast({ type: 'info', title: 'Данные обновлены' });
              }}
            >
              Обновить сводку
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <strong>Гипотеза pre-assignment:</strong> при загрузке (или по кнопке) система заранее
        создаёт ёмкости по направлениям и присваивает отправлениям{' '}
        <code>preAssignedContainerId</code>. Оператор сканирует — система сразу вкладывает в
        нужную ёмкость (1 действие вместо выбора). Это сокращает клики и снижает ошибки
        направления.
      </div>
    </div>
  );
}

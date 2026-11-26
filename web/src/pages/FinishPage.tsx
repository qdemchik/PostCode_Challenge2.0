import { useState } from 'react';
import { api } from '../api/client';
import { useSession } from '../stores/session';

export default function FinishPage() {
  const stats = useSession((s) => s.stats);
  const showToast = useSession((s) => s.showToast);
  const refreshStats = useSession((s) => s.refreshStats);
  const [waybills, setWaybills] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const formWaybills = async () => {
    setBusy(true);
    try {
      const res = await api.createWaybills();
      if (!res.ok) {
        showToast({
          type: 'error',
          title: res.errorCode || 'Ошибка',
          message: res.message,
          hint: res.actionHint,
        });
      } else {
        setWaybills(res.waybills || []);
        showToast({
          type: 'success',
          title: 'Накладные сформированы',
          message: `Создано: ${(res.waybills || []).length}`,
        });
        await refreshStats();
      }
    } catch (e: any) {
      showToast({ type: 'error', title: 'Ошибка', message: e.message });
    } finally {
      setBusy(false);
    }
  };

  const printWaybill = async (id: string) => {
    try {
      await api.print('waybill', id);
      showToast({ type: 'success', title: 'Накладная напечатана', message: id });
      const list = await api.waybills();
      setWaybills(list.items);
      await refreshStats();
    } catch (e: any) {
      showToast({
        type: 'error',
        title: 'Ошибка печати',
        message: e.message,
        hint: e.actionHint,
      });
    }
  };

  const closed = stats?.containersClosed ?? 0;
  const open = stats?.containersOpen ?? 0;

  return (
    <div className="stack">
      <h1 style={{ margin: 0, fontSize: 22 }}>Завершение · накладные ф.23а</h1>
      <p className="muted">Закройте все ёмкости, сформируйте и напечатайте накладные, отметьте готовность к вывозу.</p>

      <div className="grid-3">
        <div className="card">
          <div className="card-title">Открытые ёмкости</div>
          <div className="stat-value" style={{ color: open ? 'var(--warning)' : 'var(--success)' }}>
            {open}
          </div>
        </div>
        <div className="card">
          <div className="card-title">Закрытые ёмкости</div>
          <div className="stat-value">{closed}</div>
        </div>
        <div className="card">
          <div className="card-title">Накладные</div>
          <div className="stat-value">{stats?.waybills ?? waybills.length}</div>
        </div>
      </div>

      <div className="card mt-4">
        <div className="flex-between">
          <div>
            <div className="card-title">Чек-лист готовности к вывозу</div>
            <ul style={{ margin: '8px 0', paddingLeft: 18, color: 'var(--text-secondary)' }}>
              <li>Все нужные отправления вложены</li>
              <li>Все ёмкости закрыты</li>
              <li>Ярлыки напечатаны и закреплены</li>
              <li>Накладные ф.23а сформированы и напечатаны</li>
            </ul>
          </div>
          <button className="btn btn-primary btn-xl" disabled={busy || closed === 0} onClick={formWaybills}>
            {busy ? 'Формирование…' : 'Сформировать ф.23а'}
          </button>
        </div>
      </div>

      {waybills.length > 0 && (
        <div className="card mt-4">
          <div className="card-title">Сформированные накладные</div>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Направление</th>
                <th>Ёмкостей</th>
                <th>Отправлений</th>
                <th>Вес</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {waybills.map((w) => (
                <tr key={w.id}>
                  <td className="mono">{w.id}</td>
                  <td className="mono">{w.directionId}</td>
                  <td>{w.totalContainers}</td>
                  <td>{w.totalShipments}</td>
                  <td>{w.totalWeightGrams} г</td>
                  <td>
                    <span className={`badge badge-${w.status === 'printed' ? 'success' : 'accent'}`}>
                      {w.status}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-ghost" onClick={() => printWaybill(w.id)}>
                      Печать
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

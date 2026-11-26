import { useState } from 'react';
import { api } from '../api/client';
import { useSession } from '../stores/session';

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [result, setResult] = useState<any>(null);
  const showToast = useSession((s) => s.showToast);

  const search = async () => {
    if (!q.trim()) return;
    try {
      const res = await api.search(q.trim());
      setResult(res);
    } catch (e: any) {
      showToast({ type: 'error', title: 'Ошибка поиска', message: e.message });
    }
  };

  const reprintLabel = async (id: string) => {
    try {
      await api.print('label', id);
      showToast({ type: 'success', title: 'Повторная печать ярлыка', message: id });
    } catch (e: any) {
      showToast({ type: 'error', title: 'Ошибка печати', message: e.message, hint: e.actionHint });
    }
  };

  const reprintWaybill = async (id: string) => {
    try {
      await api.print('waybill', id);
      showToast({ type: 'success', title: 'Повторная печать накладной', message: id });
    } catch (e: any) {
      showToast({ type: 'error', title: 'Ошибка печати', message: e.message, hint: e.actionHint });
    }
  };

  return (
    <div className="stack">
      <h1 style={{ margin: 0, fontSize: 22 }}>Поиск и история</h1>
      <div className="card">
        <div className="flex">
          <input
            className="scan-field"
            style={{ height: 44, fontSize: 16 }}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="ШПИ, ID ёмкости/накладной, ФИО, индекс…"
          />
          <button className="btn btn-primary" onClick={search}>
            Найти
          </button>
        </div>
      </div>

      {result && (
        <>
          <div className="card">
            <div className="card-title">Отправления ({result.shipments?.length || 0})</div>
            <table className="table">
              <thead>
                <tr>
                  <th>ШПИ</th>
                  <th>Вид</th>
                  <th>Статус</th>
                  <th>Ёмкость</th>
                </tr>
              </thead>
              <tbody>
                {(result.shipments || []).map((s: any) => (
                  <tr key={s.barcode}>
                    <td className="mono">{s.barcode}</td>
                    <td>{s.kind}</td>
                    <td>{s.status}</td>
                    <td className="mono">{s.containerId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="card-title">Ёмкости ({result.containers?.length || 0})</div>
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Направление</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(result.containers || []).map((c: any) => (
                  <tr key={c.id}>
                    <td className="mono">{c.id}</td>
                    <td className="mono">{c.directionId}</td>
                    <td>{c.status}</td>
                    <td>
                      <button className="btn btn-ghost" onClick={() => reprintLabel(c.id)}>
                        Ярлык
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="card-title">Накладные ({result.waybills?.length || 0})</div>
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Направление</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(result.waybills || []).map((w: any) => (
                  <tr key={w.id}>
                    <td className="mono">{w.id}</td>
                    <td className="mono">{w.directionId}</td>
                    <td>{w.status}</td>
                    <td>
                      <button className="btn btn-ghost" onClick={() => reprintWaybill(w.id)}>
                        Печать
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

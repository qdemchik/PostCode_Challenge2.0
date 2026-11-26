import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useSession } from '../stores/session';

export default function ContainersPage() {
  const containers = useSession((s) => s.containers);
  const refresh = useSession((s) => s.refreshContainers);
  const showToast = useSession((s) => s.showToast);
  const [selected, setSelected] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadDetail = async (id: string) => {
    try {
      const d = await api.getContainer(id);
      setDetail(d);
      setSelected(id);
    } catch (e: any) {
      showToast({ type: 'error', title: 'Ошибка', message: e.message });
    }
  };

  const close = async (id: string) => {
    try {
      await api.closeContainer(id);
      showToast({ type: 'success', title: 'Ёмкость закрыта', message: id });
      await refresh();
      if (selected === id) loadDetail(id);
    } catch (e: any) {
      showToast({ type: 'error', title: e.code || 'Ошибка', message: e.message, hint: e.actionHint });
    }
  };

  const reopen = async (id: string) => {
    try {
      await api.reopenContainer(id);
      showToast({ type: 'info', title: 'Ёмкость открыта', message: id });
      await refresh();
      if (selected === id) loadDetail(id);
    } catch (e: any) {
      showToast({ type: 'error', title: 'Ошибка', message: e.message });
    }
  };

  const printLabel = async (id: string) => {
    try {
      await api.print('label', id);
      showToast({ type: 'success', title: 'Ярлык отправлен на печать', message: id });
      await refresh();
    } catch (e: any) {
      showToast({
        type: 'error',
        title: 'Ошибка печати',
        message: e.message,
        hint: e.actionHint || 'Можно сохранить PDF или повторить в Центре печати',
      });
    }
  };

  return (
    <div className="stack">
      <div className="flex-between">
        <h1 style={{ margin: 0, fontSize: 22 }}>Ёмкости</h1>
        <button className="btn btn-ghost" onClick={() => refresh()}>
          Обновить
        </button>
      </div>

      <div className="grid-2">
        <div className="card" style={{ maxHeight: 520, overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Напр.</th>
                <th>Влож.</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => (
                <tr
                  key={c.id}
                  style={{ cursor: 'pointer', background: selected === c.id ? 'var(--accent-muted)' : undefined }}
                  onClick={() => loadDetail(c.id)}
                >
                  <td className="mono">{c.id}</td>
                  <td className="mono">{c.directionId}</td>
                  <td>{c.shipmentIds?.length ?? 0}</td>
                  <td>
                    <span className={`badge badge-${c.status === 'closed' ? 'success' : 'accent'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td>
                    {c.labelPrinted && <span className="badge badge-success">ярлык</span>}
                  </td>
                </tr>
              ))}
              {containers.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Нет ёмкостей. Выполните pre-assign или начните сканирование.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">Карточка ёмкости</div>
          {!detail ? (
            <p className="muted">Выберите ёмкость слева</p>
          ) : (
            <div className="stack">
              <div className="mono" style={{ fontSize: 16 }}>
                {detail.id}
              </div>
              <div>
                {detail.kind} · {detail.category} · {detail.packagingModel}
              </div>
              <div className="muted">
                Направление {detail.directionId} · накладная {detail.waybillDirectionId}
              </div>
              <div>
                Масса: {detail.totalWeightGrams} г (тара {detail.tareWeightGrams}) / макс.{' '}
                {detail.maxWeightGrams} г
              </div>
              <div>
                Отметки:{' '}
                {(detail.marks || []).map((m: string) => (
                  <span key={m} className="badge" style={{ marginRight: 4 }}>
                    {m}
                  </span>
                ))}
              </div>
              <div className="flex">
                {detail.status === 'open' ? (
                  <button className="btn btn-primary" onClick={() => close(detail.id)}>
                    Закрыть ёмкость
                  </button>
                ) : (
                  <button className="btn btn-ghost" onClick={() => reopen(detail.id)}>
                    Открыть снова
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => printLabel(detail.id)}>
                  Печать ярлыка
                </button>
              </div>
              <div className="card-title mt-4">Состав ({detail.shipments?.length || 0})</div>
              <div style={{ maxHeight: 220, overflow: 'auto' }}>
                <table className="table">
                  <tbody>
                    {(detail.shipments || []).map((s: any) => (
                      <tr key={s.barcode}>
                        <td className="mono">{s.barcode}</td>
                        <td>{s.kind}</td>
                        <td>{s.weightGrams} г</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

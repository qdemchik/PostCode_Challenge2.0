import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AuditEntry, ReviewReason } from '../../../server/src/types/index';
import { api } from '../api/client';
import { useSession } from '../stores/session';
import { reviewLabels } from './ReviewPage';

const actionLabels: Record<string, string> = {
  found: 'Отправление найдено', verified: 'Данные проверены', field_edit: 'Данные исправлены',
  placed: 'Вложено', transferred: 'Переложено', removed_from_container: 'Извлечено',
  review_deferred: 'Отложено на разбор', review_resolved: 'Разбор завершён',
};
const fieldLabels: Record<string, string> = {
  recipientName: 'Получатель', address: 'Адрес', city: 'Населённый пункт', destinationIndex: 'Индекс',
  weightGrams: 'Масса, г', notes: 'Примечание', category: 'Категория', method: 'Способ пересылки',
};

const displayValue = (value: unknown) => value == null || value === '' ? '—' : String(value);

function containerId(value: unknown) {
  return value && typeof value === 'object' && 'containerId' in value && typeof value.containerId === 'string'
    ? value.containerId : null;
}

function ShipmentHistory({ barcode, onClose }: { barcode: string; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api.audit(barcode).then(({ items }) => {
      if (active) setEntries(items.filter((item) => item.entityType === 'shipment'));
    }).catch((error: Error) => {
      if (active) setError(error.message);
    });
    return () => { active = false; };
  }, [barcode]);

  const containerLink = (id: string) => <Link className="mono" to={`/containers?id=${id}`}>{id}</Link>;
  return (
    <section className="card stack" aria-label="История отправления">
      <div className="flex-between">
        <h2 className="card-title">История · {barcode}</h2>
        <button className="btn btn-ghost" onClick={onClose}>Закрыть историю</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!entries && !error && <p role="status">Загрузка истории…</p>}
      {entries?.length === 0 && <p role="status">Для этого ШПИ пока нет событий.</p>}
      {!!entries?.length && (
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead><tr><th>Время (МСК)</th><th>Действие</th><th>Детали</th><th>Исполнитель</th></tr></thead>
            <tbody>
              {entries.map((entry) => {
                const from = containerId(entry.oldValue);
                const to = containerId(entry.newValue);
                const detail = entry.newValue as { reason?: ReviewReason; resolution?: string } | undefined;
                return (
                  <tr key={entry.id}>
                    <td>{new Date(entry.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</td>
                    <td>{actionLabels[entry.action] || entry.action}</td>
                    <td>
                      {entry.field && <>{fieldLabels[entry.field] ?? entry.field}: {displayValue(entry.oldValue)} → {displayValue(entry.newValue)}</>}
                      {from && containerLink(from)}{from && to && ' → '}{to && containerLink(to)}
                      {entry.action === 'review_deferred' && detail?.reason && reviewLabels[detail.reason]}
                      {entry.action === 'review_resolved' && (detail?.resolution === 'assigned' ? 'Вложено в ёмкость' : 'Снято с разбора')}
                    </td>
                    <td>{entry.userId === 'operator' ? 'Оператор' : entry.userId}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [date, setDate] = useState('');
  const [direction, setDirection] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [historyBarcode, setHistoryBarcode] = useState<string | null>(null);
  const showToast = useSession((s) => s.showToast);

  const search = async () => {
    if (busy || (!q.trim() && !date && !direction.trim())) return;
    setBusy(true);
    try {
      const res = await api.search({ q: q.trim(), date, direction: direction.trim() });
      setResult(res);
      setHistoryBarcode(null);
    } catch (e: any) {
      showToast({ type: 'error', title: 'Ошибка поиска', message: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h1 style={{ margin: 0, fontSize: 22 }}>Поиск и история</h1>
      <form className="card stack" onSubmit={(event) => {
        event.preventDefault();
        void search();
      }}>
        <div className="review-fields">
          <label>Идентификатор или реквизиты
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ШПИ, номер пломбы, ФИО…"
          />
          </label>
          <label>Дата создания (МСК)
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>Направление
            <input value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="108970" />
          </label>
        </div>
        <div className="flex">
          <button className="btn btn-primary" disabled={busy || (!q.trim() && !date && !direction.trim())}>
            {busy ? 'Поиск…' : 'Найти'}
          </button>
        </div>
      </form>

      {historyBarcode && <ShipmentHistory key={historyBarcode} barcode={historyBarcode} onClose={() => setHistoryBarcode(null)} />}
      {result && (
        <>
          {!result.shipments.length && !result.containers.length && !result.waybills.length && (
            <p role="status">По заданным условиям ничего не найдено.</p>
          )}
          <div className="card">
            <div className="card-title">Отправления ({result.shipments?.length || 0})</div>
            <table className="table">
              <thead>
                <tr>
                  <th>ШПИ</th>
                  <th>Вид</th>
                  <th>Статус</th>
                  <th>Ёмкость</th>
                  <th>История</th>
                </tr>
              </thead>
              <tbody>
                {(result.shipments || []).map((s: any) => (
                  <tr key={s.barcode}>
                    <td className="mono">{s.barcode}</td>
                    <td>{s.kind}</td>
                    <td>{s.status}</td>
                    <td className="mono">{s.containerId || '—'}</td>
                    <td><button className="btn btn-ghost" onClick={() => setHistoryBarcode(s.barcode)}>История</button></td>
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
                  <th>Создана</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(result.containers || []).map((c: any) => (
                  <tr key={c.id}>
                    <td className="mono">{c.id}</td>
                    <td className="mono">{c.directionId}</td>
                    <td>{new Date(c.createdAt).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</td>
                    <td>{c.status}</td>
                    <td>
                      {c.status === 'closed' && <Link className="btn btn-ghost" to={`/print/label/${c.id}`}>Ярлык</Link>}
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
                  <th>Создана</th>
                  <th>Статус</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(result.waybills || []).map((w: any) => (
                  <tr key={w.id}>
                    <td className="mono">{w.id}</td>
                    <td className="mono">{(w.directionIds ?? [w.directionId]).join(', ')}</td>
                    <td>{new Date(w.createdAt).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</td>
                    <td>{w.status}</td>
                    <td>
                      <Link className="btn btn-ghost" to={`/print/waybill/${w.id}`}>Открыть накладную</Link>
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

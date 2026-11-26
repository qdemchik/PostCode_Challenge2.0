import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ReviewItem, ReviewReason } from '../../../server/src/types/index';
import { api } from '../api/client';

export const reviewLabels: Record<ReviewReason, string> = {
  NOT_FOUND: 'Отправление не найдено',
  SOURCE_DOWN: 'Источник недоступен',
  ROUTE_NOT_FOUND: 'Нет подходящего направления',
  ROUTE_AMBIGUOUS: 'Несколько направлений по плану',
  OVERWEIGHT: 'Превышена допустимая масса',
  NOT_ELIGIBLE: 'Срок хранения требует проверки',
};

const timestamp = new Intl.DateTimeFormat('ru-RU', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow',
});

export default function ReviewPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      setItems((await api.reviewItems()).items);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось открыть очередь.');
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const dismiss = async (barcode: string) => {
    if (!window.confirm(`Снять ${barcode} с разбора? Запись останется в истории.`)) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api.dismissReview(barcode);
      setItems((current) => current.map((item) => item.barcode === barcode ? updated : item));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось снять запись с разбора.');
    } finally {
      setBusy(false);
    }
  };

  const active = items.filter((item) => !item.resolvedAt);
  const visible = showResolved ? items : active;

  return (
    <div className="stack">
      <div className="flex-between">
        <h1>Очередь разбора</h1>
        <Link className="btn btn-primary" to="/scan">К сборке</Link>
      </div>
      <div className="card stack">
        <div className="flex-between">
          <strong>Ожидают разбора: {active.length}</strong>
          <div className="flex">
            <label><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} /> Показать завершённые</label>
            <button className="btn btn-ghost" disabled={busy} onClick={() => void load()}>Обновить</button>
          </div>
        </div>
        {error && <p role="alert">{error}</p>}
        {busy && !items.length && <p role="status">Загрузка очереди…</p>}
        {!busy && !error && !visible.length && <p role="status">В очереди нет записей.</p>}
        {visible.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>ШПИ</th><th>Причина</th><th>Отложено (МСК)</th><th>Статус</th><th>Действия</th></tr></thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.barcode}>
                    <td className="mono">{item.barcode}</td>
                    <td>{reviewLabels[item.reason]}</td>
                    <td>{timestamp.format(new Date(item.deferredAt))}</td>
                    <td>{item.resolution === 'assigned' ? 'Вложено' : item.resolvedAt ? 'Снято с разбора' : 'Ожидает разбора'}</td>
                    <td>{!item.resolvedAt && (
                      <div className="flex">
                        <Link className="btn btn-ghost" to={`/scan?barcode=${encodeURIComponent(item.barcode)}`}>Вернуться к ШПИ</Link>
                        <button className="btn btn-ghost" disabled={busy} onClick={() => void dismiss(item.barcode)}>Снять с разбора</button>
                      </div>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

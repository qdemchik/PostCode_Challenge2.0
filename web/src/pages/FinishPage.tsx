import TripDeparture from '../TripDeparture';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DispatchSummary, DocumentStatus, ReviewReason, Waybill } from '../../../server/src/types/index';
import { api, currentTripId } from '../api/client';
import { useSession } from '../stores/session';
import { reviewLabels } from './ReviewPage';
import { printEvidenceLabel } from '../printEvidence';

const statusLabel: Record<DocumentStatus, string> = {
  formed: 'Сформирована',
  printed: 'Печать выполнена',
  ready_for_dispatch: 'Готово к вывозу',
  handed_over: 'Передано водителю',
  cancelled: 'Аннулирована',
  error: 'Ошибка',
};

function PendingList({ title, ids, href }: { title: string; ids: string[]; href: (id: string) => string }) {
  if (!ids.length) return <div>{title} · 0</div>;
  return (
    <details>
      <summary>{title} · {ids.length}</summary>
      <ul className="dispatch-items">
        {ids.map((id) => {
          const destination = href(id);
          return <li key={id}>{destination.startsWith('#')
            ? <a className="mono" href={destination}>{id}</a>
            : <Link className="mono" to={destination}>{id}</Link>}</li>;
        })}
      </ul>
    </details>
  );
}

export default function FinishPage() {
  const showToast = useSession((s) => s.showToast);
  const refreshStats = useSession((s) => s.refreshStats);
  const [waybills, setWaybills] = useState<Waybill[]>([]);
  const [summary, setSummary] = useState<DispatchSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [busy, setBusy] = useState(false);
  const [readyId, setReadyId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const available = summary?.undocumentedContainerIds ?? [];
  const selected = chosen === null ? available : available.filter((id) => chosen.includes(id));

  const reload = async () => {
    setLoading(true);
    setSummaryError('');
    try {
      const [nextSummary, documents] = await Promise.all([api.dispatchSummary(), api.waybills()]);
      setSummary(nextSummary);
      setWaybills(documents.items);
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : 'Не удалось загрузить сводку.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void reload(); }, []);

  const formWaybills = async () => {
    setBusy(true);
    try {
      const res = await api.createWaybills(selected);
      if (!res.ok) {
        showToast({
          type: 'error',
          title: res.errorCode || 'Ошибка',
          message: res.message,
          hint: res.actionHint,
        });
      } else {
        await reload();
        setChosen(null);
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

  const markReady = async (id: string) => {
    setReadyId(id);
    try {
      await api.markWaybillReady(id);
      await reload();
      showToast({ type: 'success', title: 'Готово к вывозу', message: id });
    } catch (error) {
      showToast({ type: 'error', title: 'Комплект ещё не готов', message: error instanceof Error ? error.message : undefined });
    } finally {
      setReadyId(null);
    }
  };

  const cancelWaybill = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!cancelling || !reason.trim() || cancelBusy || busy) return;
    setCancelBusy(true);
    try {
      await api.cancelWaybill(cancelling, reason.trim());
      setCancelling(null);
      setReason('');
      await reload();
      showToast({ type: 'info', title: 'Накладная аннулирована', message: 'Ёмкости снова доступны для оформления.' });
    } catch (error) {
      showToast({ type: 'error', title: 'Не удалось аннулировать накладную', message: error instanceof Error ? error.message : undefined });
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <div className="page-stack finish-page">
      <h1 style={{ margin: 0, fontSize: 22 }}>Завершение · накладные ф.23а</h1>
      <p className="muted">Закройте все ёмкости, сформируйте и напечатайте накладные, отметьте готовность к вывозу.</p>

      {summary?.tripPlan && <TripDeparture tripId={currentTripId()}
        remaining={summary.tripPlan.items.filter((item) => item.status !== 'packed').length} />}
      <section className="card stack" aria-label="Готовность к вывозу">
        <div className="flex-between">
          <h2 className="card-title">Сводка готовности к вывозу</h2>
          <button className="btn btn-ghost" disabled={loading || busy || readyId !== null} onClick={() => void reload()}>Обновить сводку</button>
        </div>
        {summaryError && <p role="alert">{summaryError}</p>}
        {loading && !summary && <p role="status">Загрузка сводки…</p>}
        {summary && (
          <div className="grid-2 container-layout finish-summary">
            <div className="stack">
              {summary.tripPlan && (
                <div className="stack">
                  <Link to="/trip-plan">План рейса · {summary.tripPlan.items.length}</Link>
                  <PendingList title="Ещё не вложены по плану"
                    ids={summary.tripPlan.items.filter((item) => item.status !== 'packed' && item.status !== 'review').map((item) => item.barcode)}
                    href={(barcode) => `/scan?barcode=${encodeURIComponent(barcode)}`} />
                  <PendingList title="На разборе по плану"
                    ids={summary.tripPlan.items.filter((item) => item.status === 'review').map((item) => item.barcode)}
                    href={(barcode) => `/scan?barcode=${encodeURIComponent(barcode)}`} />
                  <PendingList title="Вложены вне плана" ids={summary.tripPlan.outsidePlanBarcodes} href={() => '/trip-plan'} />
                </div>
              )}
              <PendingList title="Общий список отправлений, доступных для сборки" ids={summary.waitingBarcodes}
                href={(barcode) => `/scan?barcode=${encodeURIComponent(barcode)}`} />
              <div>
                <Link to="/review">На разборе</Link> · {Object.values(summary.reviewCounts).reduce((sum, count) => sum + count, 0)}
                {Object.entries(summary.reviewCounts).map(([reason, count]) => (
                  <div className="muted" key={reason}>{reviewLabels[reason as ReviewReason]} · {count}</div>
                ))}
              </div>
              <PendingList title="Открытые ёмкости с вложениями" ids={summary.openContainerIds}
                href={(id) => `/containers?id=${id}`} />
            </div>
            <div className="stack">
              <PendingList title="Закрытые ёмкости без печати ярлыка" ids={summary.unprintedLabelIds}
                href={(id) => `/print/label/${id}`} />
              <PendingList title="Закрытые ёмкости вне ф.23а" ids={summary.undocumentedContainerIds}
                href={(id) => `/containers?id=${id}`} />
              <PendingList title="Накладные без печати" ids={summary.unprintedWaybillIds}
                href={(id) => `/print/waybill/${id}`} />
              <PendingList title="Ожидают подтверждения готовности" ids={summary.unconfirmedWaybillIds}
                href={(id) => `#waybill-${id}`} />
            </div>
          </div>
        )}
        <div className="stack">
          {!!available.length && (
            <details>
              <summary>Ёмкости для ф.23а · выбрано {selected.length} из {available.length}</summary>
              <ul className="dispatch-items">
                {available.map((id) => (
                  <li key={id}>
                    <label>
                      <input type="checkbox" checked={selected.includes(id)} disabled={busy || loading}
                        onChange={(event) => setChosen(event.target.checked ? [...selected, id] : selected.filter((value) => value !== id))} />
                      <span className="mono"> {id}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div><button className="btn btn-primary" disabled={busy || loading || cancelBusy || !selected.length}
            aria-describedby={summary && !selected.length ? 'waybill-formation-hint' : undefined}
            onClick={formWaybills}>{busy ? 'Формирование…' : 'Сформировать ф.23а'}</button></div>
          {summary && !selected.length && (
            <p id="waybill-formation-hint" className="muted">
              {available.length
                ? 'Выберите хотя бы одну ёмкость в списке выше.'
                : summary.openContainerIds.length
                  ? <>Сначала закройте ёмкость с вложениями. <Link to={`/containers?id=${summary.openContainerIds[0]}`}>Открыть ёмкость</Link></>
                  : 'Для новой ф.23а нужна закрытая ёмкость с вложениями, ещё не включённая в накладную.'}
            </p>
          )}
        </div>
      </section>
      {cancelling && (
        <form className="card stack" onSubmit={cancelWaybill}>
          <h2 className="card-title">Аннулировать ф.23а № {cancelling}</h2>
          <p>Ёмкости можно открыть для исправления и включить в новую накладную.</p>
          <div className="review-fields">
            <label>Причина
              <input value={reason} autoFocus maxLength={250} required disabled={cancelBusy}
                onChange={(event) => setReason(event.target.value)} />
            </label>
          </div>
          <div className="flex">
            <button className="btn btn-danger" disabled={cancelBusy || !reason.trim()}>Подтвердить аннулирование</button>
            <button className="btn btn-ghost" type="button" disabled={cancelBusy} onClick={() => setCancelling(null)}>Оставить накладную</button>
          </div>
        </form>
      )}

      {waybills.length > 0 && (
        <div className="card table-scroll">
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
                <tr key={w.id} id={`waybill-${w.id}`}>
                  <td className="mono">{w.id}</td>
                  <td className="mono">{(w.directionIds ?? [w.directionId]).join(', ')}</td>
                  <td>{w.totalContainers}</td>
                  <td>{w.totalShipments}</td>
                  <td>{w.totalWeightGrams} г</td>
                  <td>
                    <span className={`badge badge-${w.status === 'ready_for_dispatch' || w.status === 'printed' || w.status === 'handed_over' ? 'success' : 'accent'}`}>
                      {statusLabel[w.status]}
                    </span>
                      {w.status !== 'cancelled' && <div className="muted">{printEvidenceLabel(w.printEvidence, !!w.printedAt)}</div>}
                      {w.cancellation && <div className="muted">{w.cancellation.reason}</div>}
                  </td>
                  <td>
                    <Link className="btn btn-ghost" to={`/print/waybill/${w.id}`}>Открыть накладную</Link>
                    {(w.status === 'ready_for_dispatch' || w.status === 'handed_over') ? (
                      <Link className="btn btn-ghost" to={`/finish/${w.id}/handover`}>
                        {w.status === 'handed_over' ? 'Состав передачи' : 'Сверить и передать'}
                      </Link>
                    ) : w.status !== 'cancelled' && (
                      <button className="btn btn-ghost" disabled={readyId !== null || busy} onClick={() => void markReady(w.id)}>
                        Подтвердить готовность
                      </button>
                    )}
                    {w.status !== 'cancelled' && w.status !== 'handed_over' && (
                      <button className="btn btn-ghost" disabled={cancelBusy || busy || readyId !== null}
                        onClick={() => { setReason(''); setCancelling(w.id); }}>Аннулировать</button>
                    )}
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

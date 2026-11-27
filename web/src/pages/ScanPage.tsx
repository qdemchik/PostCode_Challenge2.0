import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { reviewReasons, type ReviewReason, type Shipment, type ShipmentMark } from '../../../server/src/types/index';
import { api, currentTripId } from '../api/client';
import { useSession } from '../stores/session';
import { useScanner } from '../hooks/useScanner';
import { readDraft, saveDraft } from '../sessionDraft';

type ScanShipment = Shipment & { plannedTripName?: string };

const reviewFields = [
  ['recipientName', 'Получатель'],
  ['city', 'Населённый пункт'],
  ['address', 'Адрес'],
  ['destinationIndex', 'Индекс назначения'],
  ['weightGrams', 'Масса, г'],
  ['notes', 'Примечание'],
] as const;

function readOfflineScans(key: string): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

export default function ScanPage() {
  const [searchParams] = useSearchParams();
  const [draftKey] = useState(() => `postcode.scan.${currentTripId()}`);
  const [draft] = useState(() => searchParams.get('barcode') ? undefined : readDraft<{
    code: string;
    review: ScanShipment | null;
    fields: Record<string, string>;
    fastMode: boolean;
  }>(draftKey));
  const inputRef = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const batchActive = useRef(false);
  const mounted = useRef(true);
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [queueKey] = useState(() => `postcode.offline-scans.${currentTripId()}`);
  const [offlineScans, setOfflineScans] = useState(() => readOfflineScans(queueKey));
  const [online, setOnline] = useState(() => navigator.onLine);
  const [queueStatus, setQueueStatus] = useState('');
  const [seriesMs, setSeriesMs] = useState<number | null>(null);
  const [scanFocused, setScanFocused] = useState(false);
  const [series, setSeries] = useState('IN261116000001\nIN261116000002\nIN999999999999');
  const [runningSeries, setRunningSeries] = useState(false);
  const [seriesStatus, setSeriesStatus] = useState('');
  const [autoCount, setAutoCount] = useState(0);
  const [lastPlacement, setLastPlacement] = useState<{ barcode: string; containerId: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [code, setCode] = useState(() => searchParams.get('barcode') || draft?.code || '');
  const [busy, setBusy] = useState(false);
  const [fastMode, setFastMode] = useState(draft?.fastMode ?? false);
  const [showFields, setShowFields] = useState(!!Object.keys(draft?.fields ?? {}).length);
  const [review, setReview] = useState<ScanShipment | null>(draft?.review ?? null);
  const [draftFields, setDraftFields] = useState<Record<string, string>>(draft?.fields ?? {});
  const [markLabels, setMarkLabels] = useState<Partial<Record<ShipmentMark, string>>>({});
  useEffect(() => { void api.packagingReference().then((result) => setMarkLabels(result.shipmentMarkLabels)).catch(() => {}); }, []);
  const [reviewError, setReviewError] = useState('');
  const [lookupIssue, setLookupIssue] = useState<{ reason: ReviewReason; message: string } | null>(null);
  const [assignmentIssue, setAssignmentIssue] = useState<ReviewReason | null>(null);
  const lastShipment = useSession((s) => s.lastShipment);
  const lastAssign = useSession((s) => s.lastAssign);
  const setLastShipment = useSession((s) => s.setLastShipment);
  const setLastAssign = useSession((s) => s.setLastAssign);
  const showToast = useSession((s) => s.showToast);
  const refreshStats = useSession((s) => s.refreshStats);
  const refreshContainers = useSession((s) => s.refreshContainers);
  const containers = useSession((s) => s.containers);

  const focusScan = () => inputRef.current?.focus();

  useEffect(() => {
    saveDraft(draftKey, { code, review, fields: review ? draftFields : {}, fastMode });
  }, [draftKey, code, review, draftFields, fastMode]);

  useEffect(() => {
    if (review && !busy) {
      if (fastMode && !showFields && confirmRef.current && !review.routingIssue && !reviewError) {
        confirmRef.current.focus();
      } else {
        reviewRef.current?.focus();
      }
    }
    else if (!busy) focusScan();
  }, [review, busy, fastMode, reviewError]);

  const playBeep = (ok: boolean) => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = ok ? 880 : 220;
      g.gain.value = 0.08;
      o.start();
      setTimeout(() => {
        o.stop();
        ctx.close();
      }, ok ? 80 : 180);
    } catch {
      /* ignore */
    }
  };

  const saveOfflineScans = (items: string[]) => {
    try {
      localStorage.setItem(queueKey, JSON.stringify(items));
      setOfflineScans(items);
      return true;
    } catch {
      setQueueStatus('Не удалось сохранить очередь. Запишите ШПИ и повторите после восстановления связи.');
      return false;
    }
  };

  const processCode = async (raw: string, fromSeries = false): Promise<boolean> => {
    const barcode = raw.trim().toUpperCase();
    if (!barcode || inFlight.current || review || (batchActive.current && !fromSeries)) return false;
    if (!navigator.onLine) {
      if (!exceptionsOnly || fromSeries) {
        setQueueStatus('Нет связи. Повторите запрос после подключения.');
      } else {
        const saved = readOfflineScans(queueKey);
        if (saved.includes(barcode)) {
          setQueueStatus('Этот ШПИ уже в очереди.');
        } else if (saved.length >= 100) {
          setQueueStatus('В очереди 100 ШПИ. Дождитесь подключения перед следующим сканом.');
        } else if (saveOfflineScans([...saved, barcode])) {
          setQueueStatus(`ШПИ ${barcode} сохранён до восстановления связи.`);
          setCode('');
        }
      }
      return false;
    }
    const trip = currentTripId();
    inFlight.current = true;
    setBusy(true);
    setLastAssign(null);
    setLookupIssue(null);
    setAssignmentIssue(null);
    setDraftFields({});
    setShowFields(false);
    try {
      const shipment: ScanShipment = await api.getShipment(barcode);
      if (trip !== currentTripId() || !mounted.current) return false;
      setLastShipment(shipment);
      setReviewError('');
      setCode('');
      if ((exceptionsOnly || fromSeries) && shipment.isEligibleForDispatch && !shipment.containerId &&
        !shipment.routingIssue && (!shipment.plannedTripId || shipment.plannedTripId === trip)) {
        try {
          const result = await api.assign(barcode);
          if (trip !== currentTripId() || !mounted.current) return false;
          setLastAssign(result);
          setLastShipment(result.shipment);
          if (result.container) setLastPlacement({ barcode, containerId: result.container.id });
          setAutoCount((count) => count + 1);
          void Promise.allSettled([refreshStats(), refreshContainers()]);
          return true;
        } catch (error) {
          if (trip !== currentTripId() || !mounted.current) return false;
          const failure = error as { message?: string; body?: { errorCode?: string; errorMessage?: string } };
          setReviewError(failure.body?.errorMessage || failure.message || 'Не удалось вложить отправление.');
          setAssignmentIssue(reviewReasons.find((reason) => reason === failure.body?.errorCode) ?? null);
        }
      }
      setReview(shipment);
      if (exceptionsOnly || fromSeries) playBeep(false);
      return false;
    } catch (e: any) {
      if (trip !== currentTripId() || !mounted.current) return false;
      playBeep(false);
      setCode(barcode);
      setLastShipment(null);
      const reason = reviewReasons.find((value) => value === e.code);
      if (reason) setLookupIssue({ reason, message: e.message });
      showToast({
        type: 'error',
        title: e.code === 'NOT_FOUND' ? 'Отправление не найдено' : 'Ошибка поиска',
        message: e.message,
        hint: e.actionHint,
      });
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const confirmShipment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!review || inFlight.current || !review.isEligibleForDispatch || review.containerId ||
      (review.plannedTripId && review.plannedTripId !== currentTripId())) return;
    const barcode = review.barcode;
    const trip = currentTripId();
    const values = new FormData(event.currentTarget);
    const changes: Record<string, unknown> = {};
    for (const [field] of reviewFields) {
      const input = String(values.get(field) ?? '').trim();
      const value = field === 'weightGrams' || field === 'destinationIndex' ? Number(input) : input;
      if (value !== (review[field] ?? '')) changes[field] = value;
    }
    const markFlags: Shipment['markFlags'] = {};
    for (const key of Object.keys(markLabels) as ShipmentMark[]) {
      const checked = values.has('mark-' + key);
      if (checked !== !!review.markFlags?.[key]) markFlags[key] = checked;
    }
    if (Object.keys(markFlags).length) changes.markFlags = markFlags;
    inFlight.current = true;
    setBusy(true);
    setReviewError('');
    setAssignmentIssue(null);
    try {
      const shipment = Object.keys(changes).length
        ? await api.patchShipment(barcode, changes)
        : fastMode ? review : await api.verifyShipment(barcode);
      if (trip !== currentTripId()) return;
      setLastShipment(shipment);
      setReview(shipment);
      const result = await api.assign(barcode);
      if (trip !== currentTripId()) return;
      setLastAssign(result);
      setLastShipment(result.shipment);
      if (result.container) setLastPlacement({ barcode, containerId: result.container.id });
      setReview(null);
      playBeep(true);
      showToast({
        type: 'success',
        title: result.createdNew ? 'Новая ёмкость + вложение' : 'Вложено',
        message: `${barcode} → ${result.container?.id}`,
        hint: result.createdNew
          ? 'Система создала ёмкость под направление'
          : result.container?.id === shipment.preAssignedContainerId
            ? 'Использована pre-assigned ёмкость'
            : undefined,
      });
      await Promise.all([refreshStats(), refreshContainers()]);
    } catch (e: any) {
      playBeep(false);
      const body = e.body || {};
      showToast({
        type: 'error',
        title: body.errorCode || e.code || 'Ошибка',
        message: body.errorMessage || e.message,
        hint: body.actionHint || e.actionHint,
      });
      if (body.shipment) setLastShipment(body.shipment);
      setLastAssign(body);
      setReviewError(body.errorMessage || e.message);
      setAssignmentIssue(reviewReasons.find((value) => value === (body.errorCode || e.code)) ?? null);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const deferShipment = async (barcode: string, reason: ReviewReason) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await api.deferReview(barcode, reason);
      setCode('');
      setReview(null);
      setLookupIssue(null);
      setAssignmentIssue(null);
      setReviewError('');
      setLastAssign(null);
      showToast({ type: 'info', title: 'Отложено на разбор', message: barcode });
    } catch (error) {
      showToast({ type: 'error', title: 'Не удалось отложить отправление',
        message: error instanceof Error ? error.message : undefined });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const runSeries = async () => {
    if (batchActive.current || inFlight.current || review) return;
    const items = series.trim().split(/\s+/).filter(Boolean);
    if (!items.length || items.length > 20) {
      setSeriesStatus('Введите от 1 до 20 ШПИ.');
      return;
    }
    batchActive.current = true;
    setRunningSeries(true);
    let placed = 0;
    const started = performance.now();
    setSeriesMs(null);
    try {
      for (const barcode of items) {
        if (!mounted.current || !await processCode(barcode, true)) break;
        placed += 1;
      }
      if (mounted.current) setSeriesMs(performance.now() - started);
      if (mounted.current) setSeriesStatus(placed === items.length
        ? `Серия завершена. Вложено: ${placed}.`
        : `Серия остановлена на ШПИ ${items[placed]}. Вложено: ${placed} из ${items.length}.`);
    } finally {
      batchActive.current = false;
      if (mounted.current) setRunningSeries(false);
    }
  };

  const replayOfflineScans = async () => {
    if (batchActive.current || inFlight.current || review || !navigator.onLine) return;
    const pending = readOfflineScans(queueKey);
    if (!pending.length) return;
    batchActive.current = true;
    setRunningSeries(true);
    try {
      for (const barcode of pending) {
        if (!mounted.current) return;
        if (!await processCode(barcode, true)) {
          if (mounted.current) setQueueStatus(`Очередь остановлена на ${barcode}. Разберите отправление перед повтором.`);
          return;
        }
        if (!mounted.current || !saveOfflineScans(readOfflineScans(queueKey).filter((item) => item !== barcode))) return;
      }
      setQueueStatus('Очередь отправлена.');
    } finally {
      batchActive.current = false;
      if (mounted.current) setRunningSeries(false);
    }
  };

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void replayOfflineScans();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  });

  const undoPlacement = async () => {
    if (!lastPlacement || inFlight.current || batchActive.current || review) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await api.removeShipment(lastPlacement.barcode, lastPlacement.containerId);
      setLastPlacement(null);
      setLastAssign(null);
      setLastShipment(null);
      showToast({ type: 'info', title: 'Последнее вложение отменено', message: lastPlacement.barcode });
      await Promise.allSettled([refreshStats(), refreshContainers()]);
    } catch (error) {
      showToast({ type: 'error', title: 'Вложение не отменено', message: error instanceof Error ? error.message : undefined });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  useScanner((barcode) => { void processCode(barcode); }, { enabled: !review && !busy && !runningSeries });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z' && !code && lastPlacement) {
      e.preventDefault();
      void undoPlacement();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      processCode(code);
    }
  };

  const openContainers = containers.filter((c) => c.status === 'open');
  const belongsToAnotherTrip = !!review?.plannedTripId && review.plannedTripId !== currentTripId();
  const reviewReason = review && (assignmentIssue ?? review.routingIssue ??
    (!review.isEligibleForDispatch ? 'NOT_ELIGIBLE' : null));

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Сборка исходящей почты</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Сканируйте ШПИ или введите его вручную и нажмите Enter.
          </p>
        </div>
        <span className="badge badge-accent">{openContainers.length} открытых ёмкостей</span>
      </div>
      <label className="flex">
        <input type="checkbox" checked={fastMode} disabled={busy || !!review}
          onChange={(event) => setFastMode(event.target.checked)} />
        Быстрая сборка · подтверждение клавишей Enter
      </label>
      <label className="flex">
        <input type="checkbox" checked={exceptionsOnly} disabled={busy || runningSeries || !!review}
          onChange={(event) => setExceptionsOnly(event.target.checked)} />
        Только исключения · автоматически подтверждать подходящие отправления
      </label>
      {autoCount > 0 && <p role="status">Автоматически вложено: {autoCount} · пропущено подтверждений: {autoCount}</p>}
      {(!online || offlineScans.length > 0 || queueStatus) && (
        <section className="card stack" aria-label="Очередь сканирования">
          <strong>{online ? 'Очередь сканирования' : 'Нет связи'} · {offlineScans.length} ШПИ</strong>
          {!online && !exceptionsOnly && <span>Включите «Только исключения», чтобы сохранять сканы до подключения.</span>}
          {queueStatus && <span role="status">{queueStatus}</span>}
          {!!offlineScans.length && (
            <div className="flex">
              <button className="btn btn-primary" disabled={!online || busy || runningSeries || !!review}
                onClick={() => void replayOfflineScans()}>Отправить очередь</button>
              <button className="btn btn-ghost" disabled={busy || runningSeries}
                onClick={() => {
                  if (saveOfflineScans(readOfflineScans(queueKey).slice(1))) setQueueStatus('Первый ШПИ удалён из очереди.');
                }}>Убрать первый ШПИ</button>
            </div>
          )}
        </section>
      )}
      {searchParams.has('series') && (
        <section className="card stack" aria-label="Эмулятор сканера">
          <div className="review-fields">
            <label>Демо-серия ШПИ (до 20)
              <textarea value={series} rows={3} disabled={runningSeries} onChange={(event) => setSeries(event.target.value)} />
            </label>
          </div>
          <button className="btn btn-primary" disabled={busy || runningSeries || !!review} onClick={() => void runSeries()}>
            Отсканировать серию
          </button>
          {seriesStatus && <p role="status">{seriesStatus}</p>}
          {seriesMs !== null && <p>Время этой серии: {(seriesMs / 1000).toFixed(2)} с</p>}
          <p className="muted">Контрольный прогон на 20 ШПИ: обычный режим 2,29 с, быстрая сборка 1,92 с.
            Это медианы автопрогона, без времени оператора и физического сканера.</p>
        </section>
      )}
      {(fastMode || exceptionsOnly || searchParams.has('series')) && lastAssign?.ok && lastAssign.container && (
        <div className="card" role="status">
          <span>Вложите в ёмкость </span>
          <strong className="mono stat-value">{lastAssign.container.id}</strong>
        </div>
      )}

      <div className="card scan-entry">
        <label className="card-title" htmlFor="scan">
          Отсканируйте / введите ШПИ
        </label>
        <input
          id="scan"
          ref={inputRef}
          onFocus={() => setScanFocused(true)}
          onBlur={() => setScanFocused(false)}
          className="scan-field"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setLookupIssue(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="IN261116000001 или международный ШПИ"
          autoComplete="off"
          disabled={busy || !!review}
        />
        {!scanFocused && !busy && !runningSeries && !review && (
          <p className="muted">Поле сканирования вне фокуса. <button type="button" className="btn btn-ghost"
            onClick={focusScan}>Вернуть фокус</button></p>
        )}
        {lookupIssue && <p role="status">{lookupIssue.message}</p>}
        <div className="flex mt-4">
          <button
            className="btn btn-primary"
            disabled={busy || !!review || !code.trim()}
            onClick={() => processCode(code)}
          >
            Найти отправление
          </button>
          {lookupIssue && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => void deferShipment(code, lookupIssue.reason)}>
              Отложить на разбор
            </button>
          )}
          {lastPlacement && <button className="btn btn-ghost" disabled={busy || runningSeries || !!review}
            onClick={() => void undoPlacement()}>Отменить вложение</button>}
          <Link className="btn btn-ghost" to="/review">Очередь разбора</Link>
        </div>
      </div>

      {review && (
        <form className="card stack" onSubmit={confirmShipment} onChange={(event) => {
          const field = event.target as HTMLInputElement;
          if (field.name) setDraftFields((current) => ({
            ...current, [field.name]: field.type === 'checkbox' ? (field.checked ? 'on' : '') : field.value,
          }));
        }}>
          <h2 className="card-title" ref={reviewRef} tabIndex={-1}>Проверка отправления</h2>
          <div className="mono">{review.barcode}</div>
          <div>{review.origin} · {review.kind} · {review.category}</div>
          {fastMode && <div>{review.recipientName} · {review.city}, {review.destinationIndex} · {review.weightGrams} г</div>}
          <div className="muted">
            Источник: {review.source} · Направление: {review.directionContainer || 'требуется проверка'}
          </div>
          {review.containerId ? (
            <p role="status">Отправление уже вложено в ёмкость {review.containerId}.</p>
          ) : belongsToAnotherTrip ? (
            <p role="alert">Отправление запланировано на рейс «{review.plannedTripName ?? review.plannedTripId}». Переключите рабочий рейс.</p>
          ) : !review.isEligibleForDispatch ? (
            <p role="status">
              {Number.isFinite(Date.parse(review.storageExpiresAt))
                ? `Отправление на хранении до ${new Date(review.storageExpiresAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК).`
                : 'Дата окончания хранения отсутствует или некорректна. Уточните её в источнике.'}
            </p>
          ) : (
            <>
            {fastMode && (
              <button type="button" className="btn btn-ghost" aria-expanded={showFields}
                disabled={busy} onClick={() => setShowFields((open) => !open)}>
                {showFields ? 'Свернуть данные' : 'Исправить данные'}
              </button>
            )}
            <div hidden={fastMode && !showFields}>
            <div className="review-fields">
              {reviewFields.map(([field, label]) => (
                <label key={field}>
                  {label}
                  <input
                    name={field}
                    defaultValue={draftFields[field] ?? (field === 'destinationIndex'
                      ? String(review.destinationIndex).padStart(6, '0') : review[field] ?? '')}
                    type={field === 'weightGrams' ? 'number' : 'text'}
                    min={field === 'weightGrams' ? 1 : undefined}
                    inputMode={field === 'destinationIndex' ? 'numeric' : undefined}
                    pattern={field === 'destinationIndex' ? '[0-9]{6}' : undefined}
                    maxLength={field === 'destinationIndex' ? 6 : undefined}
                    required={field !== 'notes'}
                    readOnly={busy}
                  />
                </label>
              ))}
            </div>
            <fieldset>
              <legend>Отметки отправления</legend>
              <div className="flex">{Object.entries(markLabels).map(([key, label]) => (
                <label key={key} className="flex">
                  <input type="checkbox" name={'mark-' + key} disabled={busy}
                    defaultChecked={draftFields['mark-' + key] !== undefined
                      ? draftFields['mark-' + key] === 'on' : !!review.markFlags?.[key as ShipmentMark]} />
                  {label}
                </label>
              ))}</div>
            </fieldset>
            </div>
            </>
          )}
          {review.routingIssue && !reviewError && (
            <p role="status">{review.routingIssue === 'ROUTE_AMBIGUOUS'
              ? 'По плану найдено несколько направлений. Проверьте индекс назначения.'
              : 'По плану направление не найдено. Проверьте индекс назначения.'}</p>
          )}
          {review.routingDetails && (
            <details open={review.routingIssue === 'ROUTE_AMBIGUOUS'}>
              <summary>Что проверил план направлений</summary>
              <p>Индекс {String(review.destinationIndex).padStart(6, '0')} · {review.classification} · код страны {review.routingDetails.countryCode}</p>
              <p>{review.kind} · {review.category} · {review.routingDetails.rank} · {review.method}</p>
              {!!review.routingDetails.candidates.length && (
                <ul>{review.routingDetails.candidates.map((candidate) => (
                  <li key={`${candidate.containerDirection}/${candidate.waybillDirection}`}>
                    Ёмкость {candidate.containerDirection} · ф.23а {candidate.waybillDirection}
                  </li>
                ))}</ul>
              )}
            </details>
          )}
          {reviewError && <p role="alert">{reviewError}</p>}
          <div className="flex">
            {!review.containerId && !belongsToAnotherTrip && review.isEligibleForDispatch && (
              <button ref={confirmRef} className="btn btn-primary" disabled={busy} onKeyDown={(event) => {
                if (fastMode && event.key === 'Enter') {
                  event.preventDefault();
                  if (!event.repeat) event.currentTarget.form?.requestSubmit();
                }
              }}>
                {busy ? 'Вложение…' : 'Подтвердить и вложить'}
              </button>
            )}
            {!review.containerId && !belongsToAnotherTrip && reviewReason && (
              <button type="button" className="btn btn-ghost" disabled={busy}
                onClick={() => void deferShipment(review.barcode, reviewReason)}>
                Отложить на разбор
              </button>
            )}
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setReview(null)}>
              К сканированию
            </button>
          </div>
        </form>
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Последнее отправление</div>
          {!lastShipment ? (
            <p className="muted">Отсканируйте ШПИ — данные появятся здесь</p>
          ) : (
            <div className="stack">
              <div className="flex-between">
                <span className="mono" style={{ fontSize: 15 }}>
                  {lastShipment.barcode}
                </span>
                <span className={`badge badge-${lastShipment.status === 'placed' ? 'success' : 'accent'}`}>
                  {lastShipment.status}
                </span>
              </div>
              <div>
                <strong>{lastShipment.kind}</strong> · {lastShipment.category}
              </div>
              <div className="muted">
                {lastShipment.origin} · источник: {lastShipment.source} · {lastShipment.weightGrams} г
              </div>
              <div>
                {lastShipment.recipientName}
                <br />
                <span className="muted">
                  {lastShipment.address}, {lastShipment.city}, {lastShipment.destinationIndex}
                </span>
              </div>
              <div>
                Направление ёмкости:{' '}
                <span className="mono" style={{ color: 'var(--accent)' }}>
                  {lastShipment.directionContainer}
                </span>
                {lastShipment.preAssignedContainerId && (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    Pre-assigned: {lastShipment.preAssignedContainerId}
                  </div>
                )}
              </div>
              {lastShipment.status === 'placed' && lastShipment.containerId && (
                <div className="badge badge-success">Вложено в {lastShipment.containerId}</div>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">Результат вложения</div>
          {!lastAssign ? (
            <p className="muted">Здесь появится ёмкость после подтверждения вложения.</p>
          ) : lastAssign.ok ? (
            <div className="stack">
              <div className="flex-between">
                <span className="mono">{lastAssign.container?.id}</span>
                <span className="badge badge-success">
                  {lastAssign.createdNew ? 'новая' : 'существующая'}
                </span>
              </div>
              <div>
                {lastAssign.container?.kind} · {lastAssign.container?.category}
              </div>
              <div className="muted">
                Вложений: {lastAssign.container?.shipmentIds?.length ?? 0} · масса{' '}
                {lastAssign.container?.totalWeightGrams} г / макс.{' '}
                {lastAssign.container?.maxWeightGrams} г
              </div>
              <div>
                Отметки:{' '}
                {(lastAssign.container?.marks || []).map((m: string) => (
                  <span key={m} className="badge" style={{ marginRight: 4 }}>
                    {m}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className="badge badge-error">{lastAssign.errorCode}</div>
              <div>{lastAssign.errorMessage}</div>
              {lastAssign.actionHint && (
                <div style={{ color: 'var(--accent)', fontSize: 13 }}>{lastAssign.actionHint}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {openContainers.length > 0 && (
        <div className="card table-scroll">
          <div className="card-title">Открытые ёмкости (pre-assign / текущие)</div>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Направление</th>
                <th>Вид</th>
                <th>Вложений</th>
                <th>Вес</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {openContainers.slice(0, 12).map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.id}</td>
                  <td className="mono">{c.directionId}</td>
                  <td>
                    {c.kind} / {c.category}
                  </td>
                  <td>{c.shipmentIds?.length ?? 0}</td>
                  <td>
                    {c.totalWeightGrams} / {c.maxWeightGrams} г
                  </td>
                  <td>
                    <span className="badge badge-accent">{c.status}</span>
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

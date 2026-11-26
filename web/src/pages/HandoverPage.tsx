import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Container, Waybill } from '../../../server/src/types/index';
import { api } from '../api/client';
import { readDraft, saveDraft } from '../sessionDraft';

export default function HandoverPage() {
  const { id } = useParams();
  const draftKey = `postcode.handover.${id ?? ''}`;
  const [waybill, setWaybill] = useState<(Waybill & { containers: Container[] }) | null>(null);
  const [scanned, setScanned] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [planMismatch, setPlanMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setWaybill(null);
    const draft = readDraft<{ scanned: string[]; code: string }>(draftKey);
    setScanned(draft?.scanned ?? []);
    setCode(draft?.code ?? '');
    setError('');
    setPlanMismatch(false);
    setMessage('');
    void api.getWaybill(id).then((details) => {
      if (active) setWaybill(details);
    }).catch((error: Error) => {
      if (active) setError(error.message);
    });
    return () => { active = false; };
  }, [id, draftKey]);

  useEffect(() => {
    if (waybill?.id !== id) return;
    if (waybill?.status === 'ready_for_dispatch') saveDraft(draftKey, { scanned, code });
    else if (waybill?.status === 'handed_over') saveDraft(draftKey, undefined);
  }, [waybill, draftKey, id, scanned, code]);

  useEffect(() => {
    if (waybill?.status === 'ready_for_dispatch') input.current?.focus();
  }, [waybill]);

  const checked = new Set(waybill?.handover?.containerIds ?? scanned);
  const expected = new Set(waybill?.containerIds);
  const missing = [...expected].filter((containerId) => !checked.has(containerId));
  const unexpected = [...checked].filter((containerId) => !expected.has(containerId));
  const ready = waybill?.status === 'ready_for_dispatch';

  const scan = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready || busy) return;
    input.current?.focus();
    const value = code.trim();
    if (!/^\d{16}$/.test(value)) {
      setMessage('Введите 16-значный идентификатор ёмкости.');
      return;
    }
    setError('');
    setCode('');
    if (checked.has(value)) {
      setMessage(`Ёмкость ${value} уже отсканирована.`);
      return;
    }
    setScanned((current) => [...current, value]);
    setMessage(expected.has(value) ? `Ёмкость ${value} сверена.` : `Ёмкости ${value} нет в накладной.`);
  };

  const handover = async () => {
    if (!waybill || !ready || !expected.size || missing.length || unexpected.length || busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api.handoverWaybill(waybill.id, scanned);
      setWaybill({ ...updated, containers: waybill.containers });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось подтвердить передачу.');
      setPlanMismatch(error instanceof Error && 'code' in error && error.code === 'TRIP_PLAN_MISMATCH');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="flex-between">
        <h1>Передача почты водителю</h1>
        <Link className="btn btn-ghost" to="/finish">К завершению</Link>
      </div>
      {error && <p role="alert">{error}</p>}
      {planMismatch && <Link to="/trip-plan">Открыть план рейса</Link>}
      {!waybill && !error && <p role="status">Загрузка накладной…</p>}
      {waybill && (
        <section className="card stack">
          <h2 className="card-title">Ф.23а № {waybill.id}</h2>
          <div>Ёмкостей: {waybill.totalContainers} · Отправлений: {waybill.totalShipments} · Масса: {waybill.totalWeightGrams} г</div>
          {waybill.handover && (
            <strong role="status">Передано водителю · {new Date(waybill.handover.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)</strong>
          )}
          {ready && (
            <form className="stack" onSubmit={scan}>
              <label htmlFor="handover-code">Отсканируйте ярлык каждой ёмкости или введите её номер</label>
              <div className="flex">
                <input id="handover-code" className="scan-field" ref={input} inputMode="numeric"
                  value={code} autoComplete="off" disabled={busy} onChange={(event) => setCode(event.target.value)} />
                <button className="btn btn-ghost" disabled={busy || !code.trim()}>Сверить</button>
              </div>
              <div role="status">{message}</div>
            </form>
          )}
          {!ready && !waybill.handover && <p>Подтвердите готовность накладной в разделе «Завершение».</p>}
          <div className="flex">
            <strong>Сверено: {expected.size - missing.length} из {expected.size}</strong>
            {ready && <span>Не сверено: {missing.length} · Лишние: {unexpected.length}</span>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>Ёмкость</th><th>Направление</th><th>Масса</th><th>Сверка</th></tr></thead>
              <tbody>{waybill.containers.map((container) => (
                <tr key={container.id}>
                  <td className="mono">{container.id}</td><td>{container.directionId}</td>
                  <td>{container.totalWeightGrams} г</td><td>{checked.has(container.id) ? 'Сверена' : 'Ожидает сверки'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {!!unexpected.length && (
            <div className="stack">
              <strong>Ёмкости, которых нет в накладной</strong>
              {unexpected.map((containerId) => (
                <div key={containerId} className="flex">
                  <span className="mono">{containerId}</span>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => {
                    setScanned((current) => current.filter((value) => value !== containerId));
                    setMessage('');
                    input.current?.focus();
                  }}>Убрать из сверки</button>
                </div>
              ))}
            </div>
          )}
          {ready && <div><button className="btn btn-primary"
            disabled={busy || !expected.size || !!missing.length || !!unexpected.length}
            onClick={() => void handover()}>Подтвердить передачу водителю</button></div>}
        </section>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useSession } from '../stores/session';
import { useScanner } from '../hooks/useScanner';

export default function ScanPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
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
    focusScan();
    const t = setInterval(focusScan, 3000);
    return () => clearInterval(t);
  }, []);

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

  const processCode = useCallback(
    async (raw: string) => {
      const barcode = raw.trim();
      if (!barcode || busy) return;
      setBusy(true);
      setCode('');
      try {
        // 1. lookup
        let shipment: any;
        try {
          shipment = await api.getShipment(barcode);
          setLastShipment(shipment);
        } catch (e: any) {
          playBeep(false);
          showToast({
            type: 'error',
            title: e.code === 'NOT_FOUND' ? 'Не найдено' : 'Ошибка',
            message: e.message,
            hint: e.actionHint,
          });
          setLastShipment(null);
          setLastAssign(null);
          return;
        }

        // 2. assign
        const result = await api.assign(barcode);
        setLastAssign(result);
        setLastShipment(result.shipment);
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
        await refreshStats();
        await refreshContainers();
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
      } finally {
        setBusy(false);
        focusScan();
      }
    },
    [busy, setLastShipment, setLastAssign, showToast, refreshStats, refreshContainers]
  );

  useScanner((c) => processCode(c), { enabled: true });

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      processCode(code);
    }
  };

  const openContainers = containers.filter((c) => c.status === 'open');

  return (
    <div className="stack">
      <div className="flex-between">
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Сборка исходящей почты</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            Сканируйте ШПИ или введите вручную · Enter = подтвердить · автофокус на поле
          </p>
        </div>
        <span className="badge badge-accent">{openContainers.length} открытых ёмкостей</span>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <label className="card-title" htmlFor="scan">
          Отсканируйте / введите ШПИ
        </label>
        <input
          id="scan"
          ref={inputRef}
          className="scan-field"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="IN261116000001 или международный ШПИ"
          autoComplete="off"
          disabled={busy}
        />
        <div className="flex mt-4">
          <button
            className="btn btn-primary btn-lg"
            disabled={busy || !code.trim()}
            onClick={() => processCode(code)}
          >
            {busy ? 'Обработка…' : 'Вложить (Enter)'}
          </button>
          <button className="btn btn-ghost" onClick={focusScan}>
            Фокус на поле
          </button>
        </div>
      </div>

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
            <p className="muted">После успешного скана — ёмкость и статус</p>
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
        <div className="card mt-4">
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

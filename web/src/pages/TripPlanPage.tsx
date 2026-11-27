import { useEffect, useState } from 'react';
import TripDeparture from '../TripDeparture';
import { Link } from 'react-router-dom';
import type { TripPlan } from '../../../server/src/types/index';
import { api, currentTripId } from '../api/client';

const statusLabel: Record<TripPlan['items'][number]['status'], string> = {
  waiting: 'Ожидает вложения',
  review: 'На разборе',
  unavailable: 'Пока не подлежит вывозу',
  packed: 'Вложено',
};

export default function TripPlanPage() {
  const tripId = currentTripId();
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!tripId) return;
    let active = true;
    void api.tripPlan().then((value) => {
      if (active) setPlan(value);
    }).catch((error: Error) => {
      if (active) setError(error.message);
    });
    return () => { active = false; };
  }, [tripId]);

  const update = async (barcode: string, included: boolean) => {
    if (busy || !barcode.trim()) return;
    setBusy(true);
    setError('');
    try {
      setPlan(await api.planShipment(barcode.trim(), included));
      if (included) setCode('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось изменить план.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="flex-between">
        <h1>План рейса</h1>
        <Link className="btn btn-ghost" to="/finish">Сводка рейса</Link>
      </div>
      {!tripId && <p role="status">Выберите или создайте рабочий рейс в панели выше.</p>}
      {tripId && <TripDeparture tripId={tripId} editable remaining={plan?.items.filter((item) => item.status !== 'packed').length} />}
      {error && <p role="alert">{error}</p>}
      {tripId && (
        <form className="card stack" onSubmit={(event) => {
          event.preventDefault();
          void update(code, true);
        }}>
          <label htmlFor="plan-code">ШПИ для включения в план</label>
          <input id="plan-code" className="scan-field" autoComplete="off" value={code}
            onChange={(event) => setCode(event.target.value)} disabled={busy} />
          <div><button className="btn btn-primary" disabled={busy || !code.trim()}>Включить в план</button></div>
        </form>
      )}
      {plan && (
        <>
          <div className="card stack" style={{ overflowX: 'auto' }}>
            <h2 className="card-title">В плане · {plan.items.length}</h2>
            {!plan.items.length && <p>Добавьте ШПИ, которые должны уехать этим рейсом.</p>}
            {!!plan.items.length && (
              <table className="table">
                <thead><tr><th>ШПИ</th><th>Вид</th><th>Статус</th><th>Действия</th></tr></thead>
                <tbody>{plan.items.map((item) => (
                  <tr key={item.barcode}>
                    <td className="mono">{item.barcode}</td><td>{item.kind}</td><td>{statusLabel[item.status]}</td>
                    <td>{item.containerId
                      ? <Link to={`/containers?id=${item.containerId}`}>Открыть ёмкость</Link>
                      : <div className="flex">
                          <Link className="btn btn-ghost" to={`/scan?barcode=${encodeURIComponent(item.barcode)}`}>К сборке</Link>
                          <button className="btn btn-ghost" disabled={busy} onClick={() => void update(item.barcode, false)}>Убрать из плана</button>
                        </div>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          {!!plan.outsidePlanBarcodes.length && (
            <section className="card stack">
              <h2 className="card-title">Вложены вне плана · {plan.outsidePlanBarcodes.length}</h2>
              {plan.outsidePlanBarcodes.map((barcode) => (
                <div className="flex" key={barcode}>
                  <span className="mono">{barcode}</span>
                  <button className="btn btn-ghost" disabled={busy} onClick={() => void update(barcode, true)}>Добавить в план</button>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

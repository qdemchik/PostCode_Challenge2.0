import { useEffect, useState } from 'react';

const keyFor = (tripId: string) => `postcode.departure.${tripId}`;

function readDeparture(tripId: string) {
  try {
    return localStorage.getItem(keyFor(tripId)) ?? '';
  } catch {
    return '';
  }
}

export default function TripDeparture({ tripId, remaining, editable = false }: {
  tripId: string;
  remaining?: number;
  editable?: boolean;
}) {
  const [departure, setDeparture] = useState(() => readDeparture(tripId));
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState(false);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);
  const time = new Date(departure).getTime();
  const minutes = Math.max(0, Math.ceil((time - now) / 60000));
  if (!tripId || (!editable && !Number.isFinite(time))) return null;
  return (
    <section className="card stack" aria-label="Время вывоза">
      {editable && <div className="review-fields"><label>Дата и время вывоза (местное время)
        <input type="datetime-local" value={departure} onChange={(event) => {
          const value = event.target.value;
          try {
            localStorage.setItem(keyFor(tripId), value);
            setDeparture(value);
            setNow(Date.now());
            setError(false);
          } catch {
            setError(true);
          }
        }} />
      </label></div>}
      {error && <span role="alert">Не удалось сохранить время вывоза в браузере.</span>}
      {Number.isFinite(time) && (
        <span role="status" className={minutes <= 45 && remaining ? 'departure-warning' : undefined}>
          {time <= now ? 'Плановое время вывоза наступило' : `До вывоза: ${minutes} мин`}
          {remaining !== undefined && ` · Не вложено по плану: ${remaining}`}
        </span>
      )}
    </section>
  );
}

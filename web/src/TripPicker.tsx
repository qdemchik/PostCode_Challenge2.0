import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { DispatchTrip } from '../../server/src/types/index';
import { api } from './api/client';

export default function TripPicker({ selected, onSelect }: {
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { pathname } = useLocation();
  const [trips, setTrips] = useState<DispatchTrip[]>([]);
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void api.trips().then(({ items }) => {
      if (!active) return;
      setTrips(items);
      if (selected && !items.some((trip) => trip.id === selected)) onSelect('');
    }).catch((error: Error) => {
      if (active) setError(error.message);
    });
    return () => { active = false; };
  }, [pathname, selected, onSelect]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const trip = await api.createTrip(name.trim());
      setTrips((current) => [trip, ...current]);
      setName('');
      setAdding(false);
      onSelect(trip.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось создать рейс.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card stack trip-picker" aria-label="Рабочий рейс">
      <div className="flex">
        <div className="review-fields">
          <label>Рабочий рейс
            <select value={selected} disabled={busy} onChange={(event) => onSelect(event.target.value)}>
              <option value="">Без рейса</option>
              {selected && !trips.some((trip) => trip.id === selected) && <option value={selected}>Загрузка рейса…</option>}
              {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.name}</option>)}
            </select>
          </label>
        </div>
        <button className="btn btn-ghost" disabled={busy} aria-expanded={adding}
          onClick={() => setAdding((value) => !value)}>Новый рейс</button>
        {selected && <Link className="btn btn-ghost" to="/trip-plan">План рейса</Link>}
      </div>
      {adding && (
        <form className="flex" onSubmit={create}>
          <div className="review-fields">
            <label>Название рейса
              <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
            </label>
          </div>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>Создать рейс</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

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
  const [mode, setMode] = useState<'create' | 'rename' | null>(null);
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

  const currentTrip = trips.find((trip) => trip.id === selected);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const trip = mode === 'rename' ? await api.renameTrip(selected, name) : await api.createTrip(name);
      setTrips((current) => mode === 'rename' ? current.map((item) => item.id === trip.id ? trip : item) : [trip, ...current]);
      setName('');
      setMode(null);
      onSelect(trip.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить рейс.');
    } finally {
      setBusy(false);
    }
  };

  const selectTrip = (id: string) => {
    setMode(null);
    setError('');
    onSelect(id);
  };

  return (
    <section className="trip-picker" aria-labelledby="working-trip">
      <h2 id="working-trip" className="card-title">Рабочий рейс</h2>
      <div className="trip-toolbar">
        {trips.length ? (
          <div className="trip-options" role="group" aria-label="Выбрать рейс">
            {[{ id: '', name: 'Без рейса' }, ...trips].map((trip) => (
              <button key={trip.id} className="btn btn-ghost trip-option" data-trip-id={trip.id}
                aria-pressed={selected === trip.id} disabled={busy} onClick={() => selectTrip(trip.id)}>{trip.name}</button>
            ))}
          </div>
        ) : (
          <span className="muted">{selected ? 'Загрузка рейса…' : 'Без рейса'}</span>
        )}
        <div className="trip-actions">
          <button className="btn btn-ghost" disabled={busy} aria-expanded={mode === 'create'}
            onClick={() => { setName(''); setMode('create'); }}>Новый рейс</button>
          {currentTrip && <button className="btn btn-ghost" disabled={busy} aria-expanded={mode === 'rename'}
            onClick={() => { setName(currentTrip.name); setMode('rename'); }}>Переименовать</button>}
          {selected && <Link className="btn btn-ghost" to="/trip-plan">План рейса</Link>}
        </div>
      </div>
      {mode && (
        <form className="trip-controls trip-form review-fields" onSubmit={save}>
          <label>Название рейса
            <input key={mode} autoFocus value={name} onChange={(event) => setName(event.target.value)}
              disabled={busy} maxLength={80} required />
          </label>
          <button className="btn btn-primary" disabled={busy || !name.trim()}>
            {mode === 'create' ? 'Создать рейс' : 'Сохранить название'}
          </button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setMode(null)}>Отмена</button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useSession } from '../stores/session';
import type { ScaleMode } from '../../../server/src/types/index';

export default function DemoPanel() {
  const [flags, setFlags] = useState<{ printerError: boolean; sourceDown: boolean; autoNestBags?: boolean;
    scaleMode?: ScaleMode; scaleErrorGrams?: number }>({ printerError: false, sourceDown: false, autoNestBags: false });
  const [errorGrams, setErrorGrams] = useState('');
  const [maxError, setMaxError] = useState<number>();
  const [busy, setBusy] = useState(false);
  const showToast = useSession((s) => s.showToast);
  const refreshStats = useSession((s) => s.refreshStats);
  const refreshContainers = useSession((s) => s.refreshContainers);

  useEffect(() => {
    api.demoFlags().then(setFlags).catch(() => {});
    void api.packagingReference().then((result) => setMaxError(result.maxDemoErrorGrams)).catch(() => {});
  }, []);

  const toggle = async (key: 'printerError' | 'sourceDown' | 'autoNestBags') => {
    setBusy(true);
    try {
      setFlags(await api.toggleError({ [key]: !flags[key] }));
    } catch (error) {
      showToast({ type: 'error', title: 'Не удалось изменить настройку', message: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const configureScale = async (patch: { scaleMode?: ScaleMode; scaleErrorGrams?: number | null }) => {
    setBusy(true);
    try { setFlags(await api.toggleError(patch)); } catch (error) {
      showToast({ type: 'error', title: 'Не удалось настроить демо-весы', message: error instanceof Error ? error.message : undefined });
    } finally { setBusy(false); }
  };

  const reset = async () => {
    if (!window.confirm('Сбросить рабочую сессию? Собранные ёмкости, документы и история печати будут удалены.')) return;
    setBusy(true);
    try {
      const res = await api.reset();
      setFlags({ printerError: false, sourceDown: false, autoNestBags: false });
      showToast({
        type: 'success',
        title: 'Сессия сброшена',
        message: `Загружено отправлений: ${res.shipments}`,
      });
      await Promise.all([refreshStats(), refreshContainers()]);
    } catch (error) {
      showToast({ type: 'error', title: 'Не удалось сбросить сессию', message: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <h1 style={{ margin: 0, fontSize: 22 }}>Демо-панель</h1>
      <p className="muted">Переключатели ошибок и сброс синтетических данных для демонстрации сценариев.</p>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Ошибки</div>
          <div className="stack">
            <label className="flex">
              <input
                type="checkbox"
                checked={flags.printerError}
                disabled={busy}
                onChange={() => toggle('printerError')}
              />
              Принтер недоступен
            </label>
            <label className="flex">
              <input
                type="checkbox"
                checked={flags.sourceDown}
                disabled={busy}
                onChange={() => toggle('sourceDown')}
              />
              Источник данных недоступен
            </label>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Данные</div>
          <label className="flex">
            <input type="checkbox" checked={!!flags.autoNestBags} disabled={busy} onChange={() => toggle('autoNestBags')} />
            Автовложение мешков в контейнер
          </label>
          <div className="demo-reset">
            <button className="btn btn-ghost demo-reset-button" disabled={busy} onClick={reset}
              aria-describedby="demo-reset-hint">
              Сбросить демо-сессию
            </button>
            <p id="demo-reset-hint" className="muted">
              Восстановит исходные отправления и создаст черновые ёмкости по направлениям.
            </p>
          </div>
        </div>
      </div>

      <div className="card" style={{ borderColor: 'var(--warning)' }}>
        <strong>Важно:</strong> все ФИО, адреса и часть реквизитов — синтетические.
      </div>
      <form className="card stack" onSubmit={(event) => {
        event.preventDefault();
        void configureScale({ scaleErrorGrams: errorGrams === '' ? null : Number(errorGrams) });
      }}>
        <div className="card-title">Демо-весы</div>
        <div className="review-fields">
          <label>Состояние весов
            <select value={flags.scaleMode ?? 'stable'} disabled={busy}
              onChange={(event) => void configureScale({ scaleMode: event.target.value as ScaleMode })}>
              <option value="stable">Стабильный вес</option>
              <option value="unstable">Нестабильный вес</option>
              <option value="offline">Весы недоступны</option>
              <option value="overload">Перегруз</option>
            </select>
          </label>
          <label>Погрешность, г
            <input type="number" min={maxError === undefined ? undefined : -maxError} max={maxError}
              placeholder={String(flags.scaleErrorGrams ?? 'Случайная')} value={errorGrams}
              onChange={(event) => setErrorGrams(event.target.value)} />
          </label>
        </div>
        <div><button className="btn btn-ghost" disabled={busy}>Сохранить погрешность</button></div>
      </form>
    </div>
  );
}

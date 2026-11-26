import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useSession } from '../stores/session';

export default function DemoPanel() {
  const [flags, setFlags] = useState({ printerError: false, sourceDown: false });
  const [busy, setBusy] = useState(false);
  const showToast = useSession((s) => s.showToast);
  const refreshStats = useSession((s) => s.refreshStats);
  const refreshContainers = useSession((s) => s.refreshContainers);

  useEffect(() => {
    api.demoFlags().then(setFlags).catch(() => {});
  }, []);

  const toggle = async (key: 'printerError' | 'sourceDown') => {
    setBusy(true);
    try {
      setFlags(await api.toggleError({ [key]: !flags[key] }));
    } catch (error) {
      showToast({ type: 'error', title: 'Не удалось изменить настройку', message: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!window.confirm('Сбросить рабочую сессию? Собранные ёмкости, документы и история печати будут удалены.')) return;
    setBusy(true);
    try {
      const res = await api.reset();
      setFlags({ printerError: false, sourceDown: false });
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
          <button className="btn btn-danger" disabled={busy} onClick={reset}>
            Сбросить сессию + pre-assign
          </button>
          <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
            Перезагружает shipments_demo.json, создаёт черновые ёмкости по направлениям.
          </p>
        </div>
      </div>

      <div className="card" style={{ borderColor: 'var(--warning)' }}>
        <strong>Важно:</strong> все ФИО, адреса и часть реквизитов — синтетические. Используйте только для
        демонстрации хакатона.
      </div>
    </div>
  );
}

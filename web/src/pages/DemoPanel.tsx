import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useSession } from '../stores/session';

export default function DemoPanel() {
  const [flags, setFlags] = useState({ printerError: false, sourceDown: false });
  const showToast = useSession((s) => s.showToast);
  const refreshStats = useSession((s) => s.refreshStats);
  const refreshContainers = useSession((s) => s.refreshContainers);

  useEffect(() => {
    api.demoFlags().then(setFlags).catch(() => {});
  }, []);

  const toggle = async (key: 'printerError' | 'sourceDown') => {
    const next = { ...flags, [key]: !flags[key] };
    const res = await api.toggleError(next);
    setFlags(res);
    showToast({ type: 'info', title: 'Демо-флаг изменён', message: JSON.stringify(res) });
  };

  const reset = async () => {
    const res = await api.reset();
    showToast({
      type: 'success',
      title: 'Сессия сброшена',
      message: `Отправлений: ${res.shipments}, pre-assign: ${res.preAssign?.containersCreated} ёмкостей`,
    });
    await refreshStats();
    await refreshContainers();
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
                onChange={() => toggle('printerError')}
              />
              Принтер недоступен
            </label>
            <label className="flex">
              <input
                type="checkbox"
                checked={flags.sourceDown}
                onChange={() => toggle('sourceDown')}
              />
              Источник данных недоступен
            </label>
          </div>
        </div>
        <div className="card">
          <div className="card-title">Данные</div>
          <button className="btn btn-danger" onClick={reset}>
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

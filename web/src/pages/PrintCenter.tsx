import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useSession } from '../stores/session';

export default function PrintCenter() {
  const [jobs, setJobs] = useState<any[]>([]);
  const showToast = useSession((s) => s.showToast);

  const load = async () => {
    const res = await api.printJobs();
    setJobs(res.items || []);
  };

  useEffect(() => {
    load();
  }, []);

  const retry = async (id: string) => {
    try {
      await api.retryPrint(id);
      showToast({ type: 'success', title: 'Повтор печати успешен' });
      await load();
    } catch (e: any) {
      showToast({ type: 'error', title: 'Снова ошибка', message: e.message, hint: e.actionHint });
      await load();
    }
  };

  return (
    <div className="stack">
      <div className="flex-between">
        <h1 style={{ margin: 0, fontSize: 22 }}>Центр печати</h1>
        <button className="btn btn-ghost" onClick={load}>
          Обновить
        </button>
      </div>
      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Тип</th>
              <th>Сущность</th>
              <th>Статус</th>
              <th>Ошибка</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="mono">{j.id}</td>
                <td>{j.type}</td>
                <td className="mono">{j.entityId}</td>
                <td>
                  <span
                    className={`badge badge-${
                      j.status === 'done' ? 'success' : j.status === 'error' ? 'error' : 'accent'
                    }`}
                  >
                    {j.status}
                  </span>
                </td>
                <td className="muted">{j.errorMessage || '—'}</td>
                <td>
                  {j.status === 'error' && (
                    <button className="btn btn-ghost" onClick={() => retry(j.id)}>
                      Повтор
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Очередь пуста
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

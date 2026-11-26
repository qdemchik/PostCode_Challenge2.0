import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Container, Shipment } from '../../../server/src/types/index';
import { api } from '../api/client';
import { useSession } from '../stores/session';
import { printEvidenceLabel } from '../printEvidence';

type ContainerDetail = Container & { shipments: Shipment[]; waybillId?: string };

const kinds: Container['kind'][] = ['группа РПО', 'контейнер', 'мешок', 'ящик', 'коробка', 'паллета', 'мешок М', 'газетная пачка'];
const categories: Container['category'][] = ['Заказная', 'Страховая', 'EMS', 'Сборная', 'Простая', 'С ТМЦ', 'С порожней тарой', 'С печатью', 'Со счетами и ДМ'];
const fields = [
  ['packagingModel', 'Модель тары'],
  ['packagingNumber', 'Номер тары'],
  ['sealNumber', 'Номер пломбы'],
  ['tareWeightGrams', 'Масса пустой тары, г'],
  ['maxWeightGrams', 'Допустимая общая масса, г'],
] as const;

export default function ContainersPage() {
  const [searchParams] = useSearchParams();
  const requestedId = searchParams.get('id');
  const containers = useSession((s) => s.containers);
  const refresh = useSession((s) => s.refreshContainers);
  const showToast = useSession((s) => s.showToast);
  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [targets, setTargets] = useState<Container[] | null>(null);
  const [target, setTarget] = useState('');
  const [actionError, setActionError] = useState('');
  const detailRequest = useRef(0);
  const targetRequest = useRef(0);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadDetail = async (id: string) => {
    const request = ++detailRequest.current;
    try {
      const next = await api.getContainer(id);
      if (request === detailRequest.current) setDetail(next);
    } catch (e: any) {
      if (request === detailRequest.current) showToast({ type: 'error', title: 'Ошибка', message: e.message });
    }
  };

  useEffect(() => {
    if (requestedId) void loadDetail(requestedId);
  }, [requestedId]);

  const update = async (action: () => Promise<unknown>, title: string) => {
    if (!detail || busy) return;
    ++detailRequest.current;
    setBusy(true);
    setActionError('');
    try {
      await action();
      setEditing(false);
      setRemoving(null);
      ++targetRequest.current;
      showToast({ type: 'success', title });
      await Promise.all([refresh(), loadDetail(detail.id)]);
    } catch (e: any) {
      setActionError(e.body?.errorMessage || e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    const values: Record<string, string | number> = {};
    for (const [key, value] of form.entries()) {
      values[key] = key === 'tareWeightGrams' || key === 'maxWeightGrams' ? Number(value) : String(value);
    }
    void update(() => api.patchContainer(detail.id, values), 'Реквизиты сохранены');
  };

  const chooseShipment = async (shipment: Shipment, fromId: string) => {
    const request = ++targetRequest.current;
    setActionError('');
    setRemoving(shipment.barcode);
    setTargets(null);
    setTarget('');
    try {
      const result = await api.transferTargets(shipment.barcode, fromId);
      if (request === targetRequest.current) setTargets(result.items);
    } catch (error) {
      if (request === targetRequest.current) {
        setActionError(error instanceof Error ? error.message : 'Не удалось загрузить ёмкости.');
      }
    }
  };

  return (
    <div className="stack">
      <div className="flex-between">
        <h1 style={{ margin: 0, fontSize: 22 }}>Ёмкости</h1>
        <button className="btn btn-ghost" onClick={() => refresh()}>
          Обновить
        </button>
      </div>

      <div className="grid-2 container-layout">
        <div className="card" style={{ maxHeight: 520, overflow: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Напр.</th>
                <th>Влож.</th>
                <th>Статус</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => (
                <tr
                  key={c.id}
                  style={{ background: detail?.id === c.id ? 'var(--accent-muted)' : undefined }}
                >
                  <td>
                    <button className="btn btn-ghost mono" disabled={busy || editing || !!removing} onClick={() => {
                      setActionError('');
                      void loadDetail(c.id);
                    }}>
                      {c.id}
                    </button>
                  </td>
                  <td className="mono">{c.directionId}</td>
                  <td>{c.shipmentIds?.length ?? 0}</td>
                  <td>
                    <span className={`badge badge-${c.status === 'closed' ? 'success' : 'accent'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td>
                    {c.labelPrinted && <span className="badge badge-success">ярлык</span>}
                  </td>
                </tr>
              ))}
              {containers.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Нет ёмкостей. Выполните pre-assign или начните сканирование.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">Карточка ёмкости</div>
          {!detail ? (
            <p className="muted">Выберите ёмкость слева</p>
          ) : (
            <div className="stack">
              <div className="mono" style={{ fontSize: 16 }}>
                {detail.id}
              </div>
              <div>
                {detail.kind} · {detail.category} · {detail.packagingModel}
              </div>
              <div className="muted">Тара № {detail.packagingNumber || '—'} · Пломба № {detail.sealNumber || '—'}</div>
              {detail.labelPrinted && <div>{printEvidenceLabel(detail.labelPrintEvidence, true)}</div>}
              {detail.waybillId && <div>Включена в накладную {detail.waybillId}</div>}
              <div className="muted">
                Направление {detail.directionId} · накладная {detail.waybillDirectionId}
              </div>
              <div>
                Масса: {detail.totalWeightGrams} г (тара {detail.tareWeightGrams}) / макс.{' '}
                {detail.maxWeightGrams} г
              </div>
              <div>
                Отметки:{' '}
                {(detail.marks || []).map((m: string) => (
                  <span key={m} className="badge" style={{ marginRight: 4 }}>
                    {m}
                  </span>
                ))}
              </div>
              {actionError && <p role="alert">{actionError}</p>}
              {editing ? (
                <form className="stack" onSubmit={save}>
                  <div className="review-fields">
                    <label>Вид ёмкости
                      <select name="kind" defaultValue={detail.kind}>
                        {kinds.map((kind) => <option key={kind}>{kind}</option>)}
                      </select>
                    </label>
                    <label>Вид вложения
                      <select name="category" defaultValue={detail.category}>
                        {categories.map((category) => <option key={category}>{category}</option>)}
                      </select>
                    </label>
                    {fields.map(([name, label]) => {
                      const numeric = name === 'tareWeightGrams' || name === 'maxWeightGrams';
                      return (
                        <label key={name}>{label}
                          <input name={name} type={numeric ? 'number' : 'text'} defaultValue={detail[name] ?? ''}
                            min={numeric ? Number(name === 'maxWeightGrams') : undefined}
                            required={numeric || name === 'packagingModel'} />
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex">
                    <button className="btn btn-primary" disabled={busy}>Сохранить</button>
                    <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => {
                      setEditing(false);
                      setActionError('');
                    }}>Отмена</button>
                  </div>
                </form>
              ) : (
              <div className="flex">
                {detail.status === 'open' && !detail.waybillId && (
                  <>
                  <button className="btn btn-ghost" disabled={busy || !!removing} onClick={() => {
                    setActionError('');
                    setEditing(true);
                  }}>Изменить реквизиты</button>
                  <button className="btn btn-primary" disabled={busy || !!removing || !detail.shipments.length}
                    onClick={() => update(() => api.closeContainer(detail.id), 'Ёмкость закрыта')}>
                    Закрыть ёмкость
                  </button>
                  </>
                )}
                {detail.status === 'closed' && !detail.waybillId && (
                  <button className="btn btn-ghost" disabled={busy} onClick={() =>
                    update(() => api.reopenContainer(detail.id), 'Ёмкость открыта')}>
                    Открыть снова
                  </button>
                )}
                {detail.status === 'closed' && (
                  <Link className="btn btn-ghost" to={`/print/label/${detail.id}`}>Открыть ярлык</Link>
                )}
              </div>
              )}
              {removing && (
                <div className="stack">
                  <div>Отправление <span className="mono">{removing}</span></div>
                  <div className="review-fields">
                    <label>Куда переложить
                      <select value={target} disabled={busy} onChange={(event) => setTarget(event.target.value)}>
                        <option value="">Выбрать ёмкость</option>
                        {targets?.map((container) => (
                          <option key={container.id} value={container.id}>
                            {container.id} · свободно {container.maxWeightGrams - container.totalWeightGrams} г
                          </option>
                        ))}
                        <option value="new">Новая ёмкость</option>
                      </select>
                    </label>
                  </div>
                  <div className="flex">
                    <button className="btn btn-primary" disabled={busy || !target} onClick={() =>
                      update(() => api.transferShipment(removing, detail.id, target === 'new' ? undefined : target),
                        'Отправление перенесено')}>
                      Переложить
                    </button>
                    <button className="btn btn-ghost" disabled={busy} onClick={() =>
                      update(() => api.removeShipment(removing, detail.id), 'Отправление извлечено')}>
                      Извлечь
                    </button>
                    <button className="btn btn-ghost" disabled={busy} onClick={() => {
                      ++targetRequest.current;
                      setRemoving(null);
                      setActionError('');
                    }}>Отмена</button>
                  </div>
                </div>
              )}
              <div className="card-title mt-4">Состав ({detail.shipments?.length || 0})</div>
              <div style={{ maxHeight: 220, overflow: 'auto', minWidth: 0 }}>
                <table className="table">
                  <tbody>
                    {detail.shipments.map((s) => (
                      <tr key={s.barcode}>
                        <td className="mono">{s.barcode}</td>
                        <td>{s.kind}</td>
                        <td>{s.weightGrams} г</td>
                        {detail.status === 'open' && !detail.waybillId && (
                          <td>
                            <button className="btn btn-ghost" disabled={busy || editing || !!removing}
                              aria-label={`Переложить или извлечь ${s.barcode}`}
                              onClick={() => void chooseShipment(s, detail.id)}>Переложить или извлечь</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

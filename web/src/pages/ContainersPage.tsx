import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Container, ScaleReading, Shipment, WeightSource } from '../../../server/src/types/index';
import { api } from '../api/client';
import { useSession } from '../stores/session';
import { printEvidenceLabel } from '../printEvidence';

type ContainerDetail = Container & { shipments: Shipment[]; children: Container[]; waybillId?: string;
  outerCategory?: Container['category']; acceptsChildContainers?: boolean };

const fields = [
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
  const [editKind, setEditKind] = useState<Container['kind']>('мешок');
  const [editModel, setEditModel] = useState('');
  const [manualTare, setManualTare] = useState(false);
  const [reference, setReference] = useState<Awaited<ReturnType<typeof api.packagingReference>>>();
  const packaging = reference?.packaging;
  const kinds = Object.keys(packaging ?? {}) as Container['kind'][];
  const categories = reference?.containerCategories ?? [];
  const modelTare = packaging?.[editKind].models.find((model) => model.name === editModel)?.tareGrams;
  useEffect(() => { void api.packagingReference().then(setReference).catch(() => {
    setActionError('Не удалось загрузить справочник тары. Обновите страницу.');
  }); }, []);
  const [removing, setRemoving] = useState<string | null>(null);
  const [targets, setTargets] = useState<Container[] | null>(null);
  const [target, setTarget] = useState('');
  const [actionError, setActionError] = useState('');
  const [nestedCode, setNestedCode] = useState('');
  const [measured, setMeasured] = useState('');
  const [reading, setReading] = useState<ScaleReading>();
  const [scaleStatus, setScaleStatus] = useState('');
  const [weightSource, setWeightSource] = useState<WeightSource>('calculated');
  const [parents, setParents] = useState<Container[] | null>(null);
  const [parentChoice, setParentChoice] = useState('');
  const detailRequest = useRef(0);
  const targetRequest = useRef(0);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadDetail = async (id: string) => {
    const request = ++detailRequest.current;
    try {
      const next = await api.getContainer(id);
      if (request === detailRequest.current) {
        setDetail(next);
        setNestedCode('');
        setMeasured('');
        setReading(undefined);
        setScaleStatus('');
        setWeightSource('calculated');
        setParents(null);
        setParentChoice('');
      }
    } catch (e: any) {
      if (request === detailRequest.current) showToast({ type: 'error', title: 'Ошибка', message: e.message });
    }
  };

  const chooseParent = async () => {
    if (!detail) return;
    setBusy(true);
    setActionError('');
    try {
      setParents((await api.nestingParents(detail.id)).items);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Обновите карточку и повторите поиск внешней ёмкости.');
    } finally { setBusy(false); }
  };

  const createOuter = async () => {
    if (!detail || busy || !outerCategory) return;
    setBusy(true);
    setActionError('');
    try {
      const { directionId, waybillDirectionId } = detail;
      const outer = await api.createContainer({ kind: 'контейнер', category: outerCategory, directionId, waybillDirectionId });
      await Promise.all([refresh(), loadDetail(outer.id)]);
      setNestedCode(detail.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Не удалось создать внешнюю ёмкость.');
    } finally {
      setBusy(false);
    }
  };

  const outerCategory = detail?.outerCategory;

  useEffect(() => {
    if (requestedId) void loadDetail(requestedId);
  }, [requestedId]);

  const update = async <T,>(action: () => Promise<T>, title: string, nextId?: (result: T) => string | undefined) => {
    if (!detail || busy) return;
    ++detailRequest.current;
    setBusy(true);
    setActionError('');
    try {
      const result = await action();
      setEditing(false);
      setRemoving(null);
      ++targetRequest.current;
      showToast({ type: 'success', title });
      await Promise.all([refresh(), loadDetail(nextId?.(result) ?? detail.id)]);
    } catch (e: any) {
      setActionError(e.body?.errorMessage || e.message);
    } finally {
      setBusy(false);
    }
  };

  const weigh = async () => {
    if (!detail || busy) return;
    setBusy(true);
    setReading(undefined);
    setMeasured('');
    setWeightSource('calculated');
    setScaleStatus('Получение показания…');
    try {
      const value = await api.scaleReading(detail.id);
      setReading(value);
      setScaleStatus(value.stable ? 'Вес стабилен.' : 'Вес нестабилен. Дождитесь стабилизации и перевзвесьте.');
    } catch (error) {
      setScaleStatus(error instanceof Error ? error.message : 'Показание недоступно. Повторите или введите массу вручную.');
    } finally { setBusy(false); }
  };

  const overweightReading = !!(detail && reading?.stable && reading.grams > detail.maxWeightGrams);
  const close = (openNext = false) => {
    if (!detail || overweightReading) return;
    void update(() => api.closeContainer(detail.id, measured ? Number(measured) : undefined, {
      weightSource, readingTs: weightSource === 'scale' ? reading?.ts : undefined, openNext,
    }), openNext ? 'Следующая ёмкость открыта' : 'Ёмкость закрыта', (result) => result.nextContainerId);
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    const values: Record<string, string | number> = {};
    for (const [key, value] of form.entries()) {
      const next = key === 'tareWeightGrams' || key === 'maxWeightGrams' ? Number(value) : String(value);
      if (next !== detail[key as keyof Container]) values[key] = next;
    }
    values.tareSource = manualTare ? 'manual' : 'reference';
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
              {detail.parentContainerId && <button className="btn btn-ghost" onClick={() => void loadDetail(detail.parentContainerId!)}>
                Внешняя ёмкость {detail.parentContainerId}
              </button>}
              <div className="muted">
                Направление {detail.directionId} · накладная {detail.waybillDirectionId}
              </div>
              <div>
                Масса: {detail.totalWeightGrams} г (тара {detail.tareWeightGrams}) / макс.{' '}
                {detail.maxWeightGrams === reference?.unlimitedMassGrams ? 'без ограничения' : detail.maxWeightGrams + ' г'}
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
              {detail.weightEvidence && <p>Источник массы: {detail.weightEvidence.source === 'scale' ? 'весы'
                : detail.weightEvidence.source === 'manual' ? 'введена вручную' : 'расчётная'}.</p>}
              {editing && packaging ? (
                <form className="stack" onSubmit={save}>
                  <div className="review-fields">
                    <label>Вид ёмкости
                      <select name="kind" value={editKind} onChange={(event) => {
                        const kind = event.target.value as Container['kind'];
                        setEditKind(kind);
                        setEditModel(packaging[kind].models[0].name);
                        setManualTare(false);
                      }}>
                        {kinds.map((kind) => <option key={kind}>{kind}</option>)}
                      </select>
                    </label>
                    <label>Модель тары
                      <select name="packagingModel" value={editModel} onChange={(event) => {
                        setEditModel(event.target.value);
                        setManualTare(false);
                      }}>
                        {packaging[editKind].models.filter((item) => item.available !== false || item.name === editModel)
                          .map((item) => <option key={item.name}>{item.name}</option>)}
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
                          <input key={name === 'tareWeightGrams' ? editKind + editModel : name}
                            name={name} type={numeric ? 'number' : 'text'} readOnly={name === 'tareWeightGrams' && !manualTare} defaultValue={
                              name === 'tareWeightGrams' && (editKind !== detail.kind || editModel !== detail.packagingModel)
                                ? modelTare
                                : detail[name] ?? ''
                            }
                            min={numeric ? Number(name === 'maxWeightGrams') : undefined}
                            required={numeric} />
                          {name === 'tareWeightGrams' && <button type="button" className="btn btn-ghost"
                            onClick={() => setManualTare(true)}>{manualTare ? 'Вручную' : 'Изменить вручную'}</button>}
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
                  <button className="btn btn-ghost" disabled={busy || !!removing || !packaging} onClick={() => {
                    if (!packaging) return;
                    setActionError('');
                    setEditKind(detail.kind);
                    setEditModel(packaging[detail.kind].models.find((model) => model.name === detail.packagingModel)?.name ??
                      packaging[detail.kind].models[0].name);
                    setManualTare(detail.tareSource === 'manual');
                    setEditing(true);
                  }}>Изменить реквизиты</button>
                  <button className="btn btn-primary" disabled={busy || !!removing ||
                    overweightReading ||
                    (!detail.shipments.length && !detail.children.length) ||
                    (!!measured && (!Number.isSafeInteger(Number(measured)) || Number(measured) <= 0))}
                    onClick={() => close()}>
                    Закрыть ёмкость
                  </button>
                  </>
                )}
                {detail.status === 'closed' && !detail.waybillId && !detail.parentContainerId && (
                  <button className="btn btn-ghost" disabled={busy} onClick={() =>
                    update(() => api.reopenContainer(detail.id), 'Ёмкость открыта')}>
                    Открыть снова
                  </button>
                )}
                {detail.status === 'closed' && !detail.waybillId && !detail.parentContainerId && outerCategory && (
                  <button className="btn btn-ghost" disabled={busy} onClick={() => void createOuter()}>Создать внешний контейнер</button>
                )}
                {detail.status === 'closed' && !detail.waybillId && !detail.parentContainerId && (
                  <button className="btn btn-ghost" disabled={busy} onClick={() => void chooseParent()}>Вложить в ёмкость…</button>
                )}
                {detail.status === 'closed' && (
                  <Link className="btn btn-ghost" to={`/print/label/${detail.id}`}>Открыть ярлык</Link>
                )}
              </div>
              )}
              {parents && (parents.length ? (
                <form className="review-fields" onSubmit={(event) => {
                  event.preventDefault();
                  if (parentChoice) void update(() => api.changeNestedContainer(parentChoice, detail.id, true), 'Ёмкость вложена');
                }}>
                  <label>Допустимая внешняя ёмкость
                    <select value={parentChoice} disabled={busy} onChange={(event) => setParentChoice(event.target.value)}>
                      <option value="">Выберите ёмкость</option>
                      {parents.map((parent) => <option key={parent.id} value={parent.id}>{parent.id} · {parent.kind}</option>)}
                    </select>
                  </label>
                  <div><button className="btn btn-primary" disabled={busy || !parentChoice}>Подтвердить вложение</button></div>
                </form>
              ) : <p role="status">Подходящих открытых ёмкостей нет. Создайте внешнюю ёмкость или проверьте её категорию и направление.</p>)}
              {detail.status === 'open' && !editing && !removing && reference?.weighingCategories.includes(detail.category) && (
                <div className="stack" onKeyDown={(event) => {
                  if (event.key === 'F6') { event.preventDefault(); void weigh(); }
                }}>
                <div className="review-fields">
                  <label>Масса ёмкости с вложениями, г
                    <input type="number" min={Math.max(1, detail.tareWeightGrams)} value={measured} disabled={busy}
                      placeholder={String(detail.totalWeightGrams)}
                      onChange={(event) => {
                        setMeasured(event.target.value);
                        setWeightSource(event.target.value ? 'manual' : 'calculated');
                      }} />
                  </label>
                  <div><button className="btn btn-ghost" disabled={busy}
                    onClick={() => void weigh()}>{reading ? 'Перевзвесить' : 'Взвесить'} · F6</button></div>
                </div>
                {!!scaleStatus && <p role="status">{scaleStatus}</p>}
                {reading && <>
                  <p>По весам: {reading.grams} г · Расчёт: {reading.calculatedGrams} г · Разница: {reading.grams - reading.calculatedGrams} г</p>
                  {Math.abs(reading.grams - reading.calculatedGrams) > reading.toleranceGrams &&
                    <p role="status">Расхождение выше допуска {reading.toleranceGrams.toLocaleString('ru-RU')} г. Проверьте состав и выберите источник.</p>}
                  <div className="flex">
                    <button className="btn btn-ghost" disabled={busy || !reading.stable || overweightReading} onClick={() => {
                      setMeasured(String(reading.grams)); setWeightSource('scale');
                    }}>Принять вес с весов</button>
                    <button className="btn btn-ghost" disabled={busy || overweightReading} onClick={() => {
                      setMeasured(''); setWeightSource('calculated');
                    }}>Оставить расчётный</button>
                  </div>
                </>}
                {overweightReading && <p role="alert">Превышена максимально допустимая масса ёмкости. Перенесите часть вложений и перевзвесьте.</p>}
                <div className="flex">
                  <button className="btn btn-ghost" disabled={busy || overweightReading || (!detail.shipments.length && !detail.children.length)}
                    onClick={() => close(true)}>Закрыть и открыть следующую</button>
                  {detail.shipments[0] && <button className="btn btn-ghost" disabled={busy}
                    onClick={() => void chooseShipment(detail.shipments[0], detail.id)}>Перенести отправление</button>}
                </div>
                </div>
              )}
              {detail.status === 'open' && !editing && !removing && detail.acceptsChildContainers && (
                <form className="review-fields" onSubmit={(event) => {
                  event.preventDefault();
                  if (nestedCode.trim()) void update(() => api.changeNestedContainer(detail.id, nestedCode.trim(), true), 'Ёмкость вложена');
                }}>
                  <label>ШИ вложенной ёмкости
                    <input value={nestedCode} onChange={(event) => setNestedCode(event.target.value)} disabled={busy} />
                  </label>
                  <div><button className="btn btn-ghost" disabled={busy || !nestedCode.trim()}>Вложить ёмкость</button></div>
                </form>
              )}
              {!!detail.children.length && (
                <div className="stack">
                  <strong>Вложенные ёмкости · {detail.children.length}</strong>
                  {detail.children.map((child) => (
                    <div className="flex" key={child.id}>
                      <button className="btn btn-ghost mono" disabled={busy || editing || !!removing}
                        onClick={() => void loadDetail(child.id)}>{child.id}</button>
                      <span>{child.kind} · {child.totalWeightGrams} г</span>
                      {detail.status === 'open' && !editing && !removing && (
                        <button className="btn btn-ghost" disabled={busy} onClick={() =>
                          void update(() => api.changeNestedContainer(detail.id, child.id, false), 'Вложенная ёмкость извлечена')}>Извлечь ёмкость</button>
                      )}
                    </div>
                  ))}
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

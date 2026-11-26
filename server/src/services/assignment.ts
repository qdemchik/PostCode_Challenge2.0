import type {
  Shipment,
  Container,
  ContainerKind,
  ContainerCategory,
  AssignResult,
} from '../types/index.js';
import { getState, addAudit } from './store.js';
import { makeDocumentId } from '../utils/id.js';
import { withDispatchDetails } from './routing.js';
import { resolveReview } from './review.js';

const rtMark = /(?:^|\s)рт(?:$|\s)/;

/** Группа видов по справочнику */
export function groupOfKind(kind: string): 'ПК' | 'ПО' | 'EMS' {
  const k = kind.trim().toLowerCase();
  if (k.includes('ems') || k.includes('бизнес курьер') || rtMark.test(k)) return 'EMS';
  if (
    k.includes('посыл') ||
    k.includes('мелкий пакет') ||
    k === 'бандероль-комплект' ||
    k.includes('еком') ||
    k.includes('кпо') ||
    k.includes('курьер онлайн') ||
    k.includes('гипергруз') ||
    k.includes('гко') ||
    k.includes('тср') ||
    k.includes('срочная') ||
    k.includes('всд') ||
    k.includes('дм')
  ) {
    return 'ПО';
  }
  return 'ПК';
}

function defaultKindForGroup(group: 'ПК' | 'ПО' | 'EMS'): ContainerKind {
  if (group === 'EMS') return 'мешок';
  if (group === 'ПО') return 'мешок';
  return 'мешок'; // группа РПО тоже часто мешок / без тары; для демо — мешок
}

function defaultCategory(shipment: Shipment): ContainerCategory {
  const c = shipment.category.toLowerCase();
  if (c.includes('объявлен') || c.includes('ценност')) return 'Страховая';
  if (shipment.kind.toLowerCase().includes('ems')) return 'EMS';
  if (c.includes('заказн')) return 'Заказная';
  return 'Сборная';
}

function packagingFor(kind: ContainerKind): { model: string; tare: number; max: number } {
  switch (kind) {
    case 'контейнер':
      return { model: 'Стандартный (КПШ)', tare: 110000, max: 500000 };
    case 'паллета':
      return { model: 'Стандартный', tare: 17000, max: 500000 };
    case 'ящик':
      return { model: 'Стандартный', tare: 1900, max: 10000 };
    case 'коробка':
      return { model: 'Стандартный', tare: 50, max: 10000 };
    case 'мешок М':
      return { model: '—', tare: 0, max: 14500 };
    case 'группа РПО':
      return { model: '—', tare: 0, max: 999999 };
    default: // мешок
      return { model: 'Брезентовый', tare: 500, max: 32000 };
  }
}

function marksFor(shipments: Shipment[]): string[] {
  const marks = new Set<string>();
  for (const s of shipments) {
    if (s.classification === 'Международная') marks.add('Международная');
    if (s.kind.toLowerCase().includes('оптимальн')) marks.add('ОПТ');
    if (rtMark.test(s.kind.toLowerCase())) marks.add('РТ');
    if (s.kind.toLowerCase().includes('бизнес курьер')) marks.add('БК');
  }
  if (marks.size === 0) marks.add('Без отметки');
  return Array.from(marks);
}

export function createContainerForShipment(s: Shipment, opsIndex = '114000', tripId?: string): Container {
  const group = groupOfKind(s.kind);
  const kind = defaultKindForGroup(group);
  const pack = packagingFor(kind);
  const state = getState();
  const id = makeDocumentId(opsIndex, [...Object.keys(state.containers), ...Object.keys(state.waybills)]);
  const container: Container = {
    id,
    tripId,
    directionId: s.directionContainer,
    waybillDirectionId: s.directionWaybill,
    category: defaultCategory(s),
    kind,
    packagingModel: pack.model,
    tareWeightGrams: pack.tare,
    maxWeightGrams: pack.max,
    shipmentIds: [],
    totalWeightGrams: pack.tare,
    marks: [],
    status: 'open',
    labelPrinted: false,
    createdAt: new Date().toISOString(),
    opsIndex,
    group,
  };
  return container;
}

/** Pre-assignment: группируем eligible-отправления по направлению и создаём черновые ёмкости */
export function preAssignContainers(tripId?: string): { containersCreated: number; assigned: number } {
  const state = getState();
  const byDir = new Map<string, Shipment[]>();
  for (const shipment of Object.values(state.shipments)) {
    if (shipment.plannedTripId && shipment.plannedTripId !== tripId) continue;
    const s = withDispatchDetails(shipment);
    if (!s.isEligibleForDispatch) continue;
    if (s.containerId) continue;
    if (s.routingIssue) continue;
    const key = `${s.directionContainer}|${s.directionWaybill}|${groupOfKind(s.kind)}|${defaultCategory(s)}`;
    if (!byDir.has(key)) byDir.set(key, []);
    byDir.get(key)!.push(s);
  }

  let containersCreated = 0;
  let assigned = 0;

  for (const [, list] of byDir) {
    // одна ёмкость на направление+группу (для демо; при переполнении создадим ещё при скане)
    const first = list[0];
    const container = createContainerForShipment(first, '114000', tripId);
    state.containers[container.id] = container;
    containersCreated++;

    for (const s of list) {
      state.shipments[s.barcode].preAssignedContainerId = container.id;
      assigned++;
    }
  }

  addAudit({
    entityType: 'container',
    entityId: 'pre-assign',
    action: 'pre_assign',
    newValue: { containersCreated, assigned },
  });

  return { containersCreated, assigned };
}

function compatibleContainers(s: Shipment, tripId?: string): Container[] {
  const group = groupOfKind(s.kind);
  const category = defaultCategory(s);
  const documented = new Set(Object.values(getState().waybills).filter((w) => w.status !== 'cancelled').flatMap((w) => w.containerIds));
  return Object.values(getState().containers).filter(
    (c) =>
      c.id !== s.containerId &&
      c.tripId === tripId &&
      c.status === 'open' &&
      !documented.has(c.id) &&
      c.directionId === s.directionContainer &&
      c.waybillDirectionId === s.directionWaybill &&
      c.group === group &&
      c.category === category &&
      c.totalWeightGrams + s.weightGrams <= c.maxWeightGrams
  );
}

export function findBestOpenContainer(s: Shipment, tripId?: string): Container | null {
  const candidates = compatibleContainers(s, tripId);
  return candidates.find((c) => c.id === s.preAssignedContainerId) ?? candidates[0] ?? null;
}

function updateContainerContents(container: Container) {
  const shipments = getState().shipments;
  const contents = container.shipmentIds.map((id) => shipments[id]).filter(Boolean);
  container.totalWeightGrams = container.tareWeightGrams + contents.reduce((sum, shipment) => sum + shipment.weightGrams, 0);
  container.marks = contents.length ? marksFor(contents) : [];
  container.labelPrinted = false;
  container.labelPrintEvidence = undefined;
}

export function transferTargets(barcode: string, fromId: string): Container[] {
  const state = getState();
  const shipment = state.shipments[barcode];
  const container = state.containers[fromId];
  return shipment?.containerId === fromId && container ? compatibleContainers(shipment, container.tripId) : [];
}

export function transferShipment(barcode: string, fromId: string, toId?: string): AssignResult {
  const state = getState();
  const shipment = state.shipments[barcode];
  const from = state.containers[fromId];
  if (!shipment || !from || shipment.containerId !== fromId || !from.shipmentIds.includes(barcode)) {
    return { ok: false, errorCode: 'CONTAINER_CHANGED', errorMessage: 'Отправление уже не находится в выбранной ёмкости.' };
  }
  if (from.status !== 'open' || Object.values(state.waybills).some((w) => w.status !== 'cancelled' && w.containerIds.includes(fromId))) {
    return { ok: false, errorCode: 'CONTAINER_CLOSED', errorMessage: 'Исходная ёмкость недоступна для изменений.' };
  }
  const to = toId
    ? transferTargets(barcode, fromId).find((container) => container.id === toId)
    : createContainerForShipment(shipment, from.opsIndex, from.tripId);
  if (!to || to.shipmentIds.includes(barcode) || to.totalWeightGrams + shipment.weightGrams > to.maxWeightGrams) {
    return { ok: false, errorCode: 'TARGET_UNAVAILABLE', errorMessage: 'Выбранная ёмкость недоступна или в ней недостаточно места.' };
  }
  state.containers[to.id] = to;
  from.shipmentIds = from.shipmentIds.filter((id) => id !== barcode);
  to.shipmentIds.push(barcode);
  shipment.containerId = to.id;
  shipment.status = 'placed';
  shipment.placedAt = new Date().toISOString();
  updateContainerContents(from);
  updateContainerContents(to);
  addAudit({
    entityType: 'shipment', entityId: barcode, action: 'transferred',
    oldValue: { containerId: fromId }, newValue: { containerId: to.id },
  });
  return { ok: true, shipment, container: to, createdNew: !toId };
}

export function assignShipment(barcode: string, tripId?: string): AssignResult {
  const state = getState();
  const stored = state.shipments[barcode];

  if (!stored) {
    return {
      ok: false,
      errorCode: 'NOT_FOUND',
      errorMessage: 'Отправление не найдено по идентификатору',
      actionHint: 'Проверьте ШПИ, повторите скан или введите вручную. При необходимости передайте на разбор.',
    };
  }
  const s = withDispatchDetails(stored);
  if (s.plannedTripId && s.plannedTripId !== tripId) {
    return {
      ok: false,
      shipment: s,
      errorCode: 'OTHER_TRIP',
      errorMessage: `Отправление запланировано на рейс «${state.trips[s.plannedTripId]?.name ?? s.plannedTripId}».`,
      actionHint: 'Переключите рабочий рейс перед вложением.',
    };
  }

  if (!s.isEligibleForDispatch) {
    return {
      ok: false,
      shipment: s,
      errorCode: 'NOT_ELIGIBLE',
      errorMessage: 'Отправление не подлежит отправке (срок хранения не истёк)',
      actionHint: 'Дождитесь истечения срока хранения или верните в кладовую.',
    };
  }

  if (s.containerId) {
    return {
      ok: false,
      shipment: s,
      errorCode: 'ALREADY_PLACED',
      errorMessage: `Отправление уже вложено в ёмкость ${s.containerId}`,
      actionHint: 'Для переноса откройте карточку текущей ёмкости.',
    };
  }

  if (s.routingIssue) {
    return {
      ok: false,
      shipment: s,
      errorCode: s.routingIssue,
      errorMessage: s.routingIssue === 'ROUTE_AMBIGUOUS'
        ? 'По плану найдено несколько направлений.'
        : 'В плане нет подходящего направления.',
      actionHint: 'Проверьте индекс и реквизиты отправления. При необходимости передайте его на разбор.',
    };
  }

  let container = findBestOpenContainer(s, tripId);
  let createdNew = false;

  if (!container) {
    container = createContainerForShipment(s, '114000', tripId);
    if (container.totalWeightGrams + s.weightGrams > container.maxWeightGrams) {
      return {
        ok: false,
        shipment: s,
        errorCode: 'OVERWEIGHT',
        errorMessage: 'Отправление превышает допустимую массу стандартной ёмкости.',
        actionHint: 'Проверьте указанную массу или подберите ёмкость большей вместимости.',
      };
    }
    state.containers[container.id] = container;
    createdNew = true;
  }

  // вложение
  container.shipmentIds.push(s.barcode);
  s.status = 'placed';
  s.containerId = container.id;
  s.placedAt = new Date().toISOString();
  state.shipments[barcode] = s;
  if (!s.verifiedAt) {
    s.verifiedAt = s.placedAt;
    addAudit({ entityType: 'shipment', entityId: barcode, action: 'verified' });
  }
  updateContainerContents(container);

  addAudit({
    entityType: 'shipment',
    entityId: s.barcode,
    action: 'placed',
    newValue: { containerId: container.id, createdNew },
  });
  resolveReview(s.barcode, 'assigned');

  return { ok: true, shipment: s, container, createdNew };
}

export function removeFromContainer(barcode: string, expectedContainerId?: string): AssignResult {
  const state = getState();
  const s = state.shipments[barcode];
  if (!s || !s.containerId) {
    return { ok: false, errorCode: 'NOT_IN_CONTAINER', errorMessage: 'Отправление не вложено' };
  }
  if (expectedContainerId && s.containerId !== expectedContainerId) {
    return { ok: false, errorCode: 'CONTAINER_CHANGED', errorMessage: 'Отправление уже находится в другой ёмкости.' };
  }
  const c = state.containers[s.containerId];
  if (!c) {
    return { ok: false, errorCode: 'CONTAINER_MISSING', errorMessage: 'Ёмкость не найдена' };
  }
  if (c.status === 'closed') {
    return {
      ok: false,
      errorCode: 'CONTAINER_CLOSED',
      errorMessage: 'Ёмкость закрыта. Сначала откройте её.',
      actionHint: 'Откройте ёмкость, затем извлеките отправление.',
    };
  }
  c.shipmentIds = c.shipmentIds.filter((id) => id !== barcode);
  updateContainerContents(c);
  s.status = 'verified';
  s.containerId = undefined;
  s.placedAt = undefined;
  addAudit({ entityType: 'shipment', entityId: barcode, action: 'removed_from_container', oldValue: { containerId: c.id } });
  return { ok: true, shipment: s, container: c };
}

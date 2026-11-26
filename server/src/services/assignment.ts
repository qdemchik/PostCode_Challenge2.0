import type {
  Shipment,
  Container,
  ContainerKind,
  ContainerCategory,
  AssignResult,
} from '../types/index.js';
import { getState, addAudit } from './store.js';
import { makeDocumentId } from '../utils/id.js';

/** Группа видов по справочнику */
export function groupOfKind(kind: string): 'ПК' | 'ПО' | 'EMS' {
  const k = kind.toLowerCase();
  if (k.includes('ems') || k.includes('бизнес курьер') || k.includes('рт')) return 'EMS';
  if (
    k.includes('посыл') ||
    k.includes('мелкий пакет') ||
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
    if (s.kind.toLowerCase().includes('рт')) marks.add('РТ');
    if (s.kind.toLowerCase().includes('бизнес курьер')) marks.add('БК');
  }
  if (marks.size === 0) marks.add('Без отметки');
  return Array.from(marks);
}

export function createContainerForShipment(s: Shipment, opsIndex = '114000'): Container {
  const group = groupOfKind(s.kind);
  const kind = defaultKindForGroup(group);
  const pack = packagingFor(kind);
  const id = makeDocumentId(opsIndex);
  const container: Container = {
    id,
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
export function preAssignContainers(): { containersCreated: number; assigned: number } {
  const state = getState();
  const byDir = new Map<string, Shipment[]>();
  for (const s of Object.values(state.shipments)) {
    if (!s.isEligibleForDispatch) continue;
    if (s.status === 'placed') continue;
    const key = `${s.directionContainer}|${groupOfKind(s.kind)}`;
    if (!byDir.has(key)) byDir.set(key, []);
    byDir.get(key)!.push(s);
  }

  let containersCreated = 0;
  let assigned = 0;

  for (const [, list] of byDir) {
    // одна ёмкость на направление+группу (для демо; при переполнении создадим ещё при скане)
    const first = list[0];
    const container = createContainerForShipment(first);
    state.containers[container.id] = container;
    containersCreated++;

    for (const s of list) {
      s.preAssignedContainerId = container.id;
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

export function findBestOpenContainer(s: Shipment): Container | null {
  const state = getState();
  const group = groupOfKind(s.kind);
  const candidates = Object.values(state.containers).filter(
    (c) =>
      c.status === 'open' &&
      c.directionId === s.directionContainer &&
      c.group === group &&
      c.totalWeightGrams + s.weightGrams <= c.maxWeightGrams
  );
  // предпочитаем pre-assigned
  if (s.preAssignedContainerId) {
    const pre = state.containers[s.preAssignedContainerId];
    if (pre && pre.status === 'open' && pre.totalWeightGrams + s.weightGrams <= pre.maxWeightGrams) {
      return pre;
    }
  }
  return candidates[0] ?? null;
}

export function assignShipment(barcode: string): AssignResult {
  const state = getState();
  const s = state.shipments[barcode];

  if (!s) {
    return {
      ok: false,
      errorCode: 'NOT_FOUND',
      errorMessage: 'Отправление не найдено по идентификатору',
      actionHint: 'Проверьте ШПИ, повторите скан или введите вручную. При необходимости передайте на разбор.',
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

  if (s.status === 'placed' && s.containerId) {
    return {
      ok: false,
      shipment: s,
      errorCode: 'ALREADY_PLACED',
      errorMessage: `Отправление уже вложено в ёмкость ${s.containerId}`,
      actionHint: 'Если нужно переложить — сначала извлеките из текущей ёмкости.',
    };
  }

  let container = findBestOpenContainer(s);
  let createdNew = false;

  if (!container) {
    container = createContainerForShipment(s);
    state.containers[container.id] = container;
    createdNew = true;
  }

  // вложение
  container.shipmentIds.push(s.barcode);
  container.totalWeightGrams += s.weightGrams;
  container.marks = marksFor(
    container.shipmentIds.map((id) => state.shipments[id]).filter(Boolean)
  );

  s.status = 'placed';
  s.containerId = container.id;
  s.placedAt = new Date().toISOString();
  if (!s.verifiedAt) {
    s.verifiedAt = s.placedAt;
    if (s.status === 'placed') {
      // already placed
    }
  }

  addAudit({
    entityType: 'shipment',
    entityId: s.barcode,
    action: 'placed',
    newValue: { containerId: container.id, createdNew },
  });

  return { ok: true, shipment: s, container, createdNew };
}

export function removeFromContainer(barcode: string): AssignResult {
  const state = getState();
  const s = state.shipments[barcode];
  if (!s || !s.containerId) {
    return { ok: false, errorCode: 'NOT_IN_CONTAINER', errorMessage: 'Отправление не вложено' };
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
  c.totalWeightGrams = Math.max(c.tareWeightGrams, c.totalWeightGrams - s.weightGrams);
  s.status = 'verified';
  s.containerId = undefined;
  s.placedAt = undefined;
  addAudit({ entityType: 'shipment', entityId: barcode, action: 'removed_from_container' });
  return { ok: true, shipment: s, container: c };
}

import type {
  Shipment,
  Container,
  ContainerCategory,
  AssignResult,
} from '../types/index.js';
import { getState, addAudit } from './store.js';
import { makeDocumentId } from '../utils/id.js';
import { withDispatchDetails } from './routing.js';
import { resolveReview } from './review.js';
import { canPackShipments, containerMassLimit, packagingModel } from '../reference/packaging.js';
import { computeMarks } from '../reference/marks.js';
import { canNestContainer } from '../reference/containerNesting.js';

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

function defaultCategory(shipment: Pick<Shipment, 'kind' | 'category'>): ContainerCategory {
  const c = shipment.category.toLowerCase();
  if (c.includes('объявлен') || c.includes('ценност')) return 'Страховая';
  if (shipment.kind.toLowerCase().includes('ems')) return 'EMS';
  if (c.includes('заказн')) return 'Заказная';
  return 'Сборная';
}

export function createContainerForShipment(s: Pick<Shipment, 'kind' | 'category' | 'directionContainer' | 'directionWaybill'>, opsIndex = '114000', tripId?: string): Container {
  const group = groupOfKind(s.kind);
  // ДОПУЩЕНИЕ: сохраняем брезентовый мешок как типовую тару автоматического подбора.
  const kind = 'мешок';
  const pack = packagingModel(kind)!;
  const state = getState();
  const id = makeDocumentId(opsIndex, [...Object.keys(state.containers), ...Object.keys(state.waybills)]);
  const container: Container = {
    id,
    tripId,
    directionId: s.directionContainer,
    waybillDirectionId: s.directionWaybill,
    category: defaultCategory(s),
    kind,
    packagingModel: pack.name,
    tareWeightGrams: pack.tareGrams,
    tareSource: 'reference',
    maxWeightGrams: containerMassLimit({ kind, packagingModel: pack.name, group }, []),
    shipmentIds: [],
    totalWeightGrams: pack.tareGrams,
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
      !c.parentContainerId &&
      !documented.has(c.id) &&
      c.directionId === s.directionContainer &&
      c.waybillDirectionId === s.directionWaybill &&
      c.group === group &&
      c.category === category &&
      fitsContainer(c, [...containerContents(c), s])
  );
}

export function findBestOpenContainer(s: Shipment, tripId?: string): Container | null {
  const candidates = compatibleContainers(s, tripId);
  return candidates.find((c) => c.id === s.preAssignedContainerId) ?? candidates[0] ?? null;
}

export function containerContents(container: Container): Shipment[] {
  const shipments = getState().shipments;
  return container.shipmentIds.map((id) => shipments[id]).filter(Boolean);
}

export function childContainers(container: Container): Container[] {
  const state = getState();
  return (container.childContainerIds ?? []).map((id) => state.containers[id]).filter(Boolean);
}

export function containerShipments(container: Container): Shipment[] {
  return [...containerContents(container), ...childContainers(container).flatMap(containerShipments)];
}

export function grossMassGrams(container: Container, contents: readonly Shipment[], children = childContainers(container)): number {
  return container.tareWeightGrams + contents.reduce((sum, shipment) => sum + shipment.weightGrams, 0) +
    children.reduce((sum, child) => sum + child.totalWeightGrams, 0);
}

export function resultingMassLimit(container: Container, contents: readonly Shipment[], children = childContainers(container)): number {
  return containerMassLimit(container, [...contents, ...children.flatMap(containerShipments)]);
}

function fitsContainer(container: Container, contents: readonly Shipment[]): boolean {
  return canPackShipments(container.kind, container.group, contents) &&
    grossMassGrams(container, contents) <= resultingMassLimit(container, contents);
}

function canReduceContents(container: Container, contents: Shipment[], children = childContainers(container)): boolean {
  const nextMass = grossMassGrams(container, contents, children);
  const nextLimit = resultingMassLimit(container, contents, children);
  const current = containerContents(container);
  // Permit incremental recovery of an overweight container from an older session.
  return nextMass <= nextLimit ||
    (nextLimit >= resultingMassLimit(container, current) && nextMass < grossMassGrams(container, current));
}

function updateContainerContents(container: Container) {
  const contents = containerContents(container);
  container.totalWeightGrams = grossMassGrams(container, contents);
  container.maxWeightGrams = resultingMassLimit(container, contents);
  container.marks = computeMarks(contents, container, childContainers(container));
  container.measuredWeightGrams = undefined;
  container.weightEvidence = undefined;
  container.labelPrinted = false;
  container.labelPrintEvidence = undefined;
}

export function validateNesting(parentId: string, childId: string, attach: boolean): AssignResult {
  const state = getState();
  const parent = state.containers[parentId];
  const child = state.containers[childId];
  if (!parent || !child || parent.id === child.id ||
    (attach && childContainers(child).some((descendant) => descendant.id === parentId || hasNestedId(descendant, parentId)))) {
    return { ok: false, errorCode: 'INVALID_CONTAINER', errorMessage: 'Такое вложение невозможно. Выберите другую ёмкость и проверьте её состав.' };
  }
  const documented = Object.values(state.waybills).some((waybill) =>
    waybill.status !== 'cancelled' && (waybill.containerIds.includes(parentId) || waybill.containerIds.includes(childId)));
  if (documented || parent.status !== 'open' || parent.parentContainerId || child.status !== 'closed') {
    return { ok: false, errorCode: 'CONTAINER_UNAVAILABLE', errorMessage: 'Нужны открытая внешняя и закрытая вложенная ёмкости, доступные для изменения.' };
  }
  const children = childContainers(parent);
  if (attach ? !!child.parentContainerId : child.parentContainerId !== parentId) {
    return { ok: false, errorCode: 'CONTAINER_ALREADY_NESTED', errorMessage: 'Проверьте текущую внешнюю ёмкость.' };
  }
  // ДОПУЩЕНИЕ: вложение разрешено внутри одного рейса и плана направлений.
  if (attach && (parent.tripId !== child.tripId || parent.directionId !== child.directionId ||
    parent.waybillDirectionId !== child.waybillDirectionId)) {
    return { ok: false, errorCode: 'NESTING_ROUTE_MISMATCH', errorMessage: 'Рейс и направления ёмкостей должны совпадать.' };
  }
  const next = attach ? [...children, child] : children.filter((item) => item.id !== childId);
  if (attach && !canPackShipments(child.kind, child.group, containerContents(child))) {
    return { ok: false, errorCode: 'INCOMPATIBLE_PACKAGING', errorMessage: 'Вид вложенной тары не подходит для группы. Проверьте реквизиты.' };
  }
  if (next.some((item) => !canNestContainer(parent, item, next.filter((sibling) => sibling.id !== item.id)))) {
    return { ok: false, errorCode: 'INCOMPATIBLE_NESTING',
      errorMessage: 'Вид или категория ёмкости несовместимы. Выберите допустимую внешнюю ёмкость и проверьте её вложения.' };
  }
  const contents = containerContents(parent);
  if (attach ? grossMassGrams(parent, contents, next) > resultingMassLimit(parent, contents, next)
    : !canReduceContents(parent, contents, next)) {
    return { ok: false, errorCode: 'OVERWEIGHT', errorMessage: 'После изменения состава превышена допустимая масса.' };
  }
  return { ok: true, container: parent };
}

function hasNestedId(container: Container, id: string, visited = new Set<string>()): boolean {
  if (visited.has(container.id)) return false;
  visited.add(container.id);
  return childContainers(container).some((child) => child.id === id || hasNestedId(child, id, visited));
}

export function availableParents(childId: string): Container[] {
  return Object.values(getState().containers).filter((parent) => validateNesting(parent.id, childId, true).ok);
}

export function changeNestedContainer(parentId: string, childId: string, attach: boolean): AssignResult {
  const result = validateNesting(parentId, childId, attach);
  if (!result.ok || !result.container) return result;
  const parent = result.container;
  const child = getState().containers[childId];
  const children = parent.childContainerIds ?? [];
  parent.childContainerIds = attach ? [...children, childId] : children.filter((id) => id !== childId);
  child.parentContainerId = attach ? parentId : undefined;
  updateContainerContents(parent);
  addAudit({ entityType: 'container', entityId: parentId, action: attach ? 'container_nested' : 'container_detached',
    newValue: { childId } });
  return { ok: true, container: parent };
}

export function transferTargets(barcode: string, fromId: string): Container[] {
  const state = getState();
  const shipment = state.shipments[barcode];
  const container = state.containers[fromId];
  return shipment?.containerId === fromId && container
    ? compatibleContainers(shipment, container.tripId)
      .map((candidate) => ({ ...candidate, maxWeightGrams: resultingMassLimit(candidate, [...containerContents(candidate), shipment]) }))
    : [];
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
  if (!to || to.shipmentIds.includes(barcode) || !fitsContainer(to, [...containerContents(to), shipment])) {
    return { ok: false, errorCode: 'TARGET_UNAVAILABLE', errorMessage: 'Выбранная ёмкость недоступна или в ней недостаточно места.' };
  }
  const remaining = containerContents(from).filter((item) => item.barcode !== barcode);
  if (!canReduceContents(from, remaining)) {
    return { ok: false, errorCode: 'OVERWEIGHT', errorMessage: 'После переноса исходная ёмкость превысит допустимую массу.' };
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
    if (!fitsContainer(container, [s])) {
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
  const remaining = containerContents(c).filter((item) => item.barcode !== barcode);
  if (!canReduceContents(c, remaining)) {
    return { ok: false, errorCode: 'OVERWEIGHT', errorMessage: 'После извлечения ёмкость превысит допустимую массу.' };
  }
  c.shipmentIds = c.shipmentIds.filter((id) => id !== barcode);
  updateContainerContents(c);
  s.status = 'verified';
  s.containerId = undefined;
  s.placedAt = undefined;
  addAudit({ entityType: 'shipment', entityId: barcode, action: 'removed_from_container', oldValue: { containerId: c.id } });
  return { ok: true, shipment: s, container: c };
}

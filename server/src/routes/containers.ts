import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getState, addAudit, saveSessionChange } from '../services/store.js';
import { availableParents, changeNestedContainer, childContainers, containerContents, containerShipments, createContainerForShipment,
  grossMassGrams, preAssignContainers, resultingMassLimit } from '../services/assignment.js';
import type { Container, ContainerKind, ContainerCategory } from '../types/index.js';
import { requestTripId } from './trips.js';
import { canPackShipments, containerCategories, containerMassLimit, packaging, packagingModel, unlimitedMassGrams } from '../reference/packaging.js';
import { computeMarks, labelMarks, shipmentMarkLabels } from '../reference/marks.js';
import { acceptsChildContainers, canNestContainer, weighingCategories } from '../reference/containerNesting.js';
import { acceptedReading, discardReading, MockScaleAdapter, rememberReading } from '../services/scale.js';
import { maxDemoErrorGrams } from '../reference/weighing.js';
import { makeDocumentId } from '../utils/id.js';
import type { WeightSource } from '../types/index.js';

const containerDetails = z.object({
  kind: z.custom<ContainerKind>((value) => typeof value === 'string' && Object.hasOwn(packaging, value)),
  category: z.enum(containerCategories),
  packagingModel: z.string().trim().min(1),
  packagingNumber: z.string().trim(),
  sealNumber: z.string().trim(),
  tareWeightGrams: z.number().int().safe().nonnegative(),
  tareSource: z.enum(['reference', 'manual']),
  maxWeightGrams: z.number().int().safe().positive(),
}).partial().strict();

export async function containerRoutes(app: FastifyInstance) {
  app.get('/api/reference/packaging', async () => ({
    packaging,
    shipmentMarkLabels,
    weighingCategories: [...weighingCategories],
    containerCategories,
    unlimitedMassGrams,
    maxDemoErrorGrams,
  }));
  app.get<{ Querystring: { containerId?: string } }>('/api/scale/reading', async (req, reply) => {
    const state = getState();
    const id = req.query.containerId;
    const container = id && Object.hasOwn(state.containers, id) ? state.containers[id] : undefined;
    if (!container || container.status !== 'open' || !weighingCategories.has(container.category)) {
      return reply.code(409).send({ code: 'WEIGHING_UNAVAILABLE', message: 'Откройте ёмкость категории, для которой предусмотрено взвешивание.' });
    }
    const reading = new MockScaleAdapter(state.demoFlags.scaleMode, state.demoFlags.scaleErrorGrams)
      .read(grossMassGrams(container, containerContents(container)));
    rememberReading(container.id, reading);
    return reading;
  });
  app.get('/api/containers', async (req) => {
    const q = req.query as Record<string, string>;
    const tripId = requestTripId(req);
    let list = Object.values(getState().containers).filter((container) => container.tripId === tripId);
    if (q.status) list = list.filter((c) => c.status === q.status);
    if (q.direction) list = list.filter((c) => c.directionId === q.direction);
    return { total: list.length, items: list };
  });

  app.get<{ Params: { id: string } }>('/api/containers/:id', async (req, reply) => {
    const state = getState();
    const c = state.containers[req.params.id];
    if (!c) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Ёмкость не найдена' });
    const shipments = c.shipmentIds
      .map((id) => state.shipments[id])
      .filter(Boolean);
    const waybillId = Object.values(state.waybills).find((w) => w.status !== 'cancelled' && w.containerIds.includes(c.id))?.id;
    const outerCategory = ([c.category, 'Сборная'] as const).find((category) =>
      canNestContainer({ ...c, kind: 'контейнер', category }, c, []));
    return { ...c, shipments, children: childContainers(c), waybillId, outerCategory,
      acceptsChildContainers: acceptsChildContainers(c.kind) };
  });

  app.post('/api/containers/pre-assign', async (req) => {
    const result = preAssignContainers(requestTripId(req));
    saveSessionChange();
    return { ok: true, ...result };
  });

  app.post<{
    Body: {
      directionId: string;
      waybillDirectionId?: string;
      kind?: ContainerKind;
      category?: ContainerCategory;
      packagingModel?: string;
    };
  }>('/api/containers', async (req, reply) => {
    const body = req.body;
    const fakeShipment = {
      directionContainer: body?.directionId || '108970',
      directionWaybill: body?.waybillDirectionId || body?.directionId || '108970',
      kind: 'Письмо',
      category: 'Заказное',
      weightGrams: 0,
    };
    const c = createContainerForShipment(fakeShipment, '114000', requestTripId(req));
    const kind = body?.kind ?? c.kind;
    const model = Object.hasOwn(packaging, kind) ? packagingModel(kind, body?.packagingModel) : undefined;
    if (!model || model.available === false) {
      return reply.code(400).send({ code: 'INVALID_PACKAGING', message: 'Выберите доступный вид и модель тары из справочника.' });
    }
    c.kind = kind;
    if (body?.category) c.category = body.category;
    c.packagingModel = model.name;
    c.tareWeightGrams = model.tareGrams;
    c.tareSource = 'reference';
    c.totalWeightGrams = model.tareGrams;
    c.maxWeightGrams = containerMassLimit(c, []);
    getState().containers[c.id] = c;
    addAudit({ entityType: 'container', entityId: c.id, action: 'created_manual' });
    saveSessionChange();
    return c;
  });

  app.post<{ Params: { id: string }; Body: { measuredWeightGrams?: number; weightSource?: WeightSource; readingTs?: string; openNext?: boolean } }>('/api/containers/:id/close', async (req, reply) => {
    const c = getState().containers[req.params.id];
    if (!c) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Не найдена' });
    if (c.status === 'closed') return { ...c, nextContainerId: c.continuationContainerId };
    if (c.shipmentIds.length === 0 && !c.childContainerIds?.length) {
      return reply.code(409).send({
        code: 'EMPTY_CONTAINER',
        message: 'Нельзя закрыть пустую ёмкость',
        actionHint: 'Добавьте вложения или удалите ёмкость.',
      });
    }
    const contents = containerContents(c);
    if (childContainers(c).some((child) => child.status !== 'closed')) {
      return reply.code(409).send({ code: 'CHILD_CONTAINER_OPEN', message: 'Закройте вложенные ёмкости перед закрытием внешней.' });
    }
    if (!canPackShipments(c.kind, c.group, contents)) {
      return reply.code(409).send({ code: 'INCOMPATIBLE_PACKAGING', message: 'Тара не подходит для этих вложений.' });
    }
    const measurement = req.body?.measuredWeightGrams;
    const source = req.body?.weightSource ?? (measurement === undefined ? 'calculated' : 'manual');
    const calculated = grossMassGrams(c, contents);
    if (!['calculated', 'manual', 'scale'].includes(source) ||
      ((source === 'calculated') !== (measurement === undefined)) ||
      (source === 'scale' && !acceptedReading(c.id, req.body?.readingTs, measurement, calculated))) {
      return reply.code(409).send({ code: 'INVALID_SCALE_READING', message: 'Масса с весов недоступна или устарела. Взвесьте ёмкость снова либо выберите расчётную массу.' });
    }
    if (measurement !== undefined && (!weighingCategories.has(c.category) ||
      !Number.isSafeInteger(measurement) || measurement < c.tareWeightGrams || measurement <= 0)) {
      return reply.code(400).send({ code: 'INVALID_WEIGHING', message: 'Укажите массу брутто в граммах для подходящей категории.' });
    }
    const totalWeightGrams = measurement ?? calculated;
    const maxWeightGrams = resultingMassLimit(c, contents);
    if (totalWeightGrams > maxWeightGrams) {
      return reply.code(409).send({ code: 'OVERWEIGHT', message: 'Превышена максимально допустимая масса ёмкости. Перенесите часть вложений и проверьте массу снова.' });
    }
    const state = getState();
    const nextId = req.body?.openNext === true
      ? makeDocumentId(c.opsIndex, [...Object.keys(state.containers), ...Object.keys(state.waybills)]) : undefined;
    c.totalWeightGrams = totalWeightGrams;
    c.maxWeightGrams = maxWeightGrams;
    c.measuredWeightGrams = measurement;
    c.weightEvidence = { source, at: source === 'scale' ? req.body.readingTs! : new Date().toISOString() };
    c.marks = computeMarks(contents, c, childContainers(c));
    c.status = 'closed';
    c.closedAt = new Date().toISOString();
    addAudit({ entityType: 'container', entityId: c.id, action: 'closed', newValue: { totalWeightGrams, ...c.weightEvidence } });
    if (c.kind === 'мешок' && getState().demoFlags.autoNestBags) {
      const parent = availableParents(c.id).find((item) => item.kind === 'контейнер');
      if (parent) changeNestedContainer(parent.id, c.id, true);
    }
    if (nextId) {
      c.continuationContainerId = nextId;
      state.containers[nextId] = {
        ...c, id: nextId, status: 'open', createdAt: new Date().toISOString(), closedAt: undefined,
        continuationContainerId: undefined,
        shipmentIds: [], childContainerIds: [], parentContainerId: undefined, sealNumber: undefined,
        packagingNumber: undefined, labelPrinted: false, labelPrintEvidence: undefined, marks: [],
        totalWeightGrams: c.tareWeightGrams, maxWeightGrams: containerMassLimit(c, []),
        measuredWeightGrams: undefined, weightEvidence: undefined,
      };
      addAudit({ entityType: 'container', entityId: nextId, action: 'created_manual', newValue: { previousContainerId: c.id } });
    }
    saveSessionChange();
    discardReading(c.id);
    return { ...c, nextContainerId: nextId };
  });

  app.post<{ Params: { id: string } }>('/api/containers/:id/reopen', async (req, reply) => {
    const state = getState();
    const c = state.containers[req.params.id];
    if (!c) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Не найдена' });
    if (c.parentContainerId) {
      return reply.code(409).send({ code: 'CONTAINER_NESTED', message: 'Сначала извлеките ёмкость из внешней.' });
    }
    if (Object.values(state.waybills).some((w) => w.status !== 'cancelled' && w.containerIds.includes(c.id))) {
      return reply.code(409).send({
        code: 'CONTAINER_IN_WAYBILL',
        message: 'Ёмкость уже включена в накладную.',
      });
    }
    c.status = 'open';
    c.closedAt = undefined;
    c.measuredWeightGrams = undefined;
    c.weightEvidence = undefined;
    discardReading(c.id);
    c.totalWeightGrams = grossMassGrams(c, containerContents(c));
    c.marks = computeMarks(containerContents(c), c, childContainers(c));
    c.labelPrinted = false;
    c.labelPrintEvidence = undefined;
    addAudit({ entityType: 'container', entityId: c.id, action: 'reopened' });
    saveSessionChange();
    return c;
  });

  app.patch<{ Params: { id: string }; Body: Partial<Container> }>(
    '/api/containers/:id',
    async (req, reply) => {
      const state = getState();
      const c = state.containers[req.params.id];
      if (!c) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Не найдена' });
      if (Object.values(state.waybills).some((w) => w.status !== 'cancelled' && w.containerIds.includes(c.id))) {
        return reply.code(409).send({
          code: 'CONTAINER_IN_WAYBILL',
          message: 'Реквизиты ёмкости уже включены в накладную.',
        });
      }
      if (c.status !== 'open') {
        return reply.code(409).send({
          code: 'CONTAINER_CLOSED',
          message: 'Откройте ёмкость перед изменением реквизитов.',
        });
      }
      const parsed = containerDetails.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: 'INVALID_CONTAINER_DATA', message: 'Проверьте реквизиты и массу тары.' });
      }
      const { maxWeightGrams, ...changes } = parsed.data;
      const updated = { ...c, ...changes };
      const kindChanged = updated.kind !== c.kind;
      const retainedModel = kindChanged ? undefined : packagingModel(c.kind, c.packagingModel)?.name;
      const model = packagingModel(updated.kind, changes.packagingModel ?? retainedModel);
      if (!model || (model.available === false && (kindChanged || model.name !== c.packagingModel))) {
        return reply.code(400).send({ code: 'INVALID_PACKAGING', message: 'Выберите модель тары из справочника.' });
      }
      updated.packagingModel = model.name;
      if ((kindChanged || updated.packagingModel !== c.packagingModel) && changes.tareWeightGrams === undefined) {
        updated.tareWeightGrams = model.tareGrams;
        updated.tareSource = 'reference';
      }
      if (changes.tareSource === 'reference') updated.tareWeightGrams = model.tareGrams;
      if (changes.tareWeightGrams !== undefined && changes.tareSource !== 'reference') updated.tareSource = 'manual';
      if (kindChanged) updated.massLimitOverrideGrams = undefined;
      if (maxWeightGrams !== undefined) updated.massLimitOverrideGrams = maxWeightGrams;
      const contents = containerContents(c);
      if (!canPackShipments(updated.kind, updated.group, contents)) {
        return reply.code(409).send({ code: 'INCOMPATIBLE_PACKAGING', message: 'Тара не подходит для этих вложений.' });
      }
      const totalWeightGrams = grossMassGrams(updated, contents);
      const children = childContainers(c);
      if (children.some((child) => !canNestContainer(updated, child, children.filter((item) => item.id !== child.id)))) {
        return reply.code(409).send({ code: 'INCOMPATIBLE_NESTING', message: 'Изменение тары или категории нарушает совместимость с вложенными ёмкостями.' });
      }
      updated.maxWeightGrams = resultingMassLimit(updated, contents);
      if (totalWeightGrams > updated.maxWeightGrams) {
        return reply.code(409).send({
          code: 'OVERWEIGHT',
          message: 'Масса тары и вложений превышает указанный предел.',
        });
      }
      Object.assign(c, updated, {
        totalWeightGrams, marks: computeMarks(contents, updated, children), labelPrinted: false, labelPrintEvidence: undefined,
      });
      addAudit({ entityType: 'container', entityId: c.id, action: 'updated' });
      saveSessionChange();
      return c;
    }
  );

  app.post<{ Params: { id: string }; Body: { childId?: string; attach?: boolean } }>('/api/containers/:id/nesting', async (req, reply) => {
    const { childId, attach } = req.body ?? {};
    if (typeof childId !== 'string' || typeof attach !== 'boolean') {
      return reply.code(400).send({ code: 'INVALID_NESTING', message: 'Укажите идентификатор вложенной ёмкости и действие.' });
    }
    const result = changeNestedContainer(req.params.id, childId, attach);
    if (!result.ok) return reply.code(409).send(result);
    saveSessionChange();
    return result.container;
  });

  app.get<{ Params: { id: string } }>('/api/containers/:id/nest-parents', async (req) => ({
    items: availableParents(req.params.id),
  }));

  for (const [path, attach] of [['nest', true], ['unnest', false]] as const) {
    app.post<{ Params: { id: string }; Body: { childId?: unknown } }>(`/api/containers/:id/${path}`, async (req, reply) => {
      const childId = req.body?.childId;
      if (typeof childId !== 'string' || !childId.trim()) {
        return reply.code(400).send({ code: 'INVALID_NESTING', message: 'Укажите ШИ вложенной ёмкости.' });
      }
      const result = changeNestedContainer(req.params.id, childId.trim(), attach);
      if (!result.ok) return reply.code(409).send(result);
      saveSessionChange();
      return result.container;
    });
  }

  app.get<{ Params: { id: string } }>('/api/containers/:id/label', async (req, reply) => {
    const c = getState().containers[req.params.id];
    if (!c) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Не найдена' });
    return {
      containerId: c.id,
      directionId: c.directionId,
      category: c.category,
      kind: c.kind,
      packagingModel: c.packagingModel,
      packagingNumber: c.packagingNumber,
      labelPrintEvidence: c.labelPrintEvidence,
      labelPrinted: c.labelPrinted,
      totalWeightGrams: c.totalWeightGrams,
      weightEvidence: c.weightEvidence,
      shipmentCount: containerShipments(c).length,
      childContainerCount: c.childContainerIds?.length ?? 0,
      marks: labelMarks(c.marks),
      sealNumber: c.sealNumber,
      opsIndex: c.opsIndex,
      barcode: c.id,
      createdAt: c.createdAt,
    };
  });
}

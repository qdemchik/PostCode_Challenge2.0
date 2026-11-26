import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getState, addAudit, saveSessionChange } from '../services/store.js';
import { createContainerForShipment, preAssignContainers } from '../services/assignment.js';
import type { Container, ContainerKind, ContainerCategory } from '../types/index.js';
import { requestTripId } from './trips.js';

const containerDetails = z.object({
  kind: z.enum(['группа РПО', 'контейнер', 'мешок', 'ящик', 'коробка', 'паллета', 'мешок М', 'газетная пачка']),
  category: z.enum(['Заказная', 'Страховая', 'EMS', 'Сборная', 'Простая', 'С ТМЦ', 'С порожней тарой', 'С печатью', 'Со счетами и ДМ']),
  packagingModel: z.string().trim().min(1),
  packagingNumber: z.string().trim(),
  sealNumber: z.string().trim(),
  tareWeightGrams: z.number().int().safe().nonnegative(),
  maxWeightGrams: z.number().int().safe().positive(),
}).partial().strict();

export async function containerRoutes(app: FastifyInstance) {
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
    return { ...c, shipments, waybillId };
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
  }>('/api/containers', async (req) => {
    const body = req.body || ({} as any);
    const fakeShipment = {
      directionContainer: body.directionId || '108970',
      directionWaybill: body.waybillDirectionId || body.directionId || '108970',
      kind: 'Письмо',
      category: 'Заказное',
      weightGrams: 0,
    } as any;
    const c = createContainerForShipment(fakeShipment, '114000', requestTripId(req));
    if (body.kind) c.kind = body.kind;
    if (body.category) c.category = body.category;
    if (body.packagingModel) c.packagingModel = body.packagingModel;
    getState().containers[c.id] = c;
    addAudit({ entityType: 'container', entityId: c.id, action: 'created_manual' });
    saveSessionChange();
    return c;
  });

  app.post<{ Params: { id: string } }>('/api/containers/:id/close', async (req, reply) => {
    const c = getState().containers[req.params.id];
    if (!c) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Не найдена' });
    if (c.shipmentIds.length === 0) {
      return reply.code(409).send({
        code: 'EMPTY_CONTAINER',
        message: 'Нельзя закрыть пустую ёмкость',
        actionHint: 'Добавьте вложения или удалите ёмкость.',
      });
    }
    c.status = 'closed';
    c.closedAt = new Date().toISOString();
    addAudit({ entityType: 'container', entityId: c.id, action: 'closed' });
    saveSessionChange();
    return c;
  });

  app.post<{ Params: { id: string } }>('/api/containers/:id/reopen', async (req, reply) => {
    const state = getState();
    const c = state.containers[req.params.id];
    if (!c) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Не найдена' });
    if (Object.values(state.waybills).some((w) => w.status !== 'cancelled' && w.containerIds.includes(c.id))) {
      return reply.code(409).send({
        code: 'CONTAINER_IN_WAYBILL',
        message: 'Ёмкость уже включена в накладную.',
      });
    }
    c.status = 'open';
    c.closedAt = undefined;
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
      const updated = { ...c, ...parsed.data };
      const totalWeightGrams =
        updated.tareWeightGrams +
        c.shipmentIds.reduce((sum, id) => sum + (state.shipments[id]?.weightGrams || 0), 0);
      if (totalWeightGrams > updated.maxWeightGrams) {
        return reply.code(409).send({
          code: 'OVERWEIGHT',
          message: 'Масса тары и вложений превышает указанный предел.',
        });
      }
      Object.assign(c, parsed.data, { totalWeightGrams, labelPrinted: false, labelPrintEvidence: undefined });
      addAudit({ entityType: 'container', entityId: c.id, action: 'updated' });
      saveSessionChange();
      return c;
    }
  );

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
      shipmentCount: c.shipmentIds.length,
      marks: c.marks,
      sealNumber: c.sealNumber,
      opsIndex: c.opsIndex,
      barcode: c.id,
      createdAt: c.createdAt,
    };
  });
}

import type { FastifyInstance } from 'fastify';
import { getState, addAudit } from '../services/store.js';
import { createContainerForShipment, preAssignContainers } from '../services/assignment.js';
import { makeDocumentId } from '../utils/id.js';
import type { Container, ContainerKind, ContainerCategory } from '../types/index.js';

export async function containerRoutes(app: FastifyInstance) {
  app.get('/api/containers', async (req) => {
    const q = req.query as Record<string, string>;
    let list = Object.values(getState().containers);
    if (q.status) list = list.filter((c) => c.status === q.status);
    if (q.direction) list = list.filter((c) => c.directionId === q.direction);
    return { total: list.length, items: list };
  });

  app.get<{ Params: { id: string } }>('/api/containers/:id', async (req, reply) => {
    const c = getState().containers[req.params.id];
    if (!c) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Ёмкость не найдена' });
    const shipments = c.shipmentIds
      .map((id) => getState().shipments[id])
      .filter(Boolean);
    return { ...c, shipments };
  });

  app.post('/api/containers/pre-assign', async () => {
    const result = preAssignContainers();
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
    const c = createContainerForShipment(fakeShipment);
    if (body.kind) c.kind = body.kind;
    if (body.category) c.category = body.category;
    if (body.packagingModel) c.packagingModel = body.packagingModel;
    getState().containers[c.id] = c;
    addAudit({ entityType: 'container', entityId: c.id, action: 'created_manual' });
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
    return c;
  });

  app.post<{ Params: { id: string } }>('/api/containers/:id/reopen', async (req, reply) => {
    const c = getState().containers[req.params.id];
    if (!c) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Не найдена' });
    c.status = 'open';
    c.closedAt = undefined;
    c.labelPrinted = false;
    addAudit({ entityType: 'container', entityId: c.id, action: 'reopened' });
    return c;
  });

  app.patch<{ Params: { id: string }; Body: Partial<Container> }>(
    '/api/containers/:id',
    async (req, reply) => {
      const c = getState().containers[req.params.id];
      if (!c) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Не найдена' });
      const allowed = [
        'kind',
        'category',
        'packagingModel',
        'sealNumber',
        'packagingNumber',
        'tareWeightGrams',
        'maxWeightGrams',
      ] as const;
      for (const key of allowed) {
        if (key in req.body && (req.body as any)[key] !== undefined) {
          (c as any)[key] = (req.body as any)[key];
        }
      }
      // пересчёт веса
      const state = getState();
      c.totalWeightGrams =
        c.tareWeightGrams +
        c.shipmentIds.reduce((sum, id) => sum + (state.shipments[id]?.weightGrams || 0), 0);
      addAudit({ entityType: 'container', entityId: c.id, action: 'updated' });
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

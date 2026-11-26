import type { FastifyInstance } from 'fastify';
import { getState, addAudit } from '../services/store.js';
import { assignShipment, removeFromContainer } from '../services/assignment.js';
import { validateBarcode } from '../utils/barcode.js';
import type { Shipment } from '../types/index.js';

export async function shipmentRoutes(app: FastifyInstance) {
  app.get('/api/shipments', async (req) => {
    const q = req.query as Record<string, string>;
    let list = Object.values(getState().shipments);
    if (q.eligible === 'true') list = list.filter((s) => s.isEligibleForDispatch);
    if (q.origin) list = list.filter((s) => s.origin === q.origin);
    if (q.status) list = list.filter((s) => s.status === q.status);
    if (q.direction) list = list.filter((s) => s.directionContainer === q.direction);
    return {
      total: list.length,
      items: list.slice(0, Number(q.limit) || 500),
    };
  });

  app.get<{ Params: { barcode: string } }>('/api/shipments/:barcode', async (req, reply) => {
    const state = getState();
    if (state.demoFlags.sourceDown) {
      return reply.code(503).send({
        code: 'SOURCE_DOWN',
        message: 'Источник данных временно недоступен (демо-режим)',
        actionHint: 'Повторите позже или введите данные вручную.',
      });
    }
    const barcode = req.params.barcode.trim();
    const validation = validateBarcode(barcode);
    if (!validation.ok) {
      return reply.code(400).send({
        code: 'INVALID_BARCODE',
        message: validation.message,
        actionHint: 'Проверьте формат и повторите ввод.',
      });
    }
    const s = state.shipments[barcode];
    if (!s) {
      return reply.code(404).send({
        code: 'NOT_FOUND',
        message: 'Отправление не найдено по идентификатору',
        actionHint: 'Повторите скан, введите вручную или передайте на разбор.',
      });
    }
    if (s.status === 'pending') {
      s.status = 'found';
    }
    return s;
  });

  app.patch<{ Params: { barcode: string }; Body: Partial<Shipment> }>(
    '/api/shipments/:barcode',
    async (req, reply) => {
      const state = getState();
      const s = state.shipments[req.params.barcode];
      if (!s) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Не найдено' });
      if (!s.originalData) s.originalData = { ...s };
      const allowed = [
        'recipientName',
        'address',
        'city',
        'destinationIndex',
        'weightGrams',
        'notes',
        'category',
        'method',
      ] as const;
      for (const key of allowed) {
        if (key in req.body && (req.body as any)[key] !== undefined) {
          const oldValue = (s as any)[key];
          (s as any)[key] = (req.body as any)[key];
          addAudit({
            entityType: 'shipment',
            entityId: s.barcode,
            action: 'field_edit',
            field: key,
            oldValue,
            newValue: (req.body as any)[key],
          });
        }
      }
      s.status = 'verified';
      s.verifiedAt = new Date().toISOString();
      return s;
    }
  );

  app.post<{ Params: { barcode: string } }>('/api/shipments/:barcode/verify', async (req, reply) => {
    const s = getState().shipments[req.params.barcode];
    if (!s) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Не найдено' });
    s.status = 'verified';
    s.verifiedAt = new Date().toISOString();
    addAudit({ entityType: 'shipment', entityId: s.barcode, action: 'verified' });
    return s;
  });

  app.post<{ Body: { barcode: string } }>('/api/containers/assign', async (req, reply) => {
    const barcode = (req.body?.barcode || '').trim();
    if (!barcode) return reply.code(400).send({ code: 'EMPTY', message: 'Укажите barcode' });
    const result = assignShipment(barcode);
    if (!result.ok) {
      return reply.code(result.errorCode === 'NOT_FOUND' ? 404 : 409).send(result);
    }
    return result;
  });

  app.post<{ Body: { barcode: string } }>('/api/containers/remove-shipment', async (req, reply) => {
    const result = removeFromContainer((req.body?.barcode || '').trim());
    if (!result.ok) return reply.code(409).send(result);
    return result;
  });
}

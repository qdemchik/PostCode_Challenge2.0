import type { FastifyInstance } from 'fastify';
import { getState, addAudit, saveSessionChange } from '../services/store.js';
import { assignShipment, removeFromContainer, transferShipment, transferTargets } from '../services/assignment.js';
import { validateBarcode } from '../utils/barcode.js';
import { withDispatchDetails } from '../services/routing.js';
import type { Shipment } from '../types/index.js';
import { requestTripId } from './trips.js';

export async function shipmentRoutes(app: FastifyInstance) {
  app.get('/api/shipments', async (req) => {
    const q = req.query as Record<string, string>;
    let list = Object.values(getState().shipments).map(withDispatchDetails);
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
      addAudit({ entityType: 'shipment', entityId: s.barcode, action: 'found' });
      saveSessionChange();
    }
    return {
      ...withDispatchDetails(s),
      plannedTripName: s.plannedTripId ? state.trips[s.plannedTripId]?.name : undefined,
    };
  });

  app.patch<{ Params: { barcode: string }; Body: Partial<Shipment> }>(
    '/api/shipments/:barcode',
    async (req, reply) => {
      const state = getState();
      const s = state.shipments[req.params.barcode];
      if (!s) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Не найдено' });
      const weight = req.body?.weightGrams;
      if (!req.body || (weight !== undefined && (!Number.isSafeInteger(weight) || weight <= 0))) {
        return reply.code(400).send({
          code: 'INVALID_SHIPMENT_DATA',
          message: 'Укажите массу целым положительным числом в граммах.',
        });
      }
      const index = req.body.destinationIndex;
      if (index !== undefined && (!Number.isSafeInteger(index) || index < 0 || index > 999999)) {
        return reply.code(400).send({
          code: 'INVALID_SHIPMENT_DATA',
          message: 'Укажите корректный шестизначный индекс назначения.',
        });
      }
      if (['category', 'method'].some((field) => {
        const value = req.body[field as 'category' | 'method'];
        return value !== undefined && (typeof value !== 'string' || !value.trim());
      })) {
        return reply.code(400).send({ code: 'INVALID_SHIPMENT_DATA', message: 'Проверьте категорию и способ пересылки.' });
      }
      if (s.containerId && (
        (weight !== undefined && weight !== s.weightGrams) ||
        (index !== undefined && index !== s.destinationIndex) ||
        (req.body.category !== undefined && req.body.category !== s.category) ||
        (req.body.method !== undefined && req.body.method !== s.method)
      )) {
        return reply.code(409).send({
          code: 'SHIPMENT_IN_CONTAINER',
          message: 'Извлеките отправление из ёмкости перед изменением массы или маршрута.',
        });
      }
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
        if (key in req.body && req.body[key] !== undefined && req.body[key] !== s[key]) {
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
      s.status = s.containerId ? 'placed' : 'verified';
      s.verifiedAt = new Date().toISOString();
      saveSessionChange();
      return withDispatchDetails(s);
    }
  );

  app.post<{ Params: { barcode: string } }>('/api/shipments/:barcode/verify', async (req, reply) => {
    const s = getState().shipments[req.params.barcode];
    if (!s) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Не найдено' });
    s.status = s.containerId ? 'placed' : 'verified';
    s.verifiedAt = new Date().toISOString();
    addAudit({ entityType: 'shipment', entityId: s.barcode, action: 'verified' });
    saveSessionChange();
    return withDispatchDetails(s);
  });

  app.post<{ Body: { barcode: string } }>('/api/containers/assign', async (req, reply) => {
    const barcode = (req.body?.barcode || '').trim();
    if (!barcode) return reply.code(400).send({ code: 'EMPTY', message: 'Укажите barcode' });
    const result = assignShipment(barcode, requestTripId(req));
    if (!result.ok) {
      return reply.code(result.errorCode === 'NOT_FOUND' ? 404 : 409).send(result);
    }
    saveSessionChange();
    return result;
  });

  app.post<{ Body: { barcode: string; containerId?: string } }>('/api/containers/remove-shipment', async (req, reply) => {
    const result = removeFromContainer((req.body?.barcode || '').trim(), req.body?.containerId);
    if (!result.ok) return reply.code(409).send(result);
    saveSessionChange();
    return result;
  });

  type Transfer = { barcode: string; fromId: string; toId?: string };
  app.get<{ Querystring: Transfer }>('/api/containers/transfer-targets', async (req) => {
    const { barcode, fromId } = req.query;
    return { items: transferTargets(barcode, fromId) };
  });

  app.post<{ Body: Transfer }>('/api/containers/transfer-shipment', async (req, reply) => {
    const { barcode, fromId, toId } = req.body ?? {};
    if (typeof barcode !== 'string' || !barcode || typeof fromId !== 'string' || !fromId ||
      (toId !== undefined && (typeof toId !== 'string' || !toId))) {
      return reply.code(400).send({ code: 'INVALID_TRANSFER', message: 'Укажите отправление и ёмкость.' });
    }
    const result = transferShipment(barcode, fromId, toId);
    if (!result.ok) return reply.code(409).send(result);
    saveSessionChange();
    return result;
  });
}

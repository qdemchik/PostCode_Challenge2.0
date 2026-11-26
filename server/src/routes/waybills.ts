import type { FastifyInstance } from 'fastify';
import { getState, addAudit, saveSessionChange } from '../services/store.js';
import { makeDocumentId } from '../utils/id.js';
import type { DispatchSummary, Waybill } from '../types/index.js';
import { isEligibleForDispatch } from '../services/routing.js';
import { requestTripId } from './trips.js';
import { describeTripPlan } from '../services/tripPlan.js';

export async function waybillRoutes(app: FastifyInstance) {
  app.get('/api/dispatch-summary', async (req): Promise<DispatchSummary> => {
    const state = getState();
    const tripId = requestTripId(req);
    const waybills = Object.values(state.waybills).filter((waybill) => waybill.tripId === tripId);
    const documented = new Set(waybills.filter((waybill) => waybill.status !== 'cancelled').flatMap((waybill) => waybill.containerIds));
    const containers = Object.values(state.containers).filter((container) => container.tripId === tripId && container.shipmentIds.length);
    const closed = containers.filter((container) => container.status === 'closed');
    const reviewCounts: DispatchSummary['reviewCounts'] = {};
    const underReview = new Set<string>();
    for (const item of Object.values(state.reviewQueue)) {
      if (item.resolvedAt) continue;
      underReview.add(item.barcode);
      reviewCounts[item.reason] = (reviewCounts[item.reason] ?? 0) + 1;
    }
    const now = Date.now();
    return {
      waitingBarcodes: Object.values(state.shipments)
        .filter((shipment) => !shipment.containerId && !shipment.plannedTripId && !underReview.has(shipment.barcode) && isEligibleForDispatch(shipment, now))
        .map((shipment) => shipment.barcode),
      reviewCounts,
      openContainerIds: containers.filter((container) => container.status === 'open').map((container) => container.id),
      unprintedLabelIds: closed.filter((container) => !container.labelPrinted).map((container) => container.id),
      undocumentedContainerIds: closed.filter((container) => !documented.has(container.id)).map((container) => container.id),
      unprintedWaybillIds: waybills.filter((waybill) => waybill.status === 'formed' || waybill.status === 'error').map((waybill) => waybill.id),
      unconfirmedWaybillIds: waybills.filter((waybill) => waybill.status === 'printed').map((waybill) => waybill.id),
      tripPlan: tripId ? describeTripPlan(tripId) : undefined,
    };
  });

  app.get('/api/waybills', async (req) => {
    const tripId = requestTripId(req);
    const list = Object.values(getState().waybills).filter((waybill) => waybill.tripId === tripId);
    return { total: list.length, items: list };
  });

  app.get<{ Params: { id: string } }>('/api/waybills/:id', async (req, reply) => {
    const w = getState().waybills[req.params.id];
    if (!w) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Накладная не найдена' });
    const containers = w.cancellation?.containers ?? w.containerIds.map((id) => getState().containers[id]).filter(Boolean);
    return { ...w, containers };
  });

  app.post<{ Params: { id: string }; Body: { reason?: unknown } }>('/api/waybills/:id/cancel', async (req, reply) => {
    const state = getState();
    const waybill = state.waybills[req.params.id];
    if (!waybill) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Накладная не найдена.' });
    if (waybill.status === 'cancelled') return waybill;
    if (waybill.status === 'handed_over') {
      return reply.code(409).send({ code: 'ALREADY_HANDED_OVER', message: 'Накладная уже передана водителю.' });
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason || reason.length > 250) {
      return reply.code(400).send({ code: 'INVALID_REASON', message: 'Укажите причину аннулирования до 250 символов.' });
    }
    const containers = waybill.containerIds.map((id) => state.containers[id]).filter(Boolean);
    waybill.cancellation = { at: new Date().toISOString(), reason, containers: structuredClone(containers) };
    waybill.status = 'cancelled';
    addAudit({ entityType: 'waybill', entityId: waybill.id, action: 'cancelled', newValue: { reason } });
    saveSessionChange();
    return waybill;
  });

  app.post<{ Params: { id: string } }>('/api/waybills/:id/ready', async (req, reply) => {
    const state = getState();
    const waybill = state.waybills[req.params.id];
    if (!waybill) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Накладная не найдена.' });
    if (waybill.status === 'ready_for_dispatch' || waybill.status === 'handed_over') return waybill;
    if (waybill.status !== 'printed') {
      return reply.code(409).send({
        code: 'WAYBILL_NOT_PRINTED',
        message: 'Сначала выполните задание печати накладной.',
      });
    }
    const pending = waybill.containerIds.filter((id) => {
      const container = state.containers[id];
      return container?.status !== 'closed' || !container.labelPrinted;
    });
    if (pending.length) {
      return reply.code(409).send({
        code: 'LABELS_NOT_READY',
        message: `Закройте ёмкости и выполните задания печати ярлыков: ${pending.join(', ')}.`,
      });
    }
    waybill.status = 'ready_for_dispatch';
    waybill.readyAt = new Date().toISOString();
    addAudit({ entityType: 'waybill', entityId: waybill.id, action: 'ready_for_dispatch' });
    saveSessionChange();
    return waybill;
  });

  app.post<{ Params: { id: string }; Body: { containerIds: string[] } }>('/api/waybills/:id/handover', async (req, reply) => {
    const state = getState();
    const waybill = state.waybills[req.params.id];
    if (!waybill) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Накладная не найдена.' });
    if (waybill.status === 'handed_over') return waybill;
    if (waybill.status !== 'ready_for_dispatch') {
      return reply.code(409).send({ code: 'WAYBILL_NOT_READY', message: 'Подтвердите готовность накладной к вывозу.' });
    }
    const scanned = req.body?.containerIds;
    if (!Array.isArray(scanned) || scanned.some((id) => typeof id !== 'string')) {
      return reply.code(400).send({ code: 'INVALID_CONTAINER_IDS', message: 'Передайте список проверенных ёмкостей.' });
    }
    const expected = new Set(waybill.containerIds);
    const scannedIds = new Set(scanned);
    const missing = waybill.containerIds.filter((id) => !scannedIds.has(id));
    const unexpected = [...scannedIds].filter((id) => !expected.has(id));
    if (!expected.size || missing.length || unexpected.length || scannedIds.size !== scanned.length) {
      return reply.code(409).send({
        code: 'HANDOVER_MISMATCH', message: 'Список отсканированных ёмкостей не совпадает с накладной.',
        missing, unexpected,
      });
    }
    if (waybill.containerIds.some((id) => state.containers[id]?.status !== 'closed' || !state.containers[id].labelPrinted)) {
      return reply.code(409).send({ code: 'CONTAINERS_NOT_READY', message: 'Проверьте закрытие ёмкостей и печать ярлыков.' });
    }
    if (waybill.tripId) {
      const plan = describeTripPlan(waybill.tripId);
      if (plan.items.length) {
        const documented = new Set(Object.values(state.waybills)
          .filter((item) => item.tripId === waybill.tripId && item.status !== 'cancelled')
          .flatMap((item) => item.containerIds));
        const outstandingBarcodes = plan.items.filter((item) => !item.containerId || !documented.has(item.containerId))
          .map((item) => item.barcode);
        if (outstandingBarcodes.length || plan.outsidePlanBarcodes.length) {
          return reply.code(409).send({
            code: 'TRIP_PLAN_MISMATCH',
            message: `Сверьте план рейса. Не включены в накладные: ${outstandingBarcodes.length}. Вне плана: ${plan.outsidePlanBarcodes.length}.`,
            outstandingBarcodes, outsidePlanBarcodes: plan.outsidePlanBarcodes,
          });
        }
      }
    }
    waybill.status = 'handed_over';
    waybill.handover = { at: new Date().toISOString(), containerIds: [...waybill.containerIds] };
    addAudit({ entityType: 'waybill', entityId: waybill.id, action: 'handed_over', newValue: waybill.handover });
    saveSessionChange();
    return waybill;
  });

  /** Общая накладная ф.23а на ещё не оформленные закрытые ёмкости. */
  app.post<{ Body: { containerIds?: string[] } }>('/api/waybills', async (req, reply) => {
    const state = getState();
    const tripId = requestTripId(req);
    const requested = req.body?.containerIds;
    if (requested !== undefined && (
      !Array.isArray(requested) || !requested.length ||
      requested.some((id) => typeof id !== 'string' || !id) ||
      new Set(requested).size !== requested.length
    )) {
      return reply.code(400).send({ code: 'INVALID_CONTAINER_IDS', message: 'Выберите ёмкости для накладной.' });
    }
    const closed = Object.values(state.containers).filter((c) => c.tripId === tripId && c.status === 'closed');
    if (closed.length === 0 && requested === undefined) {
      return {
        ok: false,
        errorCode: 'NO_CLOSED',
        message: 'Нет закрытых ёмкостей для формирования накладной',
        actionHint: 'Закройте ёмкости перед формированием ф.23а.',
      };
    }

    const history = Object.values(state.waybills);
    const documented = new Set(history.filter((w) => w.status !== 'cancelled').flatMap((w) => w.containerIds));
    const available = new Set(closed.filter((container) => !documented.has(container.id)).map((container) => container.id));
    const selected = requested ?? [...available];
    const unavailable = selected.filter((id) => !available.has(id));
    if (unavailable.length) {
      return reply.code(409).send({
        code: 'CONTAINERS_UNAVAILABLE',
        message: `Ёмкости уже оформлены или недоступны: ${unavailable.join(', ')}. Обновите сводку.`,
      });
    }
    const list = selected.map((id) => state.containers[id]);
    if (!list.length) return { ok: true, waybills: [] };

    const directionIds = [...new Set(list.map((c) => c.waybillDirectionId || c.directionId))].sort();
    const id = makeDocumentId('114000', [...Object.keys(state.containers), ...Object.keys(state.waybills)]);
    const waybill: Waybill = {
      id,
      tripId,
      directionId: directionIds[0],
      directionIds,
      containerIds: list.map((c) => c.id),
      replacesWaybillIds: history.filter((w) => w.status === 'cancelled' && w.containerIds.some((id) => selected.includes(id))).map((w) => w.id),
      status: 'formed',
      createdAt: new Date().toISOString(),
      opsIndex: '114000',
      totalContainers: list.length,
      totalShipments: list.reduce((sum, c) => sum + c.shipmentIds.length, 0),
      totalWeightGrams: list.reduce((sum, c) => sum + c.totalWeightGrams, 0),
    };
    state.waybills[id] = waybill;
    addAudit({ entityType: 'waybill', entityId: id, action: 'formed' });
    saveSessionChange();
    return { ok: true, waybills: [waybill] };
  });
}

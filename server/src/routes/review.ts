import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { reviewReasons, type ReviewItem } from '../types/index.js';
import { addAudit, getState, saveSessionChange } from '../services/store.js';
import { resolveReview } from '../services/review.js';
import { validateBarcode } from '../utils/barcode.js';

const request = z.object({
  barcode: z.string().trim().toUpperCase().refine((barcode) => validateBarcode(barcode).ok),
  reason: z.enum(reviewReasons),
});

export async function reviewRoutes(app: FastifyInstance) {
  app.get('/api/review', async () => {
    const items = Object.values(getState().reviewQueue).sort((a, b) => b.deferredAt.localeCompare(a.deferredAt));
    return { items };
  });

  app.post('/api/review', async (req, reply) => {
    const parsed = request.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ code: 'INVALID_REVIEW', message: 'Проверьте ШПИ и причину разбора.' });
    const { barcode, reason } = parsed.data;
    const state = getState();
    if (state.shipments[barcode]?.containerId) {
      return reply.code(409).send({ code: 'ALREADY_PLACED', message: 'Отправление уже вложено в ёмкость.' });
    }
    const previous = state.reviewQueue[barcode];
    if (previous && !previous.resolvedAt && previous.reason === reason) return previous;
    const item: ReviewItem = { barcode, reason, deferredAt: previous && !previous.resolvedAt ? previous.deferredAt : new Date().toISOString() };
    state.reviewQueue[barcode] = item;
    addAudit({ entityType: 'shipment', entityId: barcode, action: 'review_deferred', newValue: { reason } });
    saveSessionChange();
    return item;
  });

  app.post<{ Params: { barcode: string } }>('/api/review/:barcode/dismiss', async (req, reply) => {
    const item = getState().reviewQueue[req.params.barcode];
    if (!item) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Запись разбора не найдена.' });
    if (resolveReview(item.barcode, 'dismissed')) saveSessionChange();
    return item;
  });
}

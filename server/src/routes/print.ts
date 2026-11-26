import type { FastifyInstance } from 'fastify';
import { getState, addAudit, saveSessionChange } from '../services/store.js';
import { makeId } from '../utils/id.js';
import type { PrintJob } from '../types/index.js';

function recordPrint(type: PrintJob['type'], entityId: string, source: 'paper' | 'demo' = 'demo') {
  const state = getState();
  const evidence = { source, at: new Date().toISOString() };
  if (type === 'label') {
    const container = state.containers[entityId];
    container.labelPrinted = true;
    if (source === 'paper' || container.labelPrintEvidence?.source !== 'paper') container.labelPrintEvidence = evidence;
  } else {
    const waybill = state.waybills[entityId];
    if (waybill.status !== 'ready_for_dispatch' && waybill.status !== 'handed_over') waybill.status = 'printed';
    waybill.printedAt = evidence.at;
    if (source === 'paper' || waybill.printEvidence?.source !== 'paper') waybill.printEvidence = evidence;
  }
  addAudit({ entityType: type === 'label' ? 'container' : 'waybill', entityId, action: source === 'paper' ? 'paper_print_confirmed' : 'printed' });
}

export async function printRoutes(app: FastifyInstance) {
  app.get('/api/print/jobs', async () => {
    return { items: getState().printJobs };
  });

  app.post<{ Body: { type?: unknown; entityId?: unknown } }>('/api/print/confirm-paper', async (req, reply) => {
    const { type, entityId } = req.body ?? {};
    if ((type !== 'label' && type !== 'waybill') || typeof entityId !== 'string' || !entityId) {
      return reply.code(400).send({ code: 'BAD_REQUEST', message: 'Укажите документ для подтверждения.' });
    }
    const state = getState();
    const entity = type === 'label' ? state.containers[entityId] : state.waybills[entityId];
    if (!entity) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Документ не найден.' });
    if (type === 'waybill' && state.waybills[entityId].status === 'cancelled') {
      return reply.code(409).send({ code: 'WAYBILL_CANCELLED', message: 'Накладная аннулирована.' });
    }
    if (type === 'label' && state.containers[entityId].status !== 'closed') {
      return reply.code(409).send({ code: 'CONTAINER_OPEN', message: 'Закройте ёмкость перед подтверждением ярлыка.' });
    }
    recordPrint(type, entityId, 'paper');
    saveSessionChange();
    return { ok: true };
  });

  app.post<{ Body: { type: 'label' | 'waybill'; entityId: string } }>(
    '/api/print/jobs',
    async (req, reply) => {
      const { type, entityId } = req.body || ({} as any);
      if ((type !== 'label' && type !== 'waybill') || typeof entityId !== 'string' || !entityId) {
        return reply.code(400).send({ code: 'BAD_REQUEST', message: 'type и entityId обязательны' });
      }
      const state = getState();
      const entity = type === 'label' ? state.containers[entityId] : state.waybills[entityId];
      if (!entity) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Документ не найден.' });
      if (type === 'waybill' && state.waybills[entityId].status === 'cancelled') {
        return reply.code(409).send({ code: 'WAYBILL_CANCELLED', message: 'Накладная аннулирована.' });
      }
      if (type === 'label' && state.containers[entityId].status !== 'closed') {
        return reply.code(409).send({ code: 'CONTAINER_OPEN', message: 'Закройте ёмкость перед печатью ярлыка.' });
      }
      const job: PrintJob = {
        id: makeId('print'),
        type,
        entityId,
        status: 'queued',
        createdAt: new Date().toISOString(),
        retries: 0,
      };

      if (state.demoFlags.printerError) {
        job.status = 'error';
        job.errorMessage = 'Принтер недоступен (демо-режим). Проверьте подключение или смените принтер.';
        job.finishedAt = new Date().toISOString();
        state.printJobs.unshift(job);
        saveSessionChange();
        return reply.code(503).send({
          ok: false,
          job,
          code: 'PRINTER_ERROR',
          message: job.errorMessage,
          actionHint: 'Повторите печать, смените принтер или сохраните PDF.',
        });
      }

      // успех
      job.status = 'done';
      job.finishedAt = new Date().toISOString();
      state.printJobs.unshift(job);

      recordPrint(type, entityId);
      saveSessionChange();

      return { ok: true, job };
    }
  );

  app.post<{ Params: { id: string } }>('/api/print/jobs/:id/retry', async (req, reply) => {
    const state = getState();
    const job = state.printJobs.find((j) => j.id === req.params.id);
    if (!job) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Задание не найдено' });
    if (job.type === 'label' && state.containers[job.entityId]?.status !== 'closed') {
      return reply.code(409).send({ code: 'CONTAINER_OPEN', message: 'Закройте ёмкость перед повтором печати.' });
    }
    if (job.type === 'waybill' && !state.waybills[job.entityId]) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Накладная не найдена.' });
    }
    if (job.type === 'waybill' && state.waybills[job.entityId].status === 'cancelled') {
      return reply.code(409).send({ code: 'WAYBILL_CANCELLED', message: 'Накладная аннулирована.' });
    }

    if (state.demoFlags.printerError) {
      job.retries += 1;
      job.status = 'error';
      job.errorMessage = 'Принтер по-прежнему недоступен (демо).';
      saveSessionChange();
      return reply.code(503).send({
        ok: false,
        job,
        code: 'PRINTER_ERROR',
        message: job.errorMessage,
        actionHint: 'Отключите ошибку принтера в демо-панели или сохраните PDF.',
      });
    }

    job.status = 'done';
    job.finishedAt = new Date().toISOString();
    job.retries += 1;
    job.errorMessage = undefined;

    recordPrint(job.type, job.entityId);
    saveSessionChange();
    return { ok: true, job };
  });
}

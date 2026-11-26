import type { FastifyInstance } from 'fastify';
import { getState, addAudit } from '../services/store.js';
import { makeId } from '../utils/id.js';
import type { PrintJob } from '../types/index.js';

export async function printRoutes(app: FastifyInstance) {
  app.get('/api/print/jobs', async () => {
    return { items: getState().printJobs };
  });

  app.post<{ Body: { type: 'label' | 'waybill'; entityId: string } }>(
    '/api/print/jobs',
    async (req, reply) => {
      const { type, entityId } = req.body || ({} as any);
      if (!type || !entityId) {
        return reply.code(400).send({ code: 'BAD_REQUEST', message: 'type и entityId обязательны' });
      }
      const state = getState();
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

      if (type === 'label') {
        const c = state.containers[entityId];
        if (c) c.labelPrinted = true;
      } else if (type === 'waybill') {
        const w = state.waybills[entityId];
        if (w) {
          w.status = 'printed';
          w.printedAt = new Date().toISOString();
        }
      }

      addAudit({
        entityType: type === 'label' ? 'container' : 'waybill',
        entityId,
        action: 'printed',
      });

      return { ok: true, job };
    }
  );

  app.post<{ Params: { id: string } }>('/api/print/jobs/:id/retry', async (req, reply) => {
    const state = getState();
    const job = state.printJobs.find((j) => j.id === req.params.id);
    if (!job) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Задание не найдено' });

    if (state.demoFlags.printerError) {
      job.retries += 1;
      job.status = 'error';
      job.errorMessage = 'Принтер по-прежнему недоступен (демо).';
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

    if (job.type === 'label') {
      const c = state.containers[job.entityId];
      if (c) c.labelPrinted = true;
    } else {
      const w = state.waybills[job.entityId];
      if (w) {
        w.status = 'printed';
        w.printedAt = new Date().toISOString();
      }
    }
    return { ok: true, job };
  });
}

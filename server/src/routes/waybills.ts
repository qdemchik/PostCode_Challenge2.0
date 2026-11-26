import type { FastifyInstance } from 'fastify';
import { getState, addAudit } from '../services/store.js';
import { makeDocumentId } from '../utils/id.js';
import type { Waybill } from '../types/index.js';

export async function waybillRoutes(app: FastifyInstance) {
  app.get('/api/waybills', async () => {
    const list = Object.values(getState().waybills);
    return { total: list.length, items: list };
  });

  app.get<{ Params: { id: string } }>('/api/waybills/:id', async (req, reply) => {
    const w = getState().waybills[req.params.id];
    if (!w) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Накладная не найдена' });
    const containers = w.containerIds.map((id) => getState().containers[id]).filter(Boolean);
    return { ...w, containers };
  });

  /** Сформировать накладные ф.23а по закрытым ёмкостям, сгруппированным по directionWaybill */
  app.post('/api/waybills', async () => {
    const state = getState();
    const closed = Object.values(state.containers).filter((c) => c.status === 'closed');
    if (closed.length === 0) {
      return {
        ok: false,
        errorCode: 'NO_CLOSED',
        message: 'Нет закрытых ёмкостей для формирования накладной',
        actionHint: 'Закройте ёмкости перед формированием ф.23а.',
      };
    }

    const byDir = new Map<string, typeof closed>();
    for (const c of closed) {
      const key = c.waybillDirectionId || c.directionId;
      if (!byDir.has(key)) byDir.set(key, []);
      byDir.get(key)!.push(c);
    }

    const created: Waybill[] = [];
    for (const [dir, list] of byDir) {
      // не создавать повторно, если ёмкости уже в какой-то накладной
      const already = list.every((c) =>
        Object.values(state.waybills).some((w) => w.containerIds.includes(c.id))
      );
      if (already) continue;

      const id = makeDocumentId('114000');
      const totalShipments = list.reduce((s, c) => s + c.shipmentIds.length, 0);
      const totalWeight = list.reduce((s, c) => s + c.totalWeightGrams, 0);
      const w: Waybill = {
        id,
        directionId: dir,
        containerIds: list.map((c) => c.id),
        status: 'formed',
        createdAt: new Date().toISOString(),
        opsIndex: '114000',
        totalContainers: list.length,
        totalShipments,
        totalWeightGrams: totalWeight,
      };
      state.waybills[id] = w;
      created.push(w);
      addAudit({ entityType: 'waybill', entityId: id, action: 'formed' });
    }

    return { ok: true, waybills: created };
  });
}

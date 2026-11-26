import type { FastifyInstance } from 'fastify';
import { getState, initSession, persistSession, restoreSession } from '../services/store.js';
import { preAssignContainers } from '../services/assignment.js';

export async function demoRoutes(app: FastifyInstance) {
  app.get('/api/demo/flags', async () => getState().demoFlags);

  app.post<{ Body: { printerError?: boolean; sourceDown?: boolean } }>(
    '/api/demo/toggle-error',
    async (req) => {
      const flags = getState().demoFlags;
      if (typeof req.body?.printerError === 'boolean') flags.printerError = req.body.printerError;
      if (typeof req.body?.sourceDown === 'boolean') flags.sourceDown = req.body.sourceDown;
      return flags;
    }
  );

  app.post('/api/demo/reset', async () => {
    initSession(false);
    const pre = preAssignContainers();
    persistSession();
    return { ok: true, preAssign: pre, shipments: Object.keys(getState().shipments).length };
  });

  app.post('/api/demo/persist', async () => {
    persistSession();
    return { ok: true };
  });

  app.post('/api/demo/restore', async () => {
    const ok = restoreSession();
    return { ok };
  });

  app.get('/api/stats', async () => {
    const s = getState();
    const shipments = Object.values(s.shipments);
    return {
      total: shipments.length,
      eligible: shipments.filter((x) => x.isEligibleForDispatch).length,
      pending: shipments.filter((x) => x.status === 'pending').length,
      found: shipments.filter((x) => x.status === 'found').length,
      verified: shipments.filter((x) => x.status === 'verified').length,
      placed: shipments.filter((x) => x.status === 'placed').length,
      error: shipments.filter((x) => x.status === 'error').length,
      containersOpen: Object.values(s.containers).filter((c) => c.status === 'open').length,
      containersClosed: Object.values(s.containers).filter((c) => c.status === 'closed').length,
      waybills: Object.keys(s.waybills).length,
    };
  });

  app.get('/api/audit', async (req) => {
    const q = req.query as { entityId?: string; limit?: string };
    let list = getState().audit;
    if (q.entityId) list = list.filter((a) => a.entityId === q.entityId);
    return { items: list.slice(0, Number(q.limit) || 100) };
  });

  app.get('/api/search', async (req) => {
    const q = (req.query as { q?: string; type?: string }).q?.trim().toLowerCase() || '';
    const type = (req.query as { type?: string }).type || 'all';
    const state = getState();
    const result: { shipments: unknown[]; containers: unknown[]; waybills: unknown[] } = {
      shipments: [],
      containers: [],
      waybills: [],
    };
    if (!q) return result;
    if (type === 'all' || type === 'shipment') {
      result.shipments = Object.values(state.shipments)
        .filter(
          (s) =>
            s.barcode.toLowerCase().includes(q) ||
            s.recipientName.toLowerCase().includes(q) ||
            String(s.destinationIndex).includes(q)
        )
        .slice(0, 50);
    }
    if (type === 'all' || type === 'container') {
      result.containers = Object.values(state.containers)
        .filter((c) => c.id.includes(q) || c.directionId.includes(q))
        .slice(0, 50);
    }
    if (type === 'all' || type === 'waybill') {
      result.waybills = Object.values(state.waybills)
        .filter((w) => w.id.includes(q) || w.directionId.includes(q))
        .slice(0, 50);
    }
    return result;
  });
}

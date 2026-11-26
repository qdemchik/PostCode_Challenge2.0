import type { FastifyInstance } from 'fastify';
import { getState, initSession, persistSession, restoreSession, saveSessionChange } from '../services/store.js';
import { preAssignContainers } from '../services/assignment.js';
import { isEligibleForDispatch } from '../services/routing.js';
import { requestTripId } from './trips.js';

const opsDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' });

export async function demoRoutes(app: FastifyInstance) {
  app.get('/api/demo/flags', async () => getState().demoFlags);

  app.post<{ Body: { printerError?: boolean; sourceDown?: boolean } }>(
    '/api/demo/toggle-error',
    async (req) => {
      const flags = getState().demoFlags;
      if (typeof req.body?.printerError === 'boolean') flags.printerError = req.body.printerError;
      if (typeof req.body?.sourceDown === 'boolean') flags.sourceDown = req.body.sourceDown;
      saveSessionChange();
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

  app.get('/api/stats', async (req) => {
    const s = getState();
    const tripId = requestTripId(req);
    const shipments = Object.values(s.shipments);
    const containers = Object.values(s.containers).filter((container) => container.tripId === tripId);
    return {
      total: shipments.length,
      eligible: shipments.filter((shipment) => isEligibleForDispatch(shipment)).length,
      pending: shipments.filter((x) => x.status === 'pending').length,
      found: shipments.filter((x) => x.status === 'found').length,
      verified: shipments.filter((x) => x.status === 'verified').length,
      placed: shipments.filter((x) => x.status === 'placed').length,
      error: shipments.filter((x) => x.status === 'error').length,
      containersOpen: containers.filter((c) => c.status === 'open').length,
      containersClosed: containers.filter((c) => c.status === 'closed').length,
      waybills: Object.values(s.waybills).filter((waybill) => waybill.tripId === tripId && waybill.status !== 'cancelled').length,
    };
  });

  app.get('/api/audit', async (req) => {
    const q = req.query as { entityId?: string; limit?: string };
    let list = getState().audit;
    if (q.entityId) list = list.filter((a) => a.entityId === q.entityId);
    return { items: list.slice(0, Number(q.limit) || 100) };
  });

  app.get<{ Querystring: { q?: string; type?: string; date?: string; direction?: string } }>(
    '/api/search',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            type: { type: 'string', enum: ['all', 'shipment', 'container', 'waybill'] },
            date: { type: 'string', format: 'date' },
            direction: { type: 'string' },
          },
        },
      },
    },
    async (req) => {
      const { type = 'all', date, direction } = req.query;
      const q = req.query.q?.trim().toLowerCase() || '';
      const directionId = direction?.trim();
      const state = getState();
      const result: { shipments: unknown[]; containers: unknown[]; waybills: unknown[] } = {
        shipments: [],
        containers: [],
        waybills: [],
      };
      if (!q && !date && !directionId) return result;
      const matchesDate = (createdAt: string) => !date || opsDate.format(new Date(createdAt)) === date;
      if (q && !date && !directionId && (type === 'all' || type === 'shipment')) {
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
          .filter((c) =>
            matchesDate(c.createdAt) &&
            (!directionId || c.directionId === directionId || c.waybillDirectionId === directionId) &&
            [c.id, c.directionId, c.packagingNumber, c.sealNumber].some((value) => value?.toLowerCase().includes(q))
          )
          .slice(0, 50);
      }
      if (type === 'all' || type === 'waybill') {
        result.waybills = Object.values(state.waybills)
          .filter((w) => {
            const directions = w.directionIds ?? [w.directionId];
            return matchesDate(w.createdAt) &&
              (!directionId || directions.includes(directionId)) &&
              (w.id.includes(q) || directions.some((id) => id.includes(q)));
          })
          .slice(0, 50);
      }
      return result;
    }
  );
}

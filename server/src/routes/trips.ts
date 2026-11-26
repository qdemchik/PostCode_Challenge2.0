import type { FastifyInstance, FastifyRequest } from 'fastify';
import { addAudit, getState, saveSessionChange } from '../services/store.js';
import { makeId } from '../utils/id.js';
import { describeTripPlan } from '../services/tripPlan.js';

export function requestTripId(req: FastifyRequest): string | undefined {
  const id = req.headers['x-postcode-trip'];
  if (id === undefined) return undefined;
  if (typeof id !== 'string' || !Object.hasOwn(getState().trips, id)) {
    throw Object.assign(new Error('Рейс не найден. Обновите список рейсов.'), {
      statusCode: 404, code: 'TRIP_NOT_FOUND',
    });
  }
  return id;
}

export async function tripRoutes(app: FastifyInstance) {
  app.get('/api/trips', async () => ({
    items: Object.values(getState().trips).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  }));

  app.get('/api/trip-plan', async (req, reply) => {
    const tripId = requestTripId(req);
    if (!tripId) return reply.code(400).send({ code: 'TRIP_REQUIRED', message: 'Выберите рабочий рейс.' });
    return describeTripPlan(tripId);
  });

  app.put<{ Params: { barcode: string }; Body: { included?: unknown } }>('/api/trip-plan/:barcode', async (req, reply) => {
    const tripId = requestTripId(req);
    if (!tripId) return reply.code(400).send({ code: 'TRIP_REQUIRED', message: 'Выберите рабочий рейс.' });
    const included = req.body?.included;
    if (typeof included !== 'boolean') return reply.code(400).send({ code: 'INVALID_PLAN_ACTION', message: 'Укажите действие с планом.' });
    const state = getState();
    const barcode = req.params.barcode.trim().toUpperCase();
    const shipment = Object.hasOwn(state.shipments, barcode) ? state.shipments[barcode] : undefined;
    if (!shipment) return reply.code(404).send({ code: 'NOT_FOUND', message: 'Отправление по этому ШПИ не найдено.' });
    if (shipment.plannedTripId && shipment.plannedTripId !== tripId) {
      return reply.code(409).send({
        code: 'OTHER_TRIP',
        message: `Отправление запланировано на рейс «${state.trips[shipment.plannedTripId]?.name ?? shipment.plannedTripId}».`,
      });
    }
    const container = shipment.containerId ? state.containers[shipment.containerId] : undefined;
    if (shipment.containerId && (container?.tripId !== tripId || !included)) {
      return reply.code(409).send({
        code: 'SHIPMENT_IN_CONTAINER',
        message: 'Сначала извлеките отправление из текущей ёмкости.',
      });
    }
    const next = included ? tripId : undefined;
    if (shipment.plannedTripId !== next) {
      addAudit({ entityType: 'shipment', entityId: barcode, action: included ? 'trip_planned' : 'trip_unplanned',
        oldValue: shipment.plannedTripId, newValue: next });
      shipment.plannedTripId = next;
      shipment.preAssignedContainerId = null;
      saveSessionChange();
    }
    return describeTripPlan(tripId);
  });

  app.post<{ Body: { name?: unknown } }>('/api/trips', async (req, reply) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 80) {
      return reply.code(400).send({ code: 'INVALID_TRIP_NAME', message: 'Укажите название рейса до 80 символов.' });
    }
    const trip = { id: makeId('trip'), name, createdAt: new Date().toISOString() };
    getState().trips[trip.id] = trip;
    saveSessionChange();
    return reply.code(201).send(trip);
  });
}

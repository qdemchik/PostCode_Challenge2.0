import { mkdtempSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { containerRoutes } from '../src/routes/containers.js';
import { demoRoutes } from '../src/routes/demo.js';
import { printRoutes } from '../src/routes/print.js';
import { reviewRoutes } from '../src/routes/review.js';
import { shipmentRoutes } from '../src/routes/shipments.js';
import { tripRoutes } from '../src/routes/trips.js';
import { waybillRoutes } from '../src/routes/waybills.js';
import { enableSessionAutosave, getState, initSession, persistSession, restoreSession } from '../src/services/store.js';

const barcode = 'IN261116000001';
let app: ReturnType<typeof Fastify>;
let directory: string;
let path: string;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'postcode-session-'));
  path = join(directory, 'session.json');
  initSession(false);
  enableSessionAutosave(path);
  persistSession();
  app = Fastify();
  await shipmentRoutes(app);
  await containerRoutes(app);
  await waybillRoutes(app);
  await printRoutes(app);
  await demoRoutes(app);
  await reviewRoutes(app);
  await tripRoutes(app);
});

afterEach(async () => {
  await app.close();
  unlinkSync(path);
  rmdirSync(directory);
});

const assign = () => app.inject({
  method: 'POST', url: '/api/containers/assign', payload: { barcode },
});

test('рейс и привязка ёмкости восстанавливаются из сессии', async () => {
  const created = await app.inject({ method: 'POST', url: '/api/trips', payload: { name: 'Утренний' } });
  expect(created.statusCode).toBe(201);
  const trip = created.json();
  const placed = await app.inject({
    method: 'POST', url: '/api/containers/assign',
    headers: { 'x-postcode-trip': trip.id }, payload: { barcode },
  });
  expect(placed.statusCode).toBe(200);
  initSession(false);
  expect(restoreSession()).toBe(true);
  expect(getState().trips[trip.id].name).toBe('Утренний');
  expect(getState().containers[placed.json().container.id].tripId).toBe(trip.id);
});

test('очередь переживает восстановление, а повторное вложение из разбора завершает запись', async () => {
  const defer = (code: string, reason: string) => app.inject({
    method: 'POST', url: '/api/review', payload: { barcode: code, reason },
  });
  const missing = 'IN000000000000';
  expect((await defer('???', 'NOT_FOUND')).statusCode).toBe(400);
  const queued = await defer(missing, 'NOT_FOUND');
  expect(queued.statusCode).toBe(200);
  expect((await defer(missing, 'NOT_FOUND')).json()).toEqual(queued.json());
  expect((await defer(barcode, 'SOURCE_DOWN')).statusCode).toBe(200);

  initSession(false);
  expect(restoreSession()).toBe(true);
  expect(Object.keys(getState().reviewQueue).sort()).toEqual([missing, barcode]);
  const summary = (await app.inject({ method: 'GET', url: '/api/dispatch-summary' })).json();
  expect(summary.reviewCounts).toEqual({ NOT_FOUND: 1, SOURCE_DOWN: 1 });
  expect(summary.waitingBarcodes).not.toContain(barcode);
  expect((await assign()).statusCode).toBe(200);
  expect((await defer(barcode, 'OVERWEIGHT')).statusCode).toBe(409);
  const dismiss = await app.inject({ method: 'POST', url: `/api/review/${missing}/dismiss` });
  expect(dismiss.json()).toMatchObject({ resolution: 'dismissed', resolvedAt: expect.any(String) });

  initSession(false);
  expect(restoreSession()).toBe(true);
  expect(getState().reviewQueue[barcode]).toMatchObject({ resolution: 'assigned', resolvedAt: expect.any(String) });
  expect(getState().reviewQueue[missing].resolution).toBe('dismissed');
});

test('восстанавливает вложения, историю печати и готовность к вывозу', async () => {
  const assigned = await assign();
  expect(assigned.statusCode).toBe(200);
  const containerId = assigned.json().container.id;
  await app.inject({ method: 'POST', url: `/api/containers/${containerId}/close` });
  const formed = await app.inject({ method: 'POST', url: '/api/waybills' });
  const waybillId = formed.json().waybills[0].id;
  const print = (type: 'label' | 'waybill', entityId: string) => app.inject({
    method: 'POST', url: '/api/print/jobs', payload: { type, entityId },
  });
  await app.inject({ method: 'POST', url: '/api/demo/toggle-error', payload: { printerError: true } });
  expect((await print('label', containerId)).statusCode).toBe(503);
  initSession(false);
  expect(restoreSession()).toBe(true);
  expect(getState().printJobs[0].status).toBe('error');

  await app.inject({ method: 'POST', url: '/api/demo/toggle-error', payload: { printerError: false } });
  expect((await print('label', containerId)).statusCode).toBe(200);
  expect((await print('waybill', waybillId)).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: `/api/waybills/${waybillId}/ready` })).statusCode).toBe(200);

  initSession(false);
  expect(restoreSession()).toBe(true);
  expect(getState().shipments[barcode]).toMatchObject({ status: 'placed', containerId });
  expect(getState().containers[containerId]).toMatchObject({ status: 'closed', labelPrinted: true });
  expect(getState().waybills[waybillId].status).toBe('ready_for_dispatch');
  expect(getState().printJobs.map((job) => job.status)).toEqual(['done', 'done', 'error']);

  const handover = await app.inject({
    method: 'POST', url: `/api/waybills/${waybillId}/handover`, payload: { containerIds: [containerId] },
  });
  expect(handover.statusCode).toBe(200);
  initSession(false);
  expect(restoreSession()).toBe(true);
  expect(getState().waybills[waybillId]).toMatchObject({
    status: 'handed_over', handover: handover.json().handover,
  });
});

test('ошибка записи откатывает операцию, после восстановления доступа её можно повторить', async () => {
  const moved = directory + '-snapshot';
  const before = readFileSync(path, 'utf8');
  renameSync(directory, moved);
  writeFileSync(directory, 'Путь к каталогу временно недоступен');
  try {
    const result = await assign();
    expect(result.statusCode).toBe(503);
    expect(result.json().code).toBe('SESSION_SAVE_FAILED');
    expect(getState().shipments[barcode].containerId).toBeUndefined();
    expect(getState().containers).toEqual({});
    expect(readFileSync(join(moved, 'session.json'), 'utf8')).toBe(before);
  } finally {
    unlinkSync(directory);
    renameSync(moved, directory);
  }
  expect((await assign()).statusCode).toBe(200);
});

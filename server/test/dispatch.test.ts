import Fastify from 'fastify';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { containerRoutes } from '../src/routes/containers.js';
import { demoRoutes } from '../src/routes/demo.js';
import { printRoutes } from '../src/routes/print.js';
import { tripRoutes } from '../src/routes/trips.js';
import { shipmentRoutes } from '../src/routes/shipments.js';
import { waybillRoutes } from '../src/routes/waybills.js';
import { getState, initSession } from '../src/services/store.js';
import { groupOfKind } from '../src/services/assignment.js';

let app: ReturnType<typeof Fastify>;
const barcode = 'IN261116000001';

beforeEach(async () => {
  initSession(false);
  app = Fastify();
  await shipmentRoutes(app);
  await containerRoutes(app);
  await waybillRoutes(app);
  await printRoutes(app);
  await tripRoutes(app);
  await demoRoutes(app);
});

test('накладная готова к вывозу после выполнения заданий печати', async () => {
  const summary = async () => (await app.inject({ method: 'GET', url: '/api/dispatch-summary' })).json();
  expect((await summary()).waitingBarcodes).toContain(barcode);
  const container = await assign(barcode);
  expect((await summary()).waitingBarcodes).not.toContain(barcode);
  expect((await summary()).openContainerIds).toEqual([container.id]);
  await app.inject({ method: 'POST', url: '/api/containers/' + container.id + '/close' });
  expect(await summary()).toMatchObject({
    openContainerIds: [], unprintedLabelIds: [container.id], undocumentedContainerIds: [container.id],
  });
  const formed = await app.inject({ method: 'POST', url: '/api/waybills' });
  const waybill = formed.json().waybills[0];
  expect(await summary()).toMatchObject({ undocumentedContainerIds: [], unprintedWaybillIds: [waybill.id] });
  const ready = () => app.inject({ method: 'POST', url: '/api/waybills/' + waybill.id + '/ready' });
  const print = (type: string, entityId: string) =>
    app.inject({ method: 'POST', url: '/api/print/jobs', payload: { type, entityId } });
  expect((await ready()).json().code).toBe('WAYBILL_NOT_PRINTED');
  expect((await print('waybill', waybill.id)).statusCode).toBe(200);
  expect((await summary()).unconfirmedWaybillIds).toEqual([waybill.id]);
  expect((await ready()).json().code).toBe('LABELS_NOT_READY');
  expect((await print('label', container.id)).statusCode).toBe(200);
  const result = await ready();
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({ status: 'ready_for_dispatch', readyAt: expect.any(String) });
  expect(await summary()).toMatchObject({ unprintedLabelIds: [], unprintedWaybillIds: [], unconfirmedWaybillIds: [] });
  expect((await ready()).json().readyAt).toBe(result.json().readyAt);
  await print('waybill', waybill.id);
  expect(getState().waybills[waybill.id].status).toBe('ready_for_dispatch');
});

test('передача водителю сверяет полный состав и сохраняется при повторной печати', async () => {
  const container = await assign(barcode);
  const paper = (type: string, entityId: string) => app.inject({
    method: 'POST', url: '/api/print/confirm-paper', payload: { type, entityId },
  });
  expect((await paper('label', container.id)).statusCode).toBe(409);
  await app.inject({ method: 'POST', url: '/api/containers/' + container.id + '/close' });
  const formed = await app.inject({ method: 'POST', url: '/api/waybills' });
  const { id } = formed.json().waybills[0];
  const url = '/api/waybills/' + id;
  const handover = (containerIds: string[]) => app.inject({
    method: 'POST', url: url + '/handover', payload: { containerIds },
  });
  expect((await handover([container.id])).json().code).toBe('WAYBILL_NOT_READY');
  expect((await paper('label', container.id)).statusCode).toBe(200);
  expect((await paper('waybill', id)).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: url + '/ready' })).statusCode).toBe(200);
  expect((await handover(['foreign'])).json()).toMatchObject({ missing: [container.id], unexpected: ['foreign'] });
  expect((await handover([container.id, container.id])).statusCode).toBe(409);
  const done = await handover([container.id]);
  expect(done.statusCode).toBe(200);
  expect(done.json()).toMatchObject({
    status: 'handed_over', handover: { at: expect.any(String), containerIds: [container.id] },
  });
  expect((await handover([container.id])).json().handover).toEqual(done.json().handover);
  expect((await paper('waybill', id)).statusCode).toBe(200);
  expect(getState().waybills[id].status).toBe('handed_over');
  const cancelAfterHandover = await app.inject({
    method: 'POST', url: url + '/cancel', payload: { reason: 'Исправить реквизиты' },
  });
  expect(cancelAfterHandover.json().code).toBe('ALREADY_HANDED_OVER');
  const printedAgain = await app.inject({
    method: 'POST', url: '/api/print/jobs', payload: { type: 'waybill', entityId: id },
  });
  expect(printedAgain.statusCode).toBe(200);
  expect(getState().waybills[id].printEvidence?.source).toBe('paper');
  expect(getState().audit.some((item) => item.action === 'paper_print_confirmed')).toBe(true);
});

test('поиск по дате ОПС и направлению возвращает документы без текстового запроса', async () => {
  const container = await assign(barcode);
  await app.inject({ method: 'POST', url: '/api/containers/' + container.id + '/close' });
  const formed = await app.inject({ method: 'POST', url: '/api/waybills' });
  const waybill = formed.json().waybills[0];
  getState().containers[container.id].createdAt = '2026-11-25T22:30:00.000Z';
  getState().waybills[waybill.id].createdAt = '2026-11-25T22:35:00.000Z';
  const url = '/api/search?direction=' + waybill.directionId + '&date=';
  const found = await app.inject({ method: 'GET', url: url + '2026-11-26' });
  expect(found.statusCode).toBe(200);
  expect(found.json().containers.map((item: { id: string }) => item.id)).toEqual([container.id]);
  expect(found.json().waybills.map((item: { id: string }) => item.id)).toEqual([waybill.id]);
  const absent = await app.inject({ method: 'GET', url: url + '2026-11-25' });
  expect(absent.json()).toEqual({ shipments: [], containers: [], waybills: [] });
  expect((await app.inject({ method: 'GET', url: url + 'wrong' })).statusCode).toBe(400);
});

test('ярлык доступен после закрытия, а сбой печати допускает повтор задания', async () => {
  const container = await assign(barcode);
  const url = '/api/containers/' + container.id;
  const print = () => app.inject({
    method: 'POST', url: '/api/print/jobs', payload: { type: 'label', entityId: container.id },
  });
  expect((await print()).statusCode).toBe(409);
  await app.inject({ method: 'PATCH', url, payload: { packagingNumber: 'Т-01', sealNumber: 'П-01' } });
  await app.inject({ method: 'POST', url: url + '/close' });
  const label = await app.inject({ method: 'GET', url: url + '/label' });
  expect(label.json()).toMatchObject({ containerId: container.id, packagingNumber: 'Т-01', sealNumber: 'П-01' });

  getState().demoFlags.printerError = true;
  const failed = await print();
  expect(failed.statusCode).toBe(503);
  expect(getState().containers[container.id].labelPrinted).toBe(false);

  getState().demoFlags.printerError = false;
  const retried = await app.inject({ method: 'POST', url: '/api/print/jobs/' + failed.json().job.id + '/retry' });
  expect(retried.json().job).toMatchObject({ status: 'done', retries: 1 });
  expect(getState().containers[container.id].labelPrinted).toBe(true);
});

afterEach(async () => {
  await app.close();
});

async function assign(code: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/containers/assign',
    payload: { barcode: code },
  });
  expect(response.statusCode).toBe(200);
  return response.json().container;
}

test('проверка и правка не позволяют повторно вложить отправление', async () => {
  const container = await assign(barcode);
  const url = '/api/shipments/' + barcode;
  const verified = await app.inject({ method: 'POST', url: url + '/verify' });
  expect(verified.json().status).toBe('placed');

  const edited = await app.inject({ method: 'PATCH', url, payload: { notes: 'Проверено' } });
  expect(edited.json().status).toBe('placed');

  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/containers/assign',
    payload: { barcode },
  });
  expect(duplicate.statusCode).toBe(409);
  expect(duplicate.json().errorCode).toBe('ALREADY_PLACED');
  expect(getState().containers[container.id].shipmentIds).toEqual([barcode]);
  expect(getState().containers[container.id].totalWeightGrams).toBe(container.totalWeightGrams);
});

test('повторное формирование включает только новые закрытые ёмкости', async () => {
  const first = await assign(barcode);
  const close = (id: string) => app.inject({ method: 'POST', url: `/api/containers/${id}/close` });
  const form = () => app.inject({ method: 'POST', url: '/api/waybills' });
  expect((await close(first.id)).statusCode).toBe(200);
  expect((await form()).json().waybills[0].containerIds).toEqual([first.id]);

  const reopen = await app.inject({ method: 'POST', url: `/api/containers/${first.id}/reopen` });
  expect(reopen.statusCode).toBe(409);

  const nextShipment = Object.values(getState().shipments).find((shipment) =>
    shipment.barcode !== barcode &&
    shipment.isEligibleForDispatch &&
    shipment.directionWaybill === first.waybillDirectionId
  );
  expect(nextShipment).toBeDefined();
  const second = await assign(nextShipment!.barcode);
  expect((await close(second.id)).statusCode).toBe(200);
  expect((await form()).json().waybills[0].containerIds).toEqual([second.id]);
  expect((await form()).json().waybills).toEqual([]);
});

test('одна общая ф.23а объединяет ёмкости разных направлений', async () => {
  const first = await assign(barcode);
  const otherCode = 'IN000000000001';
  const state = getState();
  state.shipments[otherCode] = {
    ...state.shipments[barcode], barcode: otherCode, status: 'pending', containerId: undefined,
    kind: 'Отправление EMS', method: 'Авиа', destinationIndex: 901145,
  };
  const second = await assign(otherCode);
  expect(second.waybillDirectionId).toBe('130211');
  for (const { id } of [first, second]) {
    expect((await app.inject({ method: 'POST', url: `/api/containers/${id}/close` })).statusCode).toBe(200);
  }
  const response = await app.inject({ method: 'POST', url: '/api/waybills' });
  expect(response.json().waybills).toHaveLength(1);
  const waybill = response.json().waybills[0];
  expect(waybill.containerIds).toEqual([first.id, second.id]);
  expect(waybill.directionIds).toEqual([first.waybillDirectionId, second.waybillDirectionId].sort());
  expect(waybill.totalWeightGrams).toBe(first.totalWeightGrams + second.totalWeightGrams);
  for (const direction of waybill.directionIds) {
    const search = await app.inject({ method: 'GET', url: '/api/search?direction=' + direction });
    expect(search.json().waybills.map((item: { id: string }) => item.id)).toEqual([waybill.id]);
  }
});

test('две выбранные партии оформляются без повторного использования ёмкостей', async () => {
  const first = await assign(barcode);
  await app.inject({ method: 'POST', url: `/api/containers/${first.id}/close` });
  const otherCode = 'IN000000000002';
  const state = getState();
  state.shipments[otherCode] = { ...state.shipments[barcode], barcode: otherCode, containerId: undefined, status: 'pending' };
  const second = await assign(otherCode);
  await app.inject({ method: 'POST', url: `/api/containers/${second.id}/close` });
  const form = (containerIds: string[]) => app.inject({
    method: 'POST', url: '/api/waybills', payload: { containerIds },
  });
  expect((await form([second.id])).json().waybills[0].containerIds).toEqual([second.id]);
  const rejected = await form([first.id, second.id]);
  expect(rejected.statusCode).toBe(409);
  expect(Object.keys(state.waybills)).toHaveLength(1);
  expect((await form([first.id])).json().waybills[0].containerIds).toEqual([first.id]);
});

test('рейсы изолируют подбор, перенос, сводку и формирование ф.23а', async () => {
  const create = (name: string) => app.inject({ method: 'POST', url: '/api/trips', payload: { name } });
  const first = (await create('Утренний')).json();
  const second = (await create('Вечерний')).json();
  const scoped = (tripId: string) => ({ 'x-postcode-trip': tripId });
  const otherCode = 'IN000000000002';
  getState().shipments[otherCode] = { ...getState().shipments[barcode], barcode: otherCode };
  const place = (code: string, tripId: string) => app.inject({
    method: 'POST', url: '/api/containers/assign', headers: scoped(tripId), payload: { barcode: code },
  });
  const plan = (code: string, tripId: string, included = true) => app.inject({
    method: 'PUT', url: '/api/trip-plan/' + code, headers: scoped(tripId), payload: { included },
  });
  expect((await plan(barcode, first.id)).json().items).toMatchObject([{ barcode, status: 'waiting' }]);
  expect((await place(barcode, second.id)).json().errorCode).toBe('OTHER_TRIP');
  expect((await plan(barcode, second.id)).json().code).toBe('OTHER_TRIP');
  const waitingCode = 'IN000000000003';
  getState().shipments[waitingCode] = { ...getState().shipments[barcode], barcode: waitingCode, plannedTripId: undefined };
  await plan(waitingCode, first.id);
  const a = (await place(barcode, first.id)).json().container;
  const b = (await place(otherCode, second.id)).json().container;
  expect(a.tripId).toBe(first.id);
  expect(b.tripId).toBe(second.id);
  expect(a.id).not.toBe(b.id);
  const transfer = await app.inject({
    method: 'POST', url: '/api/containers/transfer-shipment',
    payload: { barcode, fromId: a.id, toId: b.id },
  });
  expect(transfer.json().errorCode).toBe('TARGET_UNAVAILABLE');
  const summary = await app.inject({ method: 'GET', url: '/api/dispatch-summary', headers: scoped(first.id) });
  expect(summary.json().openContainerIds).toEqual([a.id]);
  expect(summary.json().tripPlan.items).toMatchObject([
    { barcode, containerId: a.id, status: 'packed' },
    { barcode: waitingCode, status: 'waiting' },
  ]);
  expect(summary.json().waitingBarcodes).not.toContain(waitingCode);
  expect((await app.inject({ method: 'GET', url: '/api/dispatch-summary', headers: scoped('bad') })).statusCode).toBe(404);
  for (const id of [a.id, b.id]) await app.inject({ method: 'POST', url: `/api/containers/${id}/close` });
  const form = (tripId: string, containerIds?: string[]) => app.inject({
    method: 'POST', url: '/api/waybills', headers: scoped(tripId), payload: containerIds ? { containerIds } : undefined,
  });
  expect((await form(first.id, [a.id, b.id])).statusCode).toBe(409);
  const firstWaybill = (await form(first.id)).json().waybills[0];
  expect(firstWaybill).toMatchObject({ tripId: first.id, containerIds: [a.id] });
  expect((await form(second.id)).json().waybills[0]).toMatchObject({ tripId: second.id, containerIds: [b.id] });
  for (const [type, entityId] of [['label', a.id], ['waybill', firstWaybill.id]]) {
    await app.inject({ method: 'POST', url: '/api/print/confirm-paper', payload: { type, entityId } });
  }
  const handoverUrl = '/api/waybills/' + firstWaybill.id;
  expect((await app.inject({ method: 'POST', url: handoverUrl + '/ready' })).statusCode).toBe(200);
  const handover = () => app.inject({ method: 'POST', url: handoverUrl + '/handover', payload: { containerIds: [a.id] } });
  expect((await handover()).json()).toMatchObject({ code: 'TRIP_PLAN_MISMATCH', outstandingBarcodes: [waitingCode] });
  await plan(waitingCode, first.id, false);
  expect((await handover()).json().status).toBe('handed_over');
});

test('аннулированная ф.23а сохраняет старые данные, а новая ссылается на неё', async () => {
  const container = await assign(barcode);
  const url = '/api/containers/' + container.id;
  await app.inject({ method: 'POST', url: url + '/close' });
  const form = async () => (await app.inject({ method: 'POST', url: '/api/waybills' })).json().waybills[0];
  const previous = await form();
  const document = '/api/waybills/' + previous.id;
  const cancelled = await app.inject({ method: 'POST', url: document + '/cancel', payload: { reason: 'Нужно исправить пломбу' } });
  expect(cancelled.json().status).toBe('cancelled');
  const print = await app.inject({
    method: 'POST', url: '/api/print/jobs', payload: { type: 'waybill', entityId: previous.id },
  });
  expect(print.json().code).toBe('WAYBILL_CANCELLED');
  expect((await app.inject({ method: 'POST', url: url + '/reopen' })).statusCode).toBe(200);
  expect((await app.inject({ method: 'PATCH', url, payload: { sealNumber: 'NEW' } })).statusCode).toBe(200);
  await app.inject({ method: 'POST', url: url + '/close' });
  const replacement = await form();
  expect(replacement).toMatchObject({ status: 'formed', replacesWaybillIds: [previous.id] });
  expect(replacement.id).not.toBe(previous.id);
  const old = (await app.inject({ method: 'GET', url: document })).json();
  expect(old.containers[0].sealNumber).toBeUndefined();
});

test('поиск оставляет отправление на проверке, а исправленная масса учитывается при вложении', async () => {
  const url = '/api/shipments/' + barcode;
  const found = await app.inject({ method: 'GET', url });
  expect(found.statusCode).toBe(200);
  expect(found.json().status).toBe('found');
  expect(getState().containers).toEqual({});

  const invalid = await app.inject({ method: 'PATCH', url, payload: { weightGrams: -1 } });
  expect(invalid.statusCode).toBe(400);
  expect(getState().shipments[barcode].weightGrams).toBe(found.json().weightGrams);

  const updated = await app.inject({
    method: 'PATCH',
    url,
    payload: { address: 'Тестовый адрес', weightGrams: 500 },
  });
  expect(updated.statusCode).toBe(200);
  expect(updated.json()).toMatchObject({ status: 'verified', address: 'Тестовый адрес', weightGrams: 500 });
  const container = await assign(barcode);
  expect(container.totalWeightGrams).toBe(container.tareWeightGrams + 500);
});

test('отправление тяжелее лимита не создаёт перегруженную ёмкость', async () => {
  const updated = await app.inject({
    method: 'PATCH',
    url: '/api/shipments/' + barcode,
    payload: { weightGrams: 32_000 },
  });
  expect(updated.statusCode).toBe(200);

  const response = await app.inject({
    method: 'POST',
    url: '/api/containers/assign',
    payload: { barcode },
  });
  expect(response.statusCode).toBe(409);
  expect(response.json().errorCode).toBe('OVERWEIGHT');
  expect(getState().containers).toEqual({});
  expect(getState().shipments[barcode].status).toBe('verified');
});

test('ошибочный ручной ввод и неизвестный ШПИ различаются', async () => {
  const lookup = (code: string) => app.inject({ method: 'GET', url: '/api/shipments/' + code });
  const invalid = await lookup('12345');
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json().code).toBe('INVALID_BARCODE');
  const missing = await lookup('IN000000000000');
  expect(missing.statusCode).toBe(404);
  expect(missing.json().code).toBe('NOT_FOUND');
  expect(getState().containers).toEqual({});
});

test('заполненный мешок и черновик чужого направления пропускаются', async () => {
  const state = getState();
  const shipment = state.shipments[barcode];
  shipment.weightGrams = 6_000;
  const full = await assign(barcode);
  const otherCode = 'IN000000000001';
  state.shipments[otherCode] = {
    ...shipment, barcode: otherCode, containerId: undefined, status: 'pending',
    directionWaybill: '000000',
  };
  const wrongDirection = await assign(otherCode);
  state.containers[wrongDirection.id].waybillDirectionId = '000000';
  Object.assign(state.containers[wrongDirection.id], {
    kind: 'контейнер', packagingModel: 'Стандартный (КПШ)', tareWeightGrams: 110_000,
    totalWeightGrams: 116_000, maxWeightGrams: 500_000,
  });
  const nextCode = 'IN000000000002';
  state.shipments[nextCode] = {
    ...shipment, barcode: nextCode, containerId: undefined, status: 'pending',
    preAssignedContainerId: wrongDirection.id,
  };
  const next = await assign(nextCode);
  expect(next.id).not.toBe(full.id);
  expect(next.id).not.toBe(wrongDirection.id);
  expect(next.waybillDirectionId).toBe(shipment.directionWaybill);
  expect(next.totalWeightGrams).toBe(next.tareWeightGrams + 6_000);
});

test.each([
  { group: 'ПК', limit: 10_000, changes: {} },
  { group: 'EMS', limit: 32_000, changes: { kind: 'Отправление EMS', method: 'Авиа', destinationIndex: 901145 } },
  { group: 'ПК с МПО', limit: 32_000, changes: {
    classification: 'Международная' as const, category: 'Заказное', method: 'Авиа', destinationIndex: 101000, countryCode: 'FR',
  } },
])('мешок $group принимает ровно $limit г брутто и отклоняет превышение на 1 г', async ({ limit, changes }) => {
  const state = getState();
  const fixture = { ...state.shipments[barcode], ...changes, weightGrams: limit - 500 };
  state.shipments[barcode] = fixture;
  const accepted = await assign(barcode);
  expect(accepted).toMatchObject({ kind: 'мешок', packagingModel: 'Брезентовый', totalWeightGrams: limit, maxWeightGrams: limit });
  const extra = 'IN000000000004';
  state.shipments[extra] = { ...fixture, barcode: extra, weightGrams: fixture.weightGrams + 1 };
  const rejected = await app.inject({
    method: 'POST', url: '/api/containers/assign', payload: { barcode: extra },
  });
  expect(rejected.statusCode).toBe(409);
  expect(rejected.json().errorCode).toBe('OVERWEIGHT');
  expect(Object.keys(state.containers)).toEqual([accepted.id]);
});

test('смена вида тары пересчитывает массу, ручной лимит не повышает справочный', async () => {
  const container = await assign(barcode);
  const url = '/api/containers/' + container.id;
  const bag = await app.inject({ method: 'PATCH', url, payload: { maxWeightGrams: 100_000 } });
  expect(bag.json().maxWeightGrams).toBe(10_000);
  const another = await app.inject({ method: 'PATCH', url, payload: {
    kind: 'контейнер', packagingModel: 'Малый (КПС-6)', maxWeightGrams: 500_000,
  } });
  expect(another.statusCode).toBe(200);
  expect(another.json()).toMatchObject({
    tareWeightGrams: 75_000, tareSource: 'reference', totalWeightGrams: 75_000 + getState().shipments[barcode].weightGrams, maxWeightGrams: 500_000,
  });
  const invalid = await app.inject({ method: 'PATCH', url, payload: { packagingModel: 'Авиа' } });
  expect(invalid.statusCode).toBe(400);
  const reference = (await app.inject({ method: 'GET', url: '/api/reference/packaging' })).json();
  expect(reference.packaging['мешок'].models.map((item: { name: string }) => item.name))
    .toEqual(['Брезентовый', 'Авиа', 'Стандартный']);
  expect(reference.packaging['ящик'].models).toContainEqual(
    expect.objectContaining({ name: 'Малый (ЯПМ-М)', available: false }),
  );
});

test('последнее международное вложение нельзя извлечь, если остаток превышает обычный лимит', async () => {
  const state = getState();
  const fixture = { ...state.shipments[barcode], category: 'Заказное', weightGrams: 9_500 };
  state.shipments[barcode] = fixture;
  const domestic = await assign(barcode);
  const international = 'IN000000000005';
  state.shipments[international] = {
    ...fixture, barcode: international, classification: 'Международная', method: 'Авиа',
    destinationIndex: 101000, countryCode: 'FR', weightGrams: 1_000,
  };
  const mixed = await assign(international);
  expect(mixed).toMatchObject({ id: domestic.id, totalWeightGrams: 11_000, maxWeightGrams: 32_000 });
  const anotherDomestic = 'IN000000000006';
  state.shipments[anotherDomestic] = { ...fixture, barcode: anotherDomestic, weightGrams: 1 };
  expect((await assign(anotherDomestic)).id).toBe(mixed.id);
  const remove = (code: string) => app.inject({
    method: 'POST', url: '/api/containers/remove-shipment', payload: { barcode: code, containerId: mixed.id },
  });
  const blocked = await remove(international);
  expect(blocked.statusCode).toBe(409);
  expect(state.shipments[international].containerId).toBe(mixed.id);
  expect((await remove(barcode)).statusCode).toBe(200);
  expect((await remove(international)).json().container.maxWeightGrams).toBe(10_000);
});

test('вложенный мешок учитывается в массе и ф.23а только через внешний контейнер', async () => {
  const child = await assign(barcode);
  const close = (id: string) => app.inject({ method: 'POST', url: `/api/containers/${id}/close` });
  await close(child.id);
  const create = (kind: string) => app.inject({
    method: 'POST', url: '/api/containers', payload: { kind, category: child.category,
      directionId: child.directionId, waybillDirectionId: child.waybillDirectionId },
  });
  const invalid = (await create('ящик')).json();
  const outer = (await create('контейнер')).json();
  const nest = (parentId: string) => app.inject({
    method: 'POST', url: `/api/containers/${parentId}/nest`, payload: { childId: child.id },
  });
  expect((await nest(child.id)).json().errorCode).toBe('INVALID_CONTAINER');
  getState().containers[child.id].childContainerIds = [outer.id];
  expect((await nest(outer.id)).json().errorCode).toBe('INVALID_CONTAINER');
  delete getState().containers[child.id].childContainerIds;
  const parents = await app.inject({ method: 'GET', url: `/api/containers/${child.id}/nest-parents` });
  expect(parents.json().items.map((item: { id: string }) => item.id)).toEqual([outer.id]);
  expect((await nest(invalid.id)).json().errorCode).toBe('INCOMPATIBLE_NESTING');
  expect((await nest(outer.id)).json()).toMatchObject({
    childContainerIds: [child.id], totalWeightGrams: outer.tareWeightGrams + child.totalWeightGrams,
  });
  expect((await app.inject({ method: 'POST', url: `/api/containers/${child.id}/reopen` })).statusCode).toBe(409);
  expect((await close(outer.id)).statusCode).toBe(200);
  const formed = await app.inject({ method: 'POST', url: '/api/waybills' });
  expect(formed.json().waybills[0]).toMatchObject({ containerIds: [outer.id], totalContainers: 1, totalShipments: 1 });
});

test('при закрытии простой ёмкости учитывается измеренная масса и отклоняется перегруз', async () => {
  const container = await assign(barcode);
  const url = '/api/containers/' + container.id;
  const weigh = (measuredWeightGrams: number) => app.inject({
    method: 'POST', url: url + '/close', payload: { measuredWeightGrams },
  });
  expect((await weigh(1_000)).json().code).toBe('INVALID_WEIGHING');
  expect((await app.inject({ method: 'PATCH', url, payload: { category: 'Простая' } })).statusCode).toBe(200);
  expect((await weigh(10_001)).json().code).toBe('OVERWEIGHT');
  expect(getState().containers[container.id].status).toBe('open');
  expect((await weigh(10_000)).json()).toMatchObject({
    status: 'closed', totalWeightGrams: 10_000, measuredWeightGrams: 10_000, weightEvidence: { source: 'manual' },
  });
  const reopened = await app.inject({ method: 'POST', url: url + '/reopen' });
  expect(reopened.json().totalWeightGrams).toBe(container.totalWeightGrams);
  expect(reopened.json().measuredWeightGrams).toBeUndefined();
});

test('весы отклоняют нестабильное показание и перегруз, принятый вес и время попадают на ярлык', async () => {
  getState().shipments[barcode].weightGrams = 9_500;
  const container = await assign(barcode);
  const url = '/api/containers/' + container.id;
  await app.inject({ method: 'PATCH', url, payload: { category: 'Простая' } });
  const settings = (scaleMode: string, scaleErrorGrams: number) => app.inject({
    method: 'POST', url: '/api/demo/toggle-error', payload: { scaleMode, scaleErrorGrams },
  });
  const read = async () => (await app.inject({ method: 'GET', url: '/api/scale/reading?containerId=' + container.id })).json();
  const close = (reading: { ts: string; grams: number }) => app.inject({
    method: 'POST', url: url + '/close',
    payload: { weightSource: 'scale', readingTs: reading.ts, measuredWeightGrams: reading.grams, openNext: true },
  });
  await settings('unstable', 0);
  expect((await close(await read())).json().code).toBe('INVALID_SCALE_READING');
  await settings('stable', 1);
  expect((await close(await read())).json().code).toBe('OVERWEIGHT');
  expect(getState().containers[container.id].status).toBe('open');
  await settings('stable', 0);
  const reading = await read();
  const result = await close(reading);
  expect(result.json()).toMatchObject({ totalWeightGrams: 10_000, weightEvidence: { source: 'scale', at: reading.ts } });
  expect(getState().containers[result.json().nextContainerId].status).toBe('open');
  const label = await app.inject({ method: 'GET', url: url + '/label' });
  expect(label.json().weightEvidence).toEqual({ source: 'scale', at: reading.ts });
});

test('почтовые карточки и бандероль-комплект относятся к группам из справочника', () => {
  expect(groupOfKind('Почтовая карточка')).toBe('ПК');
  expect(groupOfKind('Бандероль-комплект')).toBe('ПО');
  expect(groupOfKind('EMS РТ')).toBe('EMS');
});

test('допуск к отправке пересчитывается по сроку хранения и типу', async () => {
  const shipment = getState().shipments[barcode];
  shipment.origin = 'Приём';
  shipment.storageExpiresAt = new Date(Date.now() + 60_000).toISOString();
  shipment.isEligibleForDispatch = true;
  const lookup = () => app.inject({ method: 'GET', url: '/api/shipments/' + barcode });
  expect((await lookup()).json().isEligibleForDispatch).toBe(false);
  const blocked = await app.inject({
    method: 'POST', url: '/api/containers/assign', payload: { barcode },
  });
  expect(blocked.json().errorCode).toBe('NOT_ELIGIBLE');
  shipment.storageExpiresAt = new Date(Date.now() - 60_000).toISOString();
  shipment.isEligibleForDispatch = false;
  expect((await lookup()).json().isEligibleForDispatch).toBe(true);
  shipment.storageExpiresAt = new Date(Date.now() + 60_000).toISOString();
  for (const origin of ['Досылка почты', 'Возврат'] as const) {
    shipment.origin = origin;
    expect((await lookup()).json().isEligibleForDispatch).toBe(true);
  }
  await assign(barcode);
});

test('правка индекса пересчитывает маршрут, а отсутствующее правило блокирует вложение', async () => {
  const url = '/api/shipments/' + barcode;
  const patch = (destinationIndex: number) => app.inject({
    method: 'PATCH', url, payload: { destinationIndex },
  });
  const blocked = await patch(0);
  expect(blocked.json()).toMatchObject({ directionContainer: '', routingIssue: 'ROUTE_NOT_FOUND' });
  const rejected = await app.inject({ method: 'POST', url: '/api/containers/assign', payload: { barcode } });
  expect(rejected.statusCode).toBe(409);
  expect(rejected.json().errorCode).toBe('ROUTE_NOT_FOUND');
  const corrected = await patch(127381);
  expect(corrected.json()).toMatchObject({ destinationIndex: 127381, directionContainer: '108993' });
  expect((await assign(barcode)).directionId).toBe('108993');
});

test('при конфликтующих правилах отправление остаётся на проверке', async () => {
  const ambiguousBarcode = 'IN261116000219';
  const lookup = await app.inject({ method: 'GET', url: '/api/shipments/' + ambiguousBarcode });
  expect(lookup.json()).toMatchObject({ routingIssue: 'ROUTE_AMBIGUOUS', directionContainer: '' });
  expect(lookup.json().routingDetails.candidates).toHaveLength(2);
  expect(lookup.json().routingDetails.rank).toBe('Без разряда');
  const rejected = await app.inject({
    method: 'POST', url: '/api/containers/assign', payload: { barcode: ambiguousBarcode },
  });
  expect(rejected.statusCode).toBe(409);
  expect(rejected.json().errorCode).toBe('ROUTE_AMBIGUOUS');
  expect(getState().containers).toEqual({});
});

test('перенос меняет обе ёмкости целиком и отклоняет повтор со старым источником', async () => {
  const from = await assign(barcode);
  const transfer = (fromId: string, toId?: string) => app.inject({
    method: 'POST', url: '/api/containers/transfer-shipment', payload: { barcode, fromId, toId },
  });
  const state = getState();
  const weight = state.shipments[barcode].weightGrams;
  const targets = (fromId: string) => app.inject({
    method: 'GET', url: '/api/containers/transfer-targets?barcode=' + barcode + '&fromId=' + fromId,
  });
  expect((await targets(from.id)).json().items).toEqual([]);
  expect((await transfer(from.id, from.id)).statusCode).toBe(409);
  expect(state.containers[from.id].shipmentIds).toEqual([barcode]);
  const moved = await transfer(from.id);
  expect(moved.statusCode).toBe(200);
  const to = moved.json().container;
  expect(state.containers[from.id]).toMatchObject({ shipmentIds: [], totalWeightGrams: from.tareWeightGrams, marks: [] });
  expect(state.containers[to.id]).toMatchObject({ shipmentIds: [barcode], totalWeightGrams: to.tareWeightGrams + weight });
  expect(state.shipments[barcode]).toMatchObject({ status: 'placed', containerId: to.id });
  expect((await transfer(from.id)).json().errorCode).toBe('CONTAINER_CHANGED');
  expect((await targets(to.id)).json().items.map((item: { id: string }) => item.id)).toEqual([from.id]);
  state.containers[from.id].massLimitOverrideGrams = from.tareWeightGrams;
  expect((await transfer(to.id, from.id)).json().errorCode).toBe('TARGET_UNAVAILABLE');
  expect(state.containers[to.id].shipmentIds).toEqual([barcode]);
  delete state.containers[from.id].massLimitOverrideGrams;
  expect((await transfer(to.id, from.id)).statusCode).toBe(200);
  expect(state.audit[0]).toMatchObject({ action: 'transferred', newValue: { containerId: from.id } });
});

test('реквизиты и состав открытой ёмкости меняются с пересчётом массы', async () => {
  const container = await assign(barcode);
  const url = '/api/containers/' + container.id;
  const shipmentWeight = getState().shipments[barcode].weightGrams;
  const rejected = await app.inject({
    method: 'PATCH', url, payload: { maxWeightGrams: 1, packagingNumber: 'Не должно сохраниться' },
  });
  expect(rejected.statusCode).toBe(409);
  expect(getState().containers[container.id].packagingNumber).toBeUndefined();

  const saved = await app.inject({
    method: 'PATCH', url, payload: { tareWeightGrams: 700, packagingNumber: 'Т-01', sealNumber: 'П-01' },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toMatchObject({
    totalWeightGrams: shipmentWeight + 700, packagingNumber: 'Т-01', sealNumber: 'П-01',
  });

  const remove = (containerId: string) => app.inject({
    method: 'POST', url: '/api/containers/remove-shipment', payload: { barcode, containerId },
  });
  expect((await remove('другая ёмкость')).json().errorCode).toBe('CONTAINER_CHANGED');
  await app.inject({ method: 'POST', url: url + '/close' });
  expect((await remove(container.id)).json().errorCode).toBe('CONTAINER_CLOSED');
  const editClosed = await app.inject({ method: 'PATCH', url, payload: { sealNumber: 'П-02' } });
  expect(editClosed.statusCode).toBe(409);
  await app.inject({ method: 'POST', url: url + '/reopen' });
  const removed = await remove(container.id);
  expect(removed.statusCode).toBe(200);
  expect(removed.json().container).toMatchObject({ totalWeightGrams: 700, shipmentIds: [], marks: [] });
  expect(removed.json().shipment.status).toBe('verified');
  expect(getState().shipments[barcode].containerId).toBeUndefined();
});

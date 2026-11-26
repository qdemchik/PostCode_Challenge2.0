import { expect, test } from 'vitest';
import { makeDocumentId } from '../src/utils/id.js';

const nextDayInMoscow = new Date('2026-11-25T21:15:00.000Z');

test('нумерация продолжается в пределах даты ОПС и учитывает сохранённые номера', () => {
  const ids = ['2611251140000030', '2611261150000014', '2611261140000002'];
  expect(makeDocumentId('114000', ids, nextDayInMoscow)).toBe('2611261140000003');
});

test('старый случайный номер 9999 оставляет доступными свободные номера', () => {
  const ids = ['2611261140000001', '2611261140009999'];
  expect(makeDocumentId('114000', ids, nextDayInMoscow)).toBe('2611261140000002');
});

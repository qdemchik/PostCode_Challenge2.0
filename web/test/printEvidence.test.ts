import { expect, test } from 'vitest';
import { printEvidenceLabel } from '../src/printEvidence';

const at = '2026-11-26T15:00:00Z';

test('бумажное подтверждение и демо-печать имеют разные подписи', () => {
  expect(printEvidenceLabel({ source: 'paper', at })).toBe('Бумажный экземпляр подтверждён');
  expect(printEvidenceLabel({ source: 'demo', at })).toBe('Демо-печать выполнена');
});

test('ранее сохранённый статус печати не считается подтверждением бумаги', () => {
  expect(printEvidenceLabel(undefined, true)).toBe('Печать отмечена · источник неизвестен');
  expect(printEvidenceLabel(undefined, false)).toBeUndefined();
});

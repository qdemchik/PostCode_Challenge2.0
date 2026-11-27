import { expect, test } from 'vitest';
import { MockScaleAdapter } from '../src/services/scale.js';
import { toleranceGrams } from '../src/reference/weighing.js';

test('стабильные весы сообщают массу, единицу, разницу и время', () => {
  expect(new MockScaleAdapter('stable', 120).read(3_000)).toMatchObject({
    grams: 3_120, stable: true, unit: 'g', calculatedGrams: 3_000, toleranceGrams: 60, ts: expect.any(String),
  });
});
test('нестабильное показание не считается готовым', () => {
  expect(new MockScaleAdapter('unstable', 0).read(500).stable).toBe(false);
});
test.each([['offline', 'SCALE_OFFLINE', 503], ['overload', 'SCALE_OVERLOAD', 409]] as const)(
  'состояние %s возвращает ошибку с подсказкой', (mode, code, statusCode) => {
    expect(() => new MockScaleAdapter(mode).read(500)).toThrow(expect.objectContaining({ code, statusCode }));
  },
);
test('допуск не меньше 50 г и растёт пропорционально массе', () => {
  expect(toleranceGrams(2_500)).toBe(50);
  expect(toleranceGrams(2_501)).toBeCloseTo(50.02);
});

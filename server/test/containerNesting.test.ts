import { expect, test } from 'vitest';
import type { Container } from '../src/types/index.js';
import { canNestContainer } from '../src/reference/containerNesting.js';

const container = (kind: Container['kind'], category: Container['category']): Container =>
  ({ kind, category } as Container);

test.each(['Заказная', 'Страховая'] as const)('простая в %s требует другую ёмкость нужной категории', (category) => {
  const parent = container('контейнер', category);
  const simple = container('мешок', 'Простая');
  expect(canNestContainer(parent, simple, [])).toBe(false);
  expect(canNestContainer(parent, simple, [container('мешок', 'EMS')])).toBe(false);
  expect(canNestContainer(parent, simple, [container('мешок', category)])).toBe(true);
});

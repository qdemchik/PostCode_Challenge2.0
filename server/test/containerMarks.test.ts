import { expect, test } from 'vitest';
import type { Container, Shipment } from '../src/types/index.js';
import { computeMarks, labelMarks } from '../src/reference/marks.js';

const shipment = (kind: string, classification: Shipment['classification'] = 'Внутренняя'): Shipment =>
  ({ kind, classification } as Shipment);
const bag = { kind: 'мешок', category: 'Заказная', group: 'ПК' } as const satisfies Partial<Container>;
const containerMarks = (context: Parameters<typeof computeMarks>[1], contents: Shipment[]) => computeMarks(contents, context);

test('отметка 1-го класса требует всех вложений соответствующего вида', () => {
  const kinds = [shipment('Трек-письмо 1 класса'), shipment('Бандероль 1-го класса')];
  expect(containerMarks(bag, kinds)).toEqual(['1-й класс']);
  expect(labelMarks(containerMarks(bag, kinds))).toEqual(['1-ый класс']);
  expect(containerMarks(bag, [...kinds, shipment('Письмо')])).toEqual(['Без отметки']);
});

test('EMS сохраняет комбинацию отметок, а простая ёмкость — только с международным вложением', () => {
  const contents = [shipment('EMS оптимальное', 'Международная'), shipment('EMS РТ'), shipment('Бизнес курьер экспресс')];
  expect(containerMarks({ ...bag, category: 'EMS', group: 'EMS' }, contents))
    .toEqual(['Международная', 'ОПТ', 'РТ', 'БК']);
  expect(containerMarks({ ...bag, category: 'Простая', group: 'EMS' }, contents)).toEqual(['Международная']);
});

test('Мешок М имеет особую надпись, а отметка по умолчанию печатается как пустая', () => {
  expect(labelMarks(containerMarks({ ...bag, kind: 'мешок М' }, [shipment('Мешок «М»')])))
    .toEqual(['Мешок "М"']);
  expect(labelMarks(containerMarks(bag, [shipment('Почтовая карточка')]))).toEqual([]);
});

const flagged = (flags: Shipment['markFlags'], kind = 'Письмо', international = false): Shipment => ({
  ...shipment(kind, international ? 'Международная' : 'Внутренняя'), markFlags: flags,
});
const ems = { ...bag, category: 'EMS', group: 'EMS' } as const;
const simple = { ...bag, category: 'Простая' } as const;
test.each([
  ['осторожно', bag, [flagged({ careful: true })], ['Осторожно']],
  ['терморежим', bag, [flagged({ thermal: true })], ['Терморежим']],
  ['комбинация двух отметок', bag, [flagged({ careful: true }), flagged({ thermal: true })], ['Терморежим', 'Осторожно']],
  ['правительственная', bag, [flagged({ government: true })], ['Правительственная']],
  ['правительственная и осторожно', bag, [flagged({ government: true, careful: true })], ['Правительственная', 'Осторожно']],
  ['правительственная исключает М', { ...simple, kind: 'мешок М' }, [flagged({ government: true }, 'Мешок «М»')], ['Правительственная']],
  ['международная исключает М', { ...simple, kind: 'мешок М' }, [flagged({}, 'Мешок «М»', true)], ['Международная']],
  ['SRM без международного', bag, [flagged({ srm: true })], []],
  ['SRM и международное', bag, [flagged({ srm: true }), flagged({}, 'Письмо', true)], ['Международная', 'SRM']],
  ['РТ и терморежим', ems, [flagged({ thermal: true }, 'EMS РТ')], ['РТ', 'Терморежим']],
  ['РТ и осторожно', ems, [flagged({ careful: true }, 'EMS РТ')], ['РТ', 'Осторожно']],
  ['РТ и обе отметки', ems, [flagged({ careful: true, thermal: true }, 'EMS РТ')], ['РТ', 'Осторожно', 'Терморежим']],
  ['РТ и БК', ems, [shipment('EMS РТ'), shipment('Бизнес курьер')], ['РТ', 'БК']],
  ['простая исключает осторожно и терморежим', simple, [flagged({ careful: true, thermal: true })], []],
  ['крупногабаритный не печатается', { ...bag, category: 'Страховая', kind: 'группа РПО' }, [flagged({ oversized: true })], []],
] satisfies [string, Parameters<typeof computeMarks>[1], Shipment[], string[]][])('%s', (_name, context, contents, expected) => {
  expect(labelMarks(computeMarks(contents, context))).toEqual(expected);
});

test('родитель наследует правительственную и международную отметки', () => {
  const child = { marks: ['Правительственная', 'Международная', 'Осторожно'] } as Container;
  expect(computeMarks([], bag, [child])).toEqual(['Правительственная', 'Международная']);
});

test('крупногабаритный виден в карточке страховой группы РПО', () => {
  expect(computeMarks([flagged({ oversized: true })], { ...bag, category: 'Страховая', kind: 'группа РПО' }))
    .toEqual(['Крупногабаритный']);
});

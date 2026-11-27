import type { Container, Shipment, ShipmentMark } from '../types/index.js';

export const shipmentMarkLabels: Record<ShipmentMark, string> = {
  careful: 'Осторожно', thermal: 'Терморежим', oversized: 'Негабаритное',
  government: 'Правительственное', srm: 'SRM',
};
const registered = new Set<Container['category']>(['Заказная', 'Страховая', 'EMS', 'Сборная']);
type Context = Pick<Container, 'kind' | 'category' | 'group'>;
type Facts = { context: Context; isRegistered: boolean; isSimple: boolean; kinds: string[]; flags: Set<ShipmentMark>; international: boolean; government: boolean; hasChildren: boolean };
const rules: Array<[string, (facts: Facts) => boolean]> = [
  ['Правительственная', (f) => f.government],
  ['Международная', (f) => f.international],
  ['SRM', (f) => f.international && f.flags.has('srm')],
  ['Мешок «М»', (f) => f.context.kind === 'мешок М' && (f.isSimple || f.context.category === 'Заказная') &&
    !f.government && !f.international],
  // ДОПУЩЕНИЕ: отдельный класс ёмкости не хранится, проверяем вид всех прямых вложений.
  ['1-й класс', (f) => f.isRegistered && !f.hasChildren && !!f.kinds.length &&
    f.kinds.every((kind) => /(?:^|\s)1(?:-го|-й|-ый)?\s+класс(?:а)?$/.test(kind))],
  // ДОПУЩЕНИЕ: вид вложения EMS представлен группой EMS.
  ['ОПТ', (f) => f.isRegistered && f.context.group === 'EMS' && f.kinds.includes('ems оптимальное')],
  ['РТ', (f) => f.isRegistered && f.context.group === 'EMS' && f.kinds.includes('ems рт')],
  ['БК', (f) => f.isRegistered && f.context.group === 'EMS' &&
    f.kinds.some((kind) => kind === 'бизнес курьер' || kind === 'бизнес курьер экспресс')],
  ['Осторожно', (f) => f.isRegistered && f.flags.has('careful')],
  ['Терморежим', (f) => f.isRegistered && f.flags.has('thermal')],
  ['Крупногабаритный', (f) => f.context.kind === 'группа РПО' && f.context.category === 'Страховая' && f.flags.has('oversized')],
];

export function computeMarks(shipments: readonly Shipment[], context: Context, children: readonly Container[] = []): string[] {
  if (!shipments.length && !children.length) return [];
  const isRegistered = registered.has(context.category);
  const isSimple = context.category === 'Простая';
  const flags = new Set((Object.keys(shipmentMarkLabels) as ShipmentMark[])
    .filter((key) => shipments.some((item) => item.markFlags?.[key])));
  const inherits = (mark: string) => children.some((child) => child.marks.includes(mark));
  const facts: Facts = {
    context, isRegistered, isSimple, flags, hasChildren: !!children.length,
    kinds: shipments.map((shipment) => shipment.kind.trim().toLowerCase().replace(/\s+/g, ' ')),
    international: (isRegistered || isSimple) && (inherits('Международная') || shipments.some((item) => item.classification === 'Международная')),
    government: (isRegistered || isSimple) && (inherits('Правительственная') || flags.has('government')),
  };
  const marks = rules.filter(([, applies]) => applies(facts)).map(([mark]) => mark);
  return marks.length ? marks : ['Без отметки'];
}

export function labelMarks(marks: readonly string[]): string[] {
  const visible = marks.filter((mark) => mark !== 'Без отметки' && mark !== 'Крупногабаритный');
  if (!marks.includes('РТ') && !marks.includes('Правительственная') &&
    marks.includes('Осторожно') && marks.includes('Терморежим')) {
    const index = visible.indexOf('Осторожно');
    visible.splice(index, 2, 'Терморежим', 'Осторожно');
  }
  return visible.map((mark) => mark === 'Мешок «М»' ? 'Мешок "М"' : mark === '1-й класс' ? '1-ый класс' : mark);
}

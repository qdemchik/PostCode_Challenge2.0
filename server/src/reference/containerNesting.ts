import type { Container, ContainerCategory, ContainerKind } from '../types/index.js';

const outerChildren: ContainerKind[] = ['мешок', 'группа РПО', 'ящик', 'коробка', 'газетная пачка', 'группа ПТ', 'мешок М'];
const kindRules: Partial<Record<ContainerKind, readonly ContainerKind[]>> = {
  'контейнер': outerChildren, 'паллета': outerChildren, 'мешок': ['группа РПО'],
};

export function acceptsChildContainers(kind: ContainerKind): boolean {
  return !!kindRules[kind]?.length;
}
const categoryRules: Partial<Record<ContainerCategory, readonly ContainerCategory[]>> = {
  'Заказная': ['Заказная'],
  'Страховая': ['Страховая', 'EMS'],
  'EMS': ['EMS'],
  'Сборная': ['Заказная', 'Страховая', 'EMS', 'Сборная', 'С печатью', 'Простая', 'Со счетами и ДМ'],
  'Простая': ['Простая', 'Со счетами и ДМ'],
};

// Справочники.docx, таблицы 3–4 и примечания 1–2.
export function canNestContainer(parent: Container, child: Container, siblings: readonly Container[]): boolean {
  if (!kindRules[parent.kind]?.includes(child.kind)) return false;
  if (child.category === 'Простая' && (parent.category === 'Заказная' || parent.category === 'Страховая')) {
    return siblings.some((item) => item.category === parent.category);
  }
  return categoryRules[parent.category]?.includes(child.category) ?? false;
}

export const weighingCategories: ReadonlySet<ContainerCategory> = new Set([
  'Простая', 'С порожней тарой', 'С ТМЦ', 'С печатью', 'Со счетами и ДМ',
]);

import type { Container, ContainerKind, Shipment } from '../types/index.js';

type Group = Container['group'];
type Model = { name: string; tareGrams: number; available?: false };
type Packaging = { groups: readonly Group[]; models: readonly Model[]; limitGrams: number };
const allGroups = ['ПК', 'ПО', 'EMS'] as const;
const noTare = [{ name: '—', tareGrams: 0 }] as const;
export const unlimitedMassGrams = Number.MAX_SAFE_INTEGER;
export const containerCategories = ['Заказная', 'Страховая', 'EMS', 'Сборная', 'Простая',
  'С ТМЦ', 'С порожней тарой', 'С печатью', 'Со счетами и ДМ'] as const;

// Справочники.docx, таблицы 1 и 2. Первая модель — модель по умолчанию в прототипе.
export const packaging: Readonly<Record<ContainerKind, Packaging>> = {
  'группа РПО': { groups: ['ПО', 'EMS'], models: noTare, limitGrams: unlimitedMassGrams },
  'группа ПТ': { groups: [], models: noTare, limitGrams: unlimitedMassGrams },
  'контейнер': { groups: allGroups, limitGrams: 500_000, models: [
    { name: 'Стандартный (КПШ)', tareGrams: 110_000 }, { name: 'Большой (КПС-5)', tareGrams: 150_000 },
    { name: 'Малый (КПС-6)', tareGrams: 75_000 }, { name: 'Пластиковый (КСРП-П)', tareGrams: 65_000 },
  ] },
  'паллета': { groups: allGroups, models: [{ name: 'Стандартный', tareGrams: 17_000 }], limitGrams: 500_000 },
  'мешок': { groups: allGroups, limitGrams: 10_000, models: [
    { name: 'Брезентовый', tareGrams: 500 }, { name: 'Авиа', tareGrams: 110 }, { name: 'Стандартный', tareGrams: 110 },
  ] },
  'ящик': { groups: allGroups, limitGrams: 10_000, models: [
    { name: 'Стандартный', tareGrams: 1_900 }, { name: 'Флэт', tareGrams: 2_300 },
    { name: 'Малый (ЯПМ-М)', tareGrams: 1_000, available: false },
  ] },
  'коробка': { groups: allGroups, models: [{ name: 'Стандартный', tareGrams: 50 }], limitGrams: 10_000 },
  'мешок М': { groups: ['ПК'], models: noTare, limitGrams: 14_500 },
  'газетная пачка': { groups: [], models: noTare, limitGrams: 10_000 },
};

export function packagingModel(kind: ContainerKind, model?: string): Model | undefined {
  const models = packaging[kind]?.models;
  if (!models) return undefined;
  if (!model) return models[0];
  const name = model === '-' ? '—' : model;
  return models.find((item) => item.name === name);
}

export function maxMassGrams(kind: ContainerKind, model: string, group: Group, hasMpoWithTu: boolean): number {
  if (!packagingModel(kind, model)) throw new RangeError('Модель тары отсутствует в справочнике.');
  return kind === 'мешок' && (group === 'EMS' || hasMpoWithTu) ? 32_000 : packaging[kind].limitGrams;
}

export function canPackShipments(kind: ContainerKind, group: Group, contents: readonly Shipment[]): boolean {
  if (!contents.length) return true;
  if (!packaging[kind]?.groups.includes(group)) return false;
  return kind !== 'мешок М' || (contents.length === 1 && /^мешок\s+[«"]?м[»"]?$/i.test(contents[0].kind.trim()));
}

// ДОПУЩЕНИЕ: эти значения из прежнего прототипа отличают типовой лимит от ручного в старых снимках.
export const legacyMassLimits: Partial<Record<ContainerKind, number>> = {
  'группа РПО': 999_999, 'контейнер': 500_000, 'паллета': 500_000, 'мешок М': 14_500,
  'мешок': 32_000, 'ящик': 10_000, 'коробка': 10_000, 'газетная пачка': 32_000,
};

type WeightRules = Pick<Container, 'kind' | 'packagingModel' | 'group' | 'massLimitOverrideGrams'>;

export function referenceMassLimit(container: WeightRules, contents: readonly Shipment[]): number {
  // ДОПУЩЕНИЕ: БД не передаёт признак ТУ, международное вложение служит приближением.
  const hasMpoWithTu = contents.some((item) => item.classification === 'Международная');
  // ДОПУЩЕНИЕ: для прежней сессии с произвольным названием модели используем типовую модель вида.
  const model = packagingModel(container.kind, container.packagingModel) ?? packaging[container.kind].models[0];
  return maxMassGrams(container.kind, model.name, container.group, hasMpoWithTu);
}

export function containerMassLimit(container: WeightRules, contents: readonly Shipment[]): number {
  return Math.min(referenceMassLimit(container, contents), container.massLimitOverrideGrams ?? unlimitedMassGrams);
}

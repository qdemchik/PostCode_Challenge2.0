import { readFileSync } from 'node:fs';
import type { Shipment } from '../types/index.js';

type Rule = [string, string, string, string, string, string, number, string, string];
const plan = JSON.parse(readFileSync(new URL('../../../data/routing-plan-114000.json', import.meta.url), 'utf8')) as {
  ranges: string[];
  rules: Rule[];
};

const countryCodes: Record<string, string> = {
  RU: '643', BY: '112', KZ: '398', KG: '417', AM: '51', TM: '795', UZ: '860',
  FR: '250', CZ: '203', CN: '156', GB: '826', DE: '276', MN: '496', HK: '344', US: '840',
};
const normalize = (value: string) => value.trim().toLowerCase().replaceAll('ё', 'е')
  .replace(/[–—]/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ')
  .replace(/1-го/g, '1').replace(/^вгпо 1 кл\.?$/, 'вгпо 1 класса');

const ranges = plan.ranges.map((range) => range.split(',').filter(Boolean).map((entry) => {
  const [start, end = start] = entry.split('..').map(Number);
  return { start, end };
}));
const rules = new Map<string, Rule[]>();
for (const rule of plan.rules) {
  const key = rule.slice(0, 5).map((value) => normalize(String(value))).join('|');
  const matches = rules.get(key) ?? [];
  matches.push(rule);
  rules.set(key, matches);
}

export function isEligibleForDispatch(shipment: Shipment, now = Date.now()): boolean {
  return shipment.origin === 'Возврат' || shipment.origin === 'Досылка почты' ||
    (shipment.origin === 'Приём' && Date.parse(shipment.storageExpiresAt) <= now);
}

export function withDispatchDetails(shipment: Shipment): Shipment {
  const result = { ...shipment, isEligibleForDispatch: isEligibleForDispatch(shipment) };
  if (shipment.containerId) return result;

  const rank = shipment.mailRank ?? 'Без разряда';
  const key = [shipment.classification, shipment.kind, shipment.category, rank,
    shipment.method].map(normalize).join('|');
  const country = countryCodes[shipment.countryCode] ?? shipment.countryCode;
  const matched = new Map<string, [string, string]>();
  for (const rule of rules.get(key) ?? []) {
    const [, , , , , countries, range, container, waybill] = rule;
    if (countries && !countries.split(',').includes(country)) continue;
    if (!ranges[range].some(({ start, end }) => start <= shipment.destinationIndex && shipment.destinationIndex <= end)) continue;
    matched.set(`${container}|${waybill}`, [container, waybill]);
  }
  const route = matched.size === 1 ? matched.values().next().value : undefined;
  return {
    ...result,
    directionContainer: route?.[0] ?? '',
    directionWaybill: route?.[1] ?? '',
    routingIssue: route ? undefined : matched.size === 0 ? 'ROUTE_NOT_FOUND' : 'ROUTE_AMBIGUOUS',
    routingDetails: route ? undefined : {
      rank,
      countryCode: country,
      candidates: [...matched.values()].map(([containerDirection, waybillDirection]) => ({ containerDirection, waybillDirection })),
    },
  };
}

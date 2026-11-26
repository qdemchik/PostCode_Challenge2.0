import { nanoid } from 'nanoid';

const opsDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' });

/** ГГММДД + индекс ОПС + порядковый номер. */
export function makeDocumentId(opsIndex: string, existingIds: Iterable<string>, now = new Date()): string {
  const prefix = opsDate.format(now).replaceAll('-', '').slice(2) + opsIndex;
  const used = new Set<number>();
  let greatest = 0;
  for (const id of existingIds) {
    if (id.length !== 16 || !id.startsWith(prefix)) continue;
    const sequence = Number(id.slice(-4));
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) continue;
    used.add(sequence);
    greatest = Math.max(greatest, sequence);
  }
  let sequence = greatest < 9999 ? greatest + 1 : 1;
  while (used.has(sequence)) sequence++;
  if (sequence > 9999) {
    throw Object.assign(new Error('На сегодня исчерпаны номера документов этого ОПС.'), {
      statusCode: 409,
      code: 'DOCUMENT_NUMBER_LIMIT',
    });
  }
  return prefix + String(sequence).padStart(4, '0');
}

export function makeId(prefix = ''): string {
  return prefix ? `${prefix}_${nanoid(10)}` : nanoid(12);
}

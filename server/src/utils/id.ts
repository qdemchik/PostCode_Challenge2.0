import { nanoid } from 'nanoid';

/** 16-значный ШИ ёмкости/накладной: ГГММДД + индекс ОПС (6) + порядковый (4) */
export function makeDocumentId(opsIndex = '114000', seq?: number): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePart = `${yy}${mm}${dd}`;
  const seqPart = String(seq ?? Math.floor(Math.random() * 9999) + 1).padStart(4, '0');
  return `${datePart}${opsIndex}${seqPart}`;
}

export function makeId(prefix = ''): string {
  return prefix ? `${prefix}_${nanoid(10)}` : nanoid(12);
}

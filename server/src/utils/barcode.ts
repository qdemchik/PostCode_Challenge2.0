/** Маски из справочников (хакатон) */
const INTERNAL = /^IN\d{12}$/i;
const EMS = /^E[A-Za-z]\d{9}[\dXx][A-Za-z]{2}$/;
const INTL = /^[A-Za-z]{2}\d{9}[\dXx][A-Za-z]{2}$/;
const DOC = /^\d{16}$/;

export type BarcodeKind = 'internal' | 'ems' | 'international' | 'document' | 'unknown';

export function detectBarcodeKind(code: string): BarcodeKind {
  const c = code.trim().toUpperCase();
  if (INTERNAL.test(c)) return 'internal';
  if (EMS.test(c)) return 'ems';
  if (INTL.test(c)) return 'international';
  if (DOC.test(c)) return 'document';
  return 'unknown';
}

export function validateBarcode(code: string): { ok: boolean; kind: BarcodeKind; message?: string } {
  const trimmed = code.trim();
  if (!trimmed) {
    return { ok: false, kind: 'unknown', message: 'Пустой идентификатор' };
  }
  const kind = detectBarcodeKind(trimmed);
  if (kind === 'unknown') {
    return {
      ok: false,
      kind,
      message: 'Неверный формат ШПИ. Ожидается IN + 12 цифр, EMS или международный формат.',
    };
  }
  return { ok: true, kind };
}

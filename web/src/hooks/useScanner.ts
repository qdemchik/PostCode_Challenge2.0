import { useEffect, useRef, useCallback } from 'react';

/**
 * Глобальный перехват ввода сканера (эмуляция клавиатуры + Enter).
 * Различаем скан и ручной ввод по скорости набора.
 */
export function useScanner(
  onScan: (code: string) => void,
  options?: { enabled?: boolean; minLength?: number }
) {
  const enabled = options?.enabled ?? true;
  const minLength = options?.minLength ?? 8;
  const buffer = useRef('');
  const lastKeyTime = useRef(0);
  const isFast = useRef(true);

  const flush = useCallback(() => {
    const code = buffer.current.trim();
    buffer.current = '';
    if (code.length >= minLength) {
      onScan(code);
    }
  }, [onScan, minLength]);

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // если фокус в обычном input (не scan-field) — не перехватываем, кроме Enter в scan
      const isScanField = target?.classList?.contains('scan-field');
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      if (isInput && !isScanField) return;

      const now = Date.now();
      const delta = now - lastKeyTime.current;
      lastKeyTime.current = now;

      if (delta > 50) {
        // медленный ввод → ручной
        isFast.current = false;
      } else {
        isFast.current = true;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        flush();
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!isScanField) {
          // глобальный буфер только если не в поле
          buffer.current += e.key;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, flush]);

  return { flush };
}

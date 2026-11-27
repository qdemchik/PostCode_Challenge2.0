import type { ScaleMode, ScaleReading } from '../types/index.js';
import { toleranceGrams } from '../reference/weighing.js';

export interface ScaleAdapter {
  read(calculatedGrams: number): ScaleReading;
}

export class MockScaleAdapter implements ScaleAdapter {
  constructor(private readonly mode: ScaleMode = 'stable', private readonly errorGrams?: number,
    private readonly random = Math.random) {}

  read(calculatedGrams: number): ScaleReading {
    if (this.mode === 'offline') throw this.failure('SCALE_OFFLINE', 'Весы недоступны. Подключите весы или введите массу вручную.', 503);
    if (this.mode === 'overload') throw this.failure('SCALE_OVERLOAD', 'Весы перегружены. Снимите ёмкость и взвесьте её заново.', 409);
    // ДОПУЩЕНИЕ: в штатном деморежиме случайная погрешность составляет ±5 г.
    const difference = this.errorGrams ?? Math.round((this.random() * 2 - 1) * 5);
    return {
      grams: Math.max(1, calculatedGrams + difference), stable: this.mode === 'stable', unit: 'g',
      ts: new Date().toISOString(), calculatedGrams, toleranceGrams: toleranceGrams(calculatedGrams),
    };
  }

  private failure(code: string, message: string, statusCode: number) {
    return Object.assign(new Error(message), { code, statusCode });
  }
}

const readings = new Map<string, ScaleReading>();

export function rememberReading(containerId: string, reading: ScaleReading) {
  readings.set(containerId, reading);
}

export function acceptedReading(containerId: string, ts: string | undefined, grams: number | undefined, calculated: number) {
  const reading = readings.get(containerId);
  return !!reading?.stable && reading.ts === ts && reading.grams === grams && reading.calculatedGrams === calculated;
}

export function discardReading(containerId: string) {
  readings.delete(containerId);
}

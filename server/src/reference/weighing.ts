// ДОПУЩЕНИЕ: допустимо отклонение до 2% расчётной массы, но не менее 50 г.
export const toleranceGrams = (calculated: number) => Math.max(calculated * 0.02, 50);
// ДОПУЩЕНИЕ: контролируемая погрешность демо-весов задаётся в пределах ±1000 г.
export const maxDemoErrorGrams = 1_000;

import type { PrintEvidence } from '../../server/src/types/index';

export function printEvidenceLabel(evidence?: PrintEvidence, printed = false): string | undefined {
  if (evidence?.source === 'paper') return 'Бумажный экземпляр подтверждён';
  if (evidence?.source === 'demo') return 'Демо-печать выполнена';
  if (printed) return 'Печать отмечена · источник неизвестен';
}

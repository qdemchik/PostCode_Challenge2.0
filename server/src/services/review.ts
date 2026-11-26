import type { ReviewItem } from '../types/index.js';
import { addAudit, getState } from './store.js';

export function resolveReview(barcode: string, resolution: NonNullable<ReviewItem['resolution']>) {
  const item = getState().reviewQueue[barcode];
  if (!item || item.resolvedAt) return false;
  item.resolvedAt = new Date().toISOString();
  item.resolution = resolution;
  addAudit({ entityType: 'shipment', entityId: barcode, action: 'review_resolved', newValue: { resolution } });
  return true;
}

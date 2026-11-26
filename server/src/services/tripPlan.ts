import type { TripPlan } from '../types/index.js';
import { isEligibleForDispatch } from './routing.js';
import { getState } from './store.js';

export function describeTripPlan(tripId: string): TripPlan {
  const state = getState();
  const result: TripPlan = { items: [], outsidePlanBarcodes: [] };
  const now = Date.now();
  for (const shipment of Object.values(state.shipments)) {
    const container = shipment.containerId ? state.containers[shipment.containerId] : undefined;
    const packed = container?.tripId === tripId;
    if (shipment.plannedTripId !== tripId) {
      if (packed) result.outsidePlanBarcodes.push(shipment.barcode);
      continue;
    }
    const review = state.reviewQueue[shipment.barcode];
    result.items.push({
      barcode: shipment.barcode,
      kind: shipment.kind,
      containerId: packed ? container?.id : undefined,
      status: packed ? 'packed' : review && !review.resolvedAt ? 'review'
        : isEligibleForDispatch(shipment, now) ? 'waiting' : 'unavailable',
    });
  }
  return result;
}

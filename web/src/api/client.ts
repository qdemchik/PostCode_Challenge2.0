import type { AuditEntry, Container, DispatchSummary, DispatchTrip, ReviewItem, ReviewReason, TripPlan, Waybill } from '../../../server/src/types/index';

const BASE = '/api';
const tripStorageKey = 'postcode.selectedTrip';
let tripId = typeof window === 'undefined' ? '' : localStorage.getItem(tripStorageKey) ?? '';

export const currentTripId = () => tripId;

export function selectApiTrip(id: string) {
  tripId = id;
  localStorage.setItem(tripStorageKey, id);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(tripId ? { 'X-PostCode-Trip': tripId } : {}),
      ...options?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || res.statusText) as Error & {
      code?: string;
      actionHint?: string;
      status: number;
      body: unknown;
    };
    err.code = data.code;
    err.actionHint = data.actionHint;
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data as T;
}

export const api = {
  packagingReference: () => request<{
    packaging: typeof import('../../../server/src/reference/packaging').packaging;
    shipmentMarkLabels: typeof import('../../../server/src/reference/marks').shipmentMarkLabels;
    weighingCategories: Container['category'][];
    containerCategories: Container['category'][];
    unlimitedMassGrams: number;
    maxDemoErrorGrams: number;
  }>('/reference/packaging'),
  trips: () => request<{ items: DispatchTrip[] }>('/trips'),
  tripPlan: () => request<TripPlan>('/trip-plan'),
  planShipment: (barcode: string, included: boolean) => request<TripPlan>(`/trip-plan/${encodeURIComponent(barcode)}`, {
    method: 'PUT', body: JSON.stringify({ included }),
  }),
  createTrip: (name: string) => request<DispatchTrip>('/trips', { method: 'POST', body: JSON.stringify({ name }) }),
  stats: () => request<any>('/stats'),
  dispatchSummary: () => request<DispatchSummary>('/dispatch-summary'),
  reviewItems: () => request<{ items: ReviewItem[] }>('/review'),
  deferReview: (barcode: string, reason: ReviewReason) => request<ReviewItem>('/review', {
    method: 'POST', body: JSON.stringify({ barcode, reason }),
  }),
  dismissReview: (barcode: string) => request<ReviewItem>(`/review/${encodeURIComponent(barcode)}/dismiss`, { method: 'POST' }),
  shipments: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ total: number; items: any[] }>(`/shipments${q}`);
  },
  getShipment: (barcode: string) => request<any>(`/shipments/${encodeURIComponent(barcode)}`),
  patchShipment: (barcode: string, body: Record<string, unknown>) =>
    request<any>(`/shipments/${encodeURIComponent(barcode)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  verifyShipment: (barcode: string) =>
    request<any>(`/shipments/${encodeURIComponent(barcode)}/verify`, { method: 'POST' }),
  assign: (barcode: string) =>
    request<any>('/containers/assign', { method: 'POST', body: JSON.stringify({ barcode }) }),
  removeShipment: (barcode: string, containerId?: string) =>
    request<any>('/containers/remove-shipment', {
      method: 'POST',
      body: JSON.stringify({ barcode, containerId }),
    }),
  transferTargets: (barcode: string, fromId: string) =>
    request<{ items: Container[] }>(`/containers/transfer-targets?${new URLSearchParams({ barcode, fromId })}`),
  transferShipment: (barcode: string, fromId: string, toId?: string) =>
    request<unknown>('/containers/transfer-shipment', {
      method: 'POST',
      body: JSON.stringify({ barcode, fromId, toId }),
    }),
  containers: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ total: number; items: any[] }>(`/containers${q}`);
  },
  getContainer: (id: string) => request<any>(`/containers/${id}`),
  scaleReading: (id: string) => request<import('../../../server/src/types/index').ScaleReading>(
    `/scale/reading?containerId=${encodeURIComponent(id)}`),
  closeContainer: (id: string, measuredWeightGrams?: number, options?: {
    weightSource?: import('../../../server/src/types/index').WeightSource; readingTs?: string; openNext?: boolean;
  }) => request<Container & { nextContainerId?: string }>(`/containers/${id}/close`, {
    method: 'POST', body: measuredWeightGrams === undefined && !options ? undefined : JSON.stringify({ measuredWeightGrams, ...options }),
  }),
  createContainer: (body: Pick<Container, 'kind' | 'category' | 'directionId' | 'waybillDirectionId'>) =>
    request<Container>('/containers', { method: 'POST', body: JSON.stringify(body) }),
  nestingParents: (id: string) => request<{ items: Container[] }>(`/containers/${id}/nest-parents`),
  changeNestedContainer: (id: string, childId: string, attach: boolean) => request<Container>(`/containers/${id}/${attach ? 'nest' : 'unnest'}`, {
    method: 'POST', body: JSON.stringify({ childId }),
  }),
  reopenContainer: (id: string) => request<any>(`/containers/${id}/reopen`, { method: 'POST' }),
  patchContainer: (id: string, body: Record<string, unknown>) =>
    request<any>(`/containers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  labelData: (id: string) => request<any>(`/containers/${id}/label`),
  preAssign: () => request<any>('/containers/pre-assign', { method: 'POST' }),
  createWaybills: (containerIds?: string[]) => request<any>('/waybills', {
    method: 'POST', body: containerIds ? JSON.stringify({ containerIds }) : undefined,
  }),
  waybills: () => request<{ total: number; items: any[] }>('/waybills'),
  getWaybill: (id: string) => request<any>(`/waybills/${id}`),
  markWaybillReady: (id: string) => request<any>(`/waybills/${id}/ready`, { method: 'POST' }),
  cancelWaybill: (id: string, reason: string) => request<Waybill>(`/waybills/${id}/cancel`, {
    method: 'POST', body: JSON.stringify({ reason }),
  }),
  handoverWaybill: (id: string, containerIds: string[]) => request<Waybill>(`/waybills/${id}/handover`, {
    method: 'POST', body: JSON.stringify({ containerIds }),
  }),
  print: (type: 'label' | 'waybill', entityId: string) =>
    request<any>('/print/jobs', {
      method: 'POST',
      body: JSON.stringify({ type, entityId }),
    }),
  confirmPaperPrint: (type: 'label' | 'waybill', entityId: string) => request<{ ok: true }>('/print/confirm-paper', {
    method: 'POST', body: JSON.stringify({ type, entityId }),
  }),
  printJobs: () => request<{ items: any[] }>('/print/jobs'),
  retryPrint: (id: string) => request<any>(`/print/jobs/${id}/retry`, { method: 'POST' }),
  search: (filters: { q: string; date: string; direction: string }) =>
    request<any>(`/search?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value))}`),
  demoFlags: () => request<any>('/demo/flags'),
  toggleError: (body: { printerError?: boolean; sourceDown?: boolean; autoNestBags?: boolean;
    scaleMode?: import('../../../server/src/types/index').ScaleMode; scaleErrorGrams?: number | null }) =>
    request<any>('/demo/toggle-error', { method: 'POST', body: JSON.stringify(body) }),
  reset: () => request<any>('/demo/reset', { method: 'POST' }),
  audit: (entityId?: string) =>
    request<{ items: AuditEntry[] }>(`/audit${entityId ? `?entityId=${encodeURIComponent(entityId)}` : ''}`),
};

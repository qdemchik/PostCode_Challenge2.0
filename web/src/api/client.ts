const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
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
  stats: () => request<any>('/stats'),
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
  removeShipment: (barcode: string) =>
    request<any>('/containers/remove-shipment', {
      method: 'POST',
      body: JSON.stringify({ barcode }),
    }),
  containers: (params?: Record<string, string>) => {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    return request<{ total: number; items: any[] }>(`/containers${q}`);
  },
  getContainer: (id: string) => request<any>(`/containers/${id}`),
  closeContainer: (id: string) => request<any>(`/containers/${id}/close`, { method: 'POST' }),
  reopenContainer: (id: string) => request<any>(`/containers/${id}/reopen`, { method: 'POST' }),
  patchContainer: (id: string, body: Record<string, unknown>) =>
    request<any>(`/containers/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  labelData: (id: string) => request<any>(`/containers/${id}/label`),
  preAssign: () => request<any>('/containers/pre-assign', { method: 'POST' }),
  createWaybills: () => request<any>('/waybills', { method: 'POST' }),
  waybills: () => request<{ total: number; items: any[] }>('/waybills'),
  getWaybill: (id: string) => request<any>(`/waybills/${id}`),
  print: (type: 'label' | 'waybill', entityId: string) =>
    request<any>('/print/jobs', {
      method: 'POST',
      body: JSON.stringify({ type, entityId }),
    }),
  printJobs: () => request<{ items: any[] }>('/print/jobs'),
  retryPrint: (id: string) => request<any>(`/print/jobs/${id}/retry`, { method: 'POST' }),
  search: (q: string, type = 'all') =>
    request<any>(`/search?q=${encodeURIComponent(q)}&type=${type}`),
  demoFlags: () => request<any>('/demo/flags'),
  toggleError: (body: { printerError?: boolean; sourceDown?: boolean }) =>
    request<any>('/demo/toggle-error', { method: 'POST', body: JSON.stringify(body) }),
  reset: () => request<any>('/demo/reset', { method: 'POST' }),
  audit: (entityId?: string) =>
    request<{ items: any[] }>(`/audit${entityId ? `?entityId=${entityId}` : ''}`),
};

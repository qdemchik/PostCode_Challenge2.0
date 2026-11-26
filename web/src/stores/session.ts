import { create } from 'zustand';
import { api, currentTripId } from '../api/client';

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  title: string;
  message?: string;
  hint?: string;
}

interface SessionStore {
  stats: any | null;
  lastShipment: any | null;
  lastAssign: any | null;
  containers: any[];
  toast: Toast | null;
  loading: boolean;
  refreshStats: () => Promise<void>;
  refreshContainers: () => Promise<void>;
  showToast: (t: Omit<Toast, 'id'>) => void;
  clearToast: () => void;
  clearTripView: () => void;
  setLastShipment: (s: any | null) => void;
  setLastAssign: (a: any | null) => void;
}

let toastId = 0;

export const useSession = create<SessionStore>((set, get) => ({
  stats: null,
  lastShipment: null,
  lastAssign: null,
  containers: [],
  toast: null,
  loading: false,

  refreshStats: async () => {
    const trip = currentTripId();
    try {
      const stats = await api.stats();
      if (trip === currentTripId()) set({ stats });
    } catch {
      /* ignore */
    }
  },

  refreshContainers: async () => {
    const trip = currentTripId();
    try {
      const res = await api.containers();
      if (trip === currentTripId()) set({ containers: res.items });
    } catch {
      /* ignore */
    }
  },

  showToast: (t) => {
    const id = ++toastId;
    set({ toast: { ...t, id } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 4500);
  },

  clearToast: () => set({ toast: null }),
  clearTripView: () => set({ stats: null, containers: [], lastShipment: null, lastAssign: null }),
  setLastShipment: (s) => set({ lastShipment: s }),
  setLastAssign: (a) => set({ lastAssign: a }),
}));

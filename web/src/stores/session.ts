import { create } from 'zustand';
import { api } from '../api/client';

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
    try {
      const stats = await api.stats();
      set({ stats });
    } catch {
      /* ignore */
    }
  },

  refreshContainers: async () => {
    try {
      const res = await api.containers();
      set({ containers: res.items });
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
  setLastShipment: (s) => set({ lastShipment: s }),
  setLastAssign: (a) => set({ lastAssign: a }),
}));

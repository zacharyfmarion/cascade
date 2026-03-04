import type { StateCreator } from 'zustand';
import type { GraphState } from '../store';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
  createdAt: number;
  timeoutMs: number;
}

export interface ToastSliceState {
  toasts: Toast[];
}

export interface ToastSliceActions {
  pushToast: (kind: ToastKind, title: string, message?: string) => void;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

export type ToastSlice = ToastSliceState & ToastSliceActions;

export const createToastSlice: StateCreator<
  GraphState,
  [['zustand/devtools', never]],
  [],
  ToastSlice
> = (set, _get) => {

  return {
    toasts: [],

    pushToast: (kind, title, message) => {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const timeoutMs = kind === 'error' ? 8000 : 5000;
      
      const newToast: Toast = {
        id,
        kind,
        title,
        message,
        createdAt,
        timeoutMs,
      };

      set(state => ({
        toasts: [newToast, ...state.toasts],
      }));

      // Auto-dismiss is handled by the UI component to avoid side effects in store
    },

    dismissToast: (id) => {
      set(state => ({
        toasts: state.toasts.filter(t => t.id !== id),
      }));
    },

    clearToasts: () => {
      set({ toasts: [] });
    },
  };
};

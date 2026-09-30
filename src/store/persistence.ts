/**
 * Persistence adapter. The prototype stores everything in the browser
 * (localStorage). Swap `storageAdapter` for an HTTP/database implementation
 * later without touching the UI or the calculation engine.
 */
import type { StateStorage } from 'zustand/middleware';

export interface StorageAdapter extends StateStorage {
  kind: 'local' | 'remote';
}

export const storageAdapter: StorageAdapter = {
  kind: 'local',
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* quota / private mode — the session continues in memory */
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

export function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

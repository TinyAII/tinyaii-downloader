import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useAdvancedSettingsStore } from './settings/advancedStore';

export type DeveloperLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DeveloperLogEntry {
  id: string;
  timestamp: string;
  source: string;
  action: string;
  level: DeveloperLogLevel;
  message: string;
  details?: string;
}

interface DeveloperLogState {
  logs: DeveloperLogEntry[];
  addLog: (entry: Omit<DeveloperLogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
}

const levelPriority: Record<DeveloperLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function toSafeMaxEntries(value: number) {
  if (!Number.isFinite(value)) return 500;
  return Math.min(5000, Math.max(100, Math.trunc(value)));
}

export const useDeveloperLogStore = create<DeveloperLogState>()(
  persist(
    (set) => ({
      logs: [],
      addLog: (entry) =>
        set((state) => {
          const maxEntries = toSafeMaxEntries(useAdvancedSettingsStore.getState().developerLogMaxEntries);
          const next: DeveloperLogEntry = {
            ...entry,
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            timestamp: new Date().toISOString(),
          };
          const logs = [next, ...state.logs];
          return { logs: logs.slice(0, maxEntries) };
        }),
      clearLogs: () => set({ logs: [] }),
    }),
    {
      name: 'tinyaii-developer-logs',
      version: 1,
      storage: createJSONStorage(() => localStorage),
    }
  )
);

function maskSecret(value: string) {
  if (!value) return value;
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function sanitizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeUnknown);
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      const lower = key.toLowerCase();
      if (lower.includes('secret') || lower.includes('token') || lower.includes('authorization') || lower.includes('cookie')) {
        output[key] = typeof item === 'string' ? maskSecret(item) : '***';
      } else {
        output[key] = sanitizeUnknown(item);
      }
    });
    return output;
  }
  if (typeof value === 'string' && value.length > 2000) {
    return `${value.slice(0, 2000)}...(truncated)`;
  }
  return value;
}

export function safeJson(value: unknown) {
  try {
    return JSON.stringify(sanitizeUnknown(value), null, 2);
  } catch {
    return String(value);
  }
}

export function writeDeveloperLog(entry: Omit<DeveloperLogEntry, 'id' | 'timestamp'>) {
  const settings = useAdvancedSettingsStore.getState();
  if (!settings.enableDeveloperLogs) return;
  if (levelPriority[entry.level] < levelPriority[settings.developerLogLevel]) return;
  useDeveloperLogStore.getState().addLog(entry);
}

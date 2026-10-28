import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ResolverAuthSession } from '../types/resolver';

interface ResolverAuthStore {
  sessions: Record<string, ResolverAuthSession>;
  upsertSession: (site: string, payload: { cookie: string; userAgent?: string }) => void;
  removeSession: (site: string) => void;
}

function normalizeSite(site: string) {
  return site.trim().toLowerCase();
}

function normalizeCookie(cookie: string) {
  return cookie
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .join('; ');
}

export const useResolverAuthStore = create<ResolverAuthStore>()(
  persist(
    (set) => ({
      sessions: {},
      upsertSession: (site, payload) => {
        const key = normalizeSite(site);
        if (!key) return;
        const cookie = normalizeCookie(payload.cookie);
        set((state) => ({
          sessions: {
            ...state.sessions,
            [key]: {
              site: key,
              cookie,
              userAgent: (payload.userAgent || '').trim(),
              updatedAt: Date.now(),
            },
          },
        }));
      },
      removeSession: (site) => {
        const key = normalizeSite(site);
        if (!key) return;
        set((state) => {
          if (!state.sessions[key]) return state;
          const next = { ...state.sessions };
          delete next[key];
          return { sessions: next };
        });
      },
    }),
    {
      name: 'tinyaii-resolver-auth',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ sessions }) => ({ sessions }),
    }
  )
);

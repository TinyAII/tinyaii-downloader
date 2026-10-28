import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { basicSettingsDefaults } from './defaults';
import { migrateBasicSettings, readLegacyBasicSettings } from './migration';
import type { BasicSettingsValues } from './types';

type BasicSettingsStoreState = BasicSettingsValues & {
  updateBasicSetting: <K extends keyof BasicSettingsValues>(key: K, value: BasicSettingsValues[K]) => void;
  resetBasicSettings: () => void;
};

const basicInitialState: BasicSettingsValues = {
  ...basicSettingsDefaults,
  ...readLegacyBasicSettings(),
};

export const useBasicSettingsStore = create<BasicSettingsStoreState>()(
  persist(
    (set) => ({
      ...basicInitialState,
      updateBasicSetting: (key, value) => set({ [key]: value } as Pick<BasicSettingsValues, typeof key>),
      resetBasicSettings: () => set(basicSettingsDefaults),
    }),
    {
      name: 'tinyaii-settings-basic',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState) => migrateBasicSettings(persistedState, basicSettingsDefaults),
      partialize: ({ updateBasicSetting, resetBasicSettings, ...settings }) => settings,
    }
  )
);

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { advancedSettingsDefaults } from './defaults';
import { migrateAdvancedSettings, readLegacyAdvancedSettings } from './migration';
import type { AdvancedSettingsValues } from './types';

type AdvancedSettingsStoreState = AdvancedSettingsValues & {
  updateAdvancedSetting: <K extends keyof AdvancedSettingsValues>(key: K, value: AdvancedSettingsValues[K]) => void;
  resetAdvancedSettings: () => void;
};

const advancedInitialState: AdvancedSettingsValues = {
  ...advancedSettingsDefaults,
  ...readLegacyAdvancedSettings(),
};

export const useAdvancedSettingsStore = create<AdvancedSettingsStoreState>()(
  persist(
    (set) => ({
      ...advancedInitialState,
      updateAdvancedSetting: (key, value) => set({ [key]: value } as Pick<AdvancedSettingsValues, typeof key>),
      resetAdvancedSettings: () => set(advancedSettingsDefaults),
    }),
    {
      name: 'tinyaii-settings-advanced',
      // 2：GitHub 加速列表迁移（剔除失效镜像、补齐内置项）
      version: 2,
      storage: createJSONStorage(() => localStorage),
      migrate: (persistedState) => migrateAdvancedSettings(persistedState, advancedSettingsDefaults),
      partialize: ({ updateAdvancedSetting, resetAdvancedSettings, ...settings }) => settings,
    }
  )
);

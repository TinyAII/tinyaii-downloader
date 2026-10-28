import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAdvancedSettingsStore } from './advancedStore';
import { useBasicSettingsStore } from './basicStore';
import { advancedSettingsKeys, basicSettingsKeys } from './migration';
import type { AdvancedSettingsValues, BasicSettingsValues, SettingsState, SettingsValues } from './types';

type SettingsActions = Pick<SettingsState, 'updateSetting' | 'resetSettings'>;

const basicValuesSelector = (state: ReturnType<typeof useBasicSettingsStore.getState>): BasicSettingsValues =>
  Object.fromEntries(basicSettingsKeys.map((key) => [key, state[key]])) as unknown as BasicSettingsValues;

const advancedValuesSelector = (
  state: ReturnType<typeof useAdvancedSettingsStore.getState>
): AdvancedSettingsValues =>
  Object.fromEntries(advancedSettingsKeys.map((key) => [key, state[key]])) as unknown as AdvancedSettingsValues;

const basicKeySet = new Set<keyof SettingsValues>(basicSettingsKeys);

const isBasicKey = (key: keyof SettingsValues): key is keyof BasicSettingsValues => basicKeySet.has(key);

export const useBasicSettingsValues = () => useBasicSettingsStore(useShallow(basicValuesSelector));
export const useAdvancedSettingsValues = () => useAdvancedSettingsStore(useShallow(advancedValuesSelector));
export const useSettingsActions = (): SettingsActions => {
  const updateBasicSetting = useBasicSettingsStore((state) => state.updateBasicSetting);
  const resetBasicSettings = useBasicSettingsStore((state) => state.resetBasicSettings);
  const updateAdvancedSetting = useAdvancedSettingsStore((state) => state.updateAdvancedSetting);
  const resetAdvancedSettings = useAdvancedSettingsStore((state) => state.resetAdvancedSettings);

  const updateSetting = useCallback<SettingsState['updateSetting']>(
    (key, value) => {
      if (isBasicKey(key)) {
        updateBasicSetting(key, value as BasicSettingsValues[typeof key]);
        return;
      }
      updateAdvancedSetting(key, value as AdvancedSettingsValues[keyof AdvancedSettingsValues]);
    },
    [updateAdvancedSetting, updateBasicSetting]
  );

  const resetSettings = useCallback(() => {
    resetBasicSettings();
    resetAdvancedSettings();
  }, [resetAdvancedSettings, resetBasicSettings]);

  return {
    updateSetting,
    resetSettings,
  };
};

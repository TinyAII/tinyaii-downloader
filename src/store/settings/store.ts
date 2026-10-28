import { useMemo } from 'react';
import { useAdvancedSettingsStore } from './advancedStore';
import { useBasicSettingsStore } from './basicStore';
import { advancedSettingsKeys, basicSettingsKeys } from './migration';
import type { AdvancedSettingsValues, BasicSettingsValues, SettingsState, SettingsValues } from './types';

type Selector<T> = (state: SettingsState) => T;

const identity = <T,>(value: T) => value;

const basicKeySet = new Set<keyof SettingsValues>(basicSettingsKeys);
const advancedKeySet = new Set<keyof SettingsValues>(advancedSettingsKeys);

const isBasicKey = (key: keyof SettingsValues): key is keyof BasicSettingsValues => basicKeySet.has(key);

const isAdvancedKey = (key: keyof SettingsValues): key is keyof AdvancedSettingsValues => advancedKeySet.has(key);

export const useSettingsStore = <T = SettingsState>(selector?: Selector<T>): T => {
  const basicState = useBasicSettingsStore();
  const advancedState = useAdvancedSettingsStore();
  const selected = useMemo(() => {
    const updateSetting: SettingsState['updateSetting'] = (key, value) => {
      if (isBasicKey(key)) {
        useBasicSettingsStore.getState().updateBasicSetting(key, value as never);
        return;
      }
      if (isAdvancedKey(key)) {
        useAdvancedSettingsStore.getState().updateAdvancedSetting(key, value as never);
      }
    };

    const resetSettings: SettingsState['resetSettings'] = () => {
      useBasicSettingsStore.getState().resetBasicSettings();
      useAdvancedSettingsStore.getState().resetAdvancedSettings();
    };

    const state: SettingsState = {
      ...basicState,
      ...advancedState,
      updateSetting,
      resetSettings,
    };
    const finalSelector = selector ?? (identity as Selector<T>);
    return finalSelector(state);
  }, [advancedState, basicState, selector]);

  return selected;
};

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AdvancedSettingsValues, BasicSettingsValues } from './types';

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length() {
    return this.map.size;
  }

  clear() {
    this.map.clear();
  }

  getItem(key: string) {
    return this.map.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.map.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.map.delete(key);
  }

  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

const basicPersistedKey = 'tinyaii-settings-basic';
const advancedPersistedKey = 'tinyaii-settings-advanced';
const legacyPersistedKey = 'tinyaii-settings';
const localStorageMock = new MemoryStorage();
let basicSettingsDefaults: BasicSettingsValues;
let advancedSettingsDefaults: AdvancedSettingsValues;
let useBasicSettingsStore: {
  getState: () => BasicSettingsValues & {
    updateBasicSetting: <K extends keyof BasicSettingsValues>(key: K, value: BasicSettingsValues[K]) => void;
    resetBasicSettings: () => void;
  };
};
let useAdvancedSettingsStore: {
  getState: () => AdvancedSettingsValues & {
    updateAdvancedSetting: <K extends keyof AdvancedSettingsValues>(key: K, value: AdvancedSettingsValues[K]) => void;
    resetAdvancedSettings: () => void;
  };
};
let readLegacyBasicSettings: () => Partial<BasicSettingsValues>;
let readLegacyAdvancedSettings: () => Partial<AdvancedSettingsValues>;
let migrateBasicSettings: (persisted: unknown, defaults: BasicSettingsValues) => BasicSettingsValues;
let migrateAdvancedSettings: (
  persisted: unknown,
  defaults: AdvancedSettingsValues
) => AdvancedSettingsValues;
let basicSettingsKeys: readonly (keyof BasicSettingsValues)[];
let advancedSettingsKeys: readonly (keyof AdvancedSettingsValues)[];

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

beforeAll(async () => {
  ({ basicSettingsDefaults, advancedSettingsDefaults } = await import('./defaults'));
  ({ useBasicSettingsStore } = await import('./basicStore'));
  ({ useAdvancedSettingsStore } = await import('./advancedStore'));
  ({
    readLegacyBasicSettings,
    readLegacyAdvancedSettings,
    migrateBasicSettings,
    migrateAdvancedSettings,
    basicSettingsKeys,
    advancedSettingsKeys,
  } = await import('./migration'));
});

beforeEach(() => {
  localStorageMock.clear();
  useBasicSettingsStore.getState().resetBasicSettings();
  useAdvancedSettingsStore.getState().resetAdvancedSettings();
});

describe('settings store', () => {
  it('updates basic value and writes persisted state', () => {
    useBasicSettingsStore.getState().updateBasicSetting('theme', 'dark');
    const state = useBasicSettingsStore.getState();
    const raw = localStorageMock.getItem(basicPersistedKey);
    const persisted = raw ? JSON.parse(raw) : null;

    expect(state.theme).toBe('dark');
    expect(persisted?.state?.theme).toBe('dark');
    expect(persisted?.state?.updateBasicSetting).toBeUndefined();
    expect(persisted?.state?.resetBasicSettings).toBeUndefined();
  });

  it('resets advanced values to defaults', () => {
    useAdvancedSettingsStore.getState().updateAdvancedSetting('rpcPort', 18999);
    useAdvancedSettingsStore.getState().resetAdvancedSettings();

    expect(useAdvancedSettingsStore.getState().rpcPort).toBe(advancedSettingsDefaults.rpcPort);
    expect(useAdvancedSettingsStore.getState().logLevel).toBe(advancedSettingsDefaults.logLevel);
  });

  it('updates advanced value and writes persisted state', () => {
    useAdvancedSettingsStore.getState().updateAdvancedSetting('rpcPort', 18999);
    const raw = localStorageMock.getItem(advancedPersistedKey);
    const persisted = raw ? JSON.parse(raw) : null;

    expect(persisted?.state?.rpcPort).toBe(18999);
    expect(persisted?.state?.updateAdvancedSetting).toBeUndefined();
    expect(persisted?.state?.resetAdvancedSettings).toBeUndefined();
  });
});

describe('settings migration and selectors', () => {
  it('reads legacy values for both domains', () => {
    localStorageMock.setItem(
      legacyPersistedKey,
      JSON.stringify({
        state: {
          theme: 'dark',
          rpcPort: 18999,
          unknownField: 'ignored',
        },
        version: 0,
      })
    );
    const basicLegacy = readLegacyBasicSettings();
    const advancedLegacy = readLegacyAdvancedSettings();

    expect(basicLegacy.theme).toBe('dark');
    expect(advancedLegacy.rpcPort).toBe(18999);
  });

  it('migrates persisted values by domain and keeps defaults', () => {
    const migratedBasic = migrateBasicSettings({ theme: 'dark' }, basicSettingsDefaults);
    const migratedAdvanced = migrateAdvancedSettings({ rpcPort: 18999 }, advancedSettingsDefaults);

    expect(migratedBasic.theme).toBe('dark');
    expect(migratedBasic.language).toBe(basicSettingsDefaults.language);
    expect(migratedAdvanced.rpcPort).toBe(18999);
    expect(migratedAdvanced.logLevel).toBe(advancedSettingsDefaults.logLevel);
  });

  it('clamps legacy transfer options and keeps split independent from connections', () => {
    const migratedBasic = migrateBasicSettings(
      { defaultSplitCount: 780, maxConnectionsPerServer: 880 },
      basicSettingsDefaults
    );

    expect(migratedBasic.defaultSplitCount).toBe(512);
    expect(migratedBasic.maxConnectionsPerServer).toBe(512);
  });

  it('normalizes progress bar scope when legacy value is invalid', () => {
    const migratedBasic = migrateBasicSettings(
      { progressBarScope: 'unexpected' },
      basicSettingsDefaults
    );

    expect(migratedBasic.progressBarScope).toBe(basicSettingsDefaults.progressBarScope);
  });

  it('keeps selector fields synchronized with defaults keys', () => {
    expect(new Set(basicSettingsKeys)).toEqual(new Set(Object.keys(basicSettingsDefaults)));
    expect(new Set(advancedSettingsKeys)).toEqual(new Set(Object.keys(advancedSettingsDefaults)));
  });
});

import type {
  AdvancedSettingsValues,
  BasicSettingsValues,
  ProgressBarScope,
  StartupResumeMode,
} from './types';

const LEGACY_SETTINGS_KEY = 'tinyaii-settings';

type PersistPayload = {
  state?: unknown;
  version?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parsePersistState = (storageKey: string): Record<string, unknown> => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistPayload;
    if (!isRecord(parsed?.state)) return {};
    return parsed.state;
  } catch {
    return {};
  }
};

const pickKeys = <K extends string>(
  source: Record<string, unknown>,
  keys: readonly K[]
): Partial<Record<K, unknown>> =>
  keys.reduce((acc, key) => {
    if (key in source) {
      acc[key] = source[key];
    }
    return acc;
  }, {} as Partial<Record<K, unknown>>);

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const normalizeProgressBarScope = (value: unknown, fallback: ProgressBarScope): ProgressBarScope => {
  if (value === 'all' || value === 'downloading') return value;
  return fallback;
};

const normalizeStartupResumeMode = (value: unknown, fallback: StartupResumeMode): StartupResumeMode => {
  if (value === 'all' || value === 'paused' || value === 'failed') return value;
  return fallback;
};

export const basicSettingsKeys: readonly (keyof BasicSettingsValues)[] = [
  'language',
  'autoUpdate',
  'updateFreq',
  'lastUpdateCheckAt',
  'theme',
  'showProgress',
  'progressBarScope',
  'minimizeToTray',
  'startupMinimize',
  'startupAutoRun',
  'startupRestore',
  'startupResume',
  'startupResumeMode',
  'autoDownloadTorrent',
  'forceEncrypt',
  'keepSeeding',
  'resumeBreakpoint',
  'jumpToDownload',
  'notifyOnComplete',
  'noConfirmOnDelete',
  'deleteTorrentOnComplete',
  'deleteRecordOnMissing',
  'defaultDownloadDir',
  'uploadLimitValue',
  'uploadLimitUnit',
  'downloadLimitValue',
  'downloadLimitUnit',
  'seedRatio',
  'seedTimeMinutes',
  'maxConcurrentDownloads',
  'defaultSplitCount',
  'maxConnectionsPerServer',
  'reconnectCooldownSeconds',
  'reconnectSpeedThresholdKB',
];

export const advancedSettingsKeys: readonly (keyof AdvancedSettingsValues)[] = [
  'useProxy',
  'proxyProtocol',
  'proxyHost',
  'proxyPort',
  'proxyUsername',
  'proxyPassword',
  'proxyBypass',
  'trackerSource',
  'trackerList',
  'trackerLocalDirs',
  'autoUpdateTracker',
  'rpcPort',
  'rpcSecret',
  'aria2ExecutablePath',
  'enableDeveloperLogs',
  'showDeveloperLogsEntry',
  'developerLogLevel',
  'developerLogMaxEntries',
  'upnp',
  'btPort',
  'dhtPort',
  'listenPortSyncMode',
  'listenPortHistory',
  'userAgent',
  'userAgentRules',
  'logLevel',
];

export const readLegacyBasicSettings = (): Partial<BasicSettingsValues> => {
  const legacy = parsePersistState(LEGACY_SETTINGS_KEY);
  return pickKeys(legacy, basicSettingsKeys) as Partial<BasicSettingsValues>;
};

export const readLegacyAdvancedSettings = (): Partial<AdvancedSettingsValues> => {
  const legacy = parsePersistState(LEGACY_SETTINGS_KEY);
  return pickKeys(legacy, advancedSettingsKeys) as Partial<AdvancedSettingsValues>;
};

export const migrateBasicSettings = (persisted: unknown, defaults: BasicSettingsValues): BasicSettingsValues => {
  if (!isRecord(persisted)) {
    return defaults;
  }
  const legacyDefaultSplitCountRaw = typeof persisted.defaultSplitCount === 'number'
    ? persisted.defaultSplitCount
    : defaults.defaultSplitCount;
  const legacyMaxConnectionsRaw = typeof persisted.maxConnectionsPerServer === 'number'
    ? persisted.maxConnectionsPerServer
    : defaults.maxConnectionsPerServer;
  const legacyDefaultSplitCount = clampNumber(legacyDefaultSplitCountRaw, 1, 512);
  const legacyMaxConnections = clampNumber(legacyMaxConnectionsRaw, 1, 512);
  const base = {
    ...defaults,
    ...(pickKeys(persisted, basicSettingsKeys) as Partial<BasicSettingsValues>),
  };
  return {
    ...base,
    progressBarScope: normalizeProgressBarScope(base.progressBarScope, defaults.progressBarScope),
    startupResumeMode: normalizeStartupResumeMode(base.startupResumeMode, defaults.startupResumeMode),
    defaultSplitCount: clampNumber(
      typeof base.defaultSplitCount === 'number' ? base.defaultSplitCount : legacyDefaultSplitCount,
      1,
      512
    ),
    maxConnectionsPerServer: clampNumber(
      typeof base.maxConnectionsPerServer === 'number' ? base.maxConnectionsPerServer : legacyMaxConnections,
      1,
      512
    ),
  };
};

export const migrateAdvancedSettings = (
  persisted: unknown,
  defaults: AdvancedSettingsValues
): AdvancedSettingsValues => {
  if (!isRecord(persisted)) {
    return defaults;
  }
  return {
    ...defaults,
    ...(pickKeys(persisted, advancedSettingsKeys) as Partial<AdvancedSettingsValues>),
  };
};

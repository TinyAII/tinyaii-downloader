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
  'githubMirrorId',
  'githubMirrorList',
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

// 这些默认镜像已失效，迁移时直接从用户列表里摘掉
const RETIRED_MIRROR_IDS = new Set(['ghproxynet']);

const mergeGithubMirrorList = (
  persistedList: unknown,
  defaults: AdvancedSettingsValues
): AdvancedSettingsValues['githubMirrorList'] => {
  const defaultList = defaults.githubMirrorList;
  if (!Array.isArray(persistedList)) {
    return defaultList;
  }
  const kept = persistedList
    .filter((item): item is { id: string, label: string, prefix: string } =>
      isRecord(item) && typeof item.id === 'string' && typeof item.prefix === 'string'
    )
    .filter((item) => !RETIRED_MIRROR_IDS.has(item.id))
    .map((item) => ({
      id: item.id,
      label: typeof item.label === 'string' ? item.label : item.prefix,
      prefix: item.prefix,
    }));
  const missing = defaultList.filter((preset) => !kept.some((item) => item.id === preset.id));
  return [...kept, ...missing];
};

export const migrateAdvancedSettings = (
  persisted: unknown,
  defaults: AdvancedSettingsValues
): AdvancedSettingsValues => {
  if (!isRecord(persisted)) {
    return defaults;
  }
  const merged = {
    ...defaults,
    ...(pickKeys(persisted, advancedSettingsKeys) as Partial<AdvancedSettingsValues>),
  };
  return {
    ...merged,
    githubMirrorList: mergeGithubMirrorList(merged.githubMirrorList, defaults),
  };
};

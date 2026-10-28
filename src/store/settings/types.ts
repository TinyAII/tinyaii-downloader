export type ThemeMode = 'system' | 'light' | 'dark';
export type ProgressBarScope = 'all' | 'downloading';
export type StartupResumeMode = 'all' | 'paused' | 'failed';

export interface BasicSettingsValues {
  language: string;
  autoUpdate: boolean;
  updateFreq: string;
  lastUpdateCheckAt: string;
  theme: ThemeMode;
  showProgress: boolean;
  progressBarScope: ProgressBarScope;
  minimizeToTray: boolean;
  startupMinimize: boolean;
  startupAutoRun: boolean;
  startupRestore: boolean;
  startupResume: boolean;
  startupResumeMode: StartupResumeMode;
  autoDownloadTorrent: boolean;
  forceEncrypt: boolean;
  keepSeeding: boolean;
  resumeBreakpoint: boolean;
  jumpToDownload: boolean;
  notifyOnComplete: boolean;
  noConfirmOnDelete: boolean;
  deleteTorrentOnComplete: boolean;
  deleteRecordOnMissing: boolean;
  defaultDownloadDir: string;
  uploadLimitValue: number;
  uploadLimitUnit: 'KB/s' | 'MB/s';
  downloadLimitValue: number;
  downloadLimitUnit: 'KB/s' | 'MB/s';
  seedRatio: number;
  seedTimeMinutes: number;
  maxConcurrentDownloads: number;
  defaultSplitCount: number;
  maxConnectionsPerServer: number;
  // 重连冷却（秒）：同一任务两次软重启的最小间隔，避免频繁 pause→start 刺激源站
  reconnectCooldownSeconds: number;
  // 速度衰减阈值（KB/s）：速度持续低于此值时建议重连，曲线红线位置
  reconnectSpeedThresholdKB: number;
}

export interface AdvancedSettingsValues {
  useProxy: boolean;
  proxyProtocol: 'http' | 'https' | 'socks5';
  proxyHost: string;
  proxyPort: number;
  proxyUsername: string;
  proxyPassword: string;
  proxyBypass: string;
  trackerSource: string;
  trackerList: string;
  trackerLocalDirs: string;
  autoUpdateTracker: boolean;
  rpcPort: number;
  rpcSecret: string;
  aria2ExecutablePath: string;
  enableDeveloperLogs: boolean;
  showDeveloperLogsEntry: boolean;
  developerLogLevel: 'debug' | 'info' | 'warn' | 'error';
  developerLogMaxEntries: number;
  upnp: boolean;
  btPort: number;
  dhtPort: number;
  listenPortSyncMode: 'independent' | 'same' | 'adjacent';
  listenPortHistory: string;
  userAgent: string;
  userAgentRules: string;
  logLevel: string;
}

export type SettingsValues = BasicSettingsValues & AdvancedSettingsValues;

export interface SettingsState extends SettingsValues {
  updateSetting: <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => void;
  resetSettings: () => void;
}

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, X, Minus, Plus, Box, Eye, EyeOff, FolderOpen, ExternalLink, Download, Trash2, Gauge, AlertTriangle } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import { useNavigate } from 'react-router-dom';
import { Toggle } from '../../components/ui/Toggle';
import { Select } from '../../components/ui/Select';
import { Section, Row } from '../../components/ui/SettingLayout';
import { safeJson, useDeveloperLogStore, writeDeveloperLog } from '../../store/developerLogStore';
import { useBasicSettingsStore } from '../../store/settings/basicStore';
import { advancedSettingsDefaults, basicSettingsDefaults } from '../../store/settings/defaults';
import { useAdvancedSettingsStore } from '../../store/settings/advancedStore';
import { advancedSettingsKeys, basicSettingsKeys, migrateAdvancedSettings, migrateBasicSettings } from '../../store/settings/migration';
import { useAdvancedSettingsValues, useSettingsActions } from '../../store/settings/selectors';
import { appGetFileMeta, appGetInstallDir, appHttpGetText, appProbeListenPorts, appReadTextFile, appTruncateTextFile, aria2GetEngineStatus, aria2RestartEngine, type Aria2EngineStatus } from '../../services/download/aria2RpcEngine';
import { parseUserAgentRules, USER_AGENT_MAX_LENGTH } from '../../utils/taskValidation';
import { useTaskStore } from '../../store/tasks';
import { formatBytes } from '../../utils/format';
import type { AdvancedSettingsValues, BasicSettingsValues } from '../../store/settings/types';
import { normalizeTrackerLines, TRACKER_REMOTE_URLS, TRACKER_SOURCE_OPTIONS } from '../../utils/trackerSources';

type NoticeType = 'info' | 'warning' | 'success';
type TrackerSyncPreview = {
  source: string;
  path: string;
  nextList: string;
  nextCount: number;
  added: string[];
  removed: string[];
};
type RpcProbeState = {
  status: 'online' | 'auth_failed' | 'offline';
  message: string;
  version: string;
};
type ListenPortProbeState = {
  btAvailable: boolean;
  dhtAvailable: boolean;
  btTcpAvailable: boolean;
  btUdpAvailable: boolean;
  dhtTcpAvailable: boolean;
  dhtUdpAvailable: boolean;
  checkedAt: number;
};
type AppLogLevelFilter = 'all' | 'error' | 'warn' | 'info' | 'debug';
type AppLogPreviewLine = {
  id: string;
  text: string;
  level: Exclude<AppLogLevelFilter, 'all'>;
  timestampMs: number | null;
};
type DownloadHistoryStatusFilter = 'all' | 'completed' | 'failed' | 'paused' | 'stopped';
type DownloadHistoryCheckResult = {
  checkedAt: string;
  issueCount: number;
  samples: string[];
};
type RestoreActionType = 'advanced' | 'factory';
const APP_LOG_ROTATION_THRESHOLD_BYTES = 10 * 1024 * 1024;
const APP_LOG_RECENT_MINUTES_OPTIONS = [
  { label: '全部', value: '0' },
  { label: '最近 5 分钟', value: '5' },
  { label: '最近 15 分钟', value: '15' },
  { label: '最近 60 分钟', value: '60' },
  { label: '最近 360 分钟', value: '360' },
];

function escapeRegExp(source: string) {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectAppLogLineLevel(line: string): Exclude<AppLogLevelFilter, 'all'> {
  const lower = line.toLowerCase();
  if (lower.includes('error')) return 'error';
  if (lower.includes('warn')) return 'warn';
  if (lower.includes('debug')) return 'debug';
  return 'info';
}

function parseAppLogTimestampMs(line: string) {
  const match = line.match(/(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,3})?)/);
  if (!match) return null;
  const normalized = match[1].replace(' ', 'T').replace(',', '.');
  const ms = new Date(normalized).getTime();
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function highlightAppLogText(text: string, keyword: string) {
  if (!keyword.trim()) return text;
  const pattern = new RegExp(`(${escapeRegExp(keyword.trim())})`, 'ig');
  const parts = text.split(pattern);
  return parts.map((part, index) => {
    if (!part) return null;
    if (part.toLowerCase() === keyword.trim().toLowerCase()) {
      return <mark key={`${index}-${part}`} className="bg-[#ffe7b3] text-text-main px-[1px] rounded-sm">{part}</mark>;
    }
    return <span key={`${index}-${part}`}>{part}</span>;
  });
}

function formatDateTime(timestamp: number | null | undefined) {
  if (!timestamp || !Number.isFinite(timestamp)) return '--';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function randomPort() {
  return Math.floor(Math.random() * 30000) + 10000;
}

function randomPortInRange(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomSecret(length = 24) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function normalizeProxyPort(value: number, fallback: number) {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.floor(clamp(parsed, 1, 65535));
}

const TRACKER_PRESETS = {
  best: {
    source: 'trackers_best.txt',
    list: advancedSettingsDefaults.trackerList,
  },
  balanced: {
    source: 'trackers_balanced.txt',
    list: [
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://open.demonii.com:1337/announce',
      'https://torrent.tracker.durukanbal.com:443/announce',
      'udp://tracker.torrent.eu.org:451/announce',
    ].join('\n'),
  },
  minimal: {
    source: 'trackers_minimal.txt',
    list: [
      'udp://tracker.opentrackr.org:1337/announce',
      'udp://open.demonii.com:1337/announce',
    ].join('\n'),
  },
};

const USER_AGENT_PRESETS = {
  aria2: 'aria2/1.37.0',
  transmission: 'Transmission/4.0.6',
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0',
  curl: 'curl/8.7.1',
} as const;

const LEGACY_TRACKER_LOCAL_DIRS = [
  'c:\\Users\\XIAOJIE\\Desktop\\xiazai\\trackerslist-master',
  'c:\\Users\\XIAOJIE\\Desktop\\xiazai\\TrackersListCollection-master',
];
const TRACKER_FILE_CANDIDATES: Record<string, string[]> = {
  'trackers_best.txt': ['trackers_best.txt', 'best_aria2.txt', 'best.txt'],
  'trackers_balanced.txt': ['trackers_all_udp.txt', 'all_aria2.txt', 'all.txt'],
  'trackers_minimal.txt': ['trackers_all_https.txt', 'nohttp_aria2.txt', 'http_aria2.txt'],
  'best_aria2.txt': ['best_aria2.txt', 'best.txt', 'trackers_best.txt'],
  'all_aria2.txt': ['all_aria2.txt', 'all.txt', 'trackers_all_udp.txt'],
  'http_aria2.txt': ['http_aria2.txt', 'http.txt', 'trackers_all_https.txt'],
  'nohttp_aria2.txt': ['nohttp_aria2.txt', 'nohttp.txt', 'trackers_all_udp.txt'],
  custom: [],
};

function joinWindowsPath(baseDir: string, fileName: string) {
  const normalized = baseDir.trim().replace(/[\\/]+$/, '');
  if (!normalized) return fileName;
  return `${normalized}\\${fileName}`;
}

function parseTrackerLocalDirs(raw: string) {
  return Array.from(
    new Set(
      raw
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function normalizePathForCompare(path: string) {
  return path.trim().replace(/[\\/]+/g, '\\').toLowerCase();
}

function buildDefaultTrackerLocalDirs(installDir: string) {
  if (!installDir.trim()) return [] as string[];
  return Array.from(
    new Set([
      joinWindowsPath(installDir, 'trackerslist-master'),
      joinWindowsPath(installDir, 'TrackersListCollection-master'),
      installDir,
    ])
  );
}

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error.trim();
  return String(error);
}

function isMissingFileError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes('文件不存在') || normalized.includes('no such file');
}

function normalizeUserAgent(raw: string) {
  return raw
    .replace(/\r/g, '\n')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function resolveTrackerCandidatePaths(baseDirs: string[], source: string) {
  const fileNames = TRACKER_FILE_CANDIDATES[source] ?? [source];
  const dirs = baseDirs.map((item) => item.trim()).filter(Boolean);
  const nestedSuffixes = ['', 'trackerslist-master', 'TrackersListCollection-master'];
  return dirs.flatMap((dir) => nestedSuffixes.flatMap((suffix) => {
    const root = suffix ? joinWindowsPath(dir, suffix) : dir;
    return fileNames.map((fileName) => joinWindowsPath(root, fileName));
  }));
}

async function readTrackerSource(source: string, baseDirs: string[]) {
  const candidatePaths = resolveTrackerCandidatePaths(baseDirs, source);
  const remoteUrls = TRACKER_REMOTE_URLS[source] ?? [];
  const candidates = Array.from(new Set([...candidatePaths, ...remoteUrls]));
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const content = candidate.startsWith('http://') || candidate.startsWith('https://')
        ? await appHttpGetText(candidate)
        : await appReadTextFile(candidate);
      return {
        source: candidate,
        content,
        candidatesTried: candidates.length,
      };
    } catch (error) {
      errors.push(`${candidate} -> ${normalizeErrorMessage(error)}`);
    }
  }
  return {
    source: '',
    content: '',
    candidatesTried: candidates.length,
    errors,
  };
}

function parseListenPortHistory(raw: string) {
  const seen = new Set<string>();
  const pairs: { btPort: number; dhtPort: number }[] = [];
  raw
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((line) => {
      const [btRaw, dhtRaw] = line.split(':');
      const btPort = clamp(toNumber(btRaw ?? '', 0), 1, 65535);
      const dhtPort = clamp(toNumber(dhtRaw ?? '', 0), 1, 65535);
      if (!Number.isFinite(btPort) || !Number.isFinite(dhtPort)) return;
      const key = `${btPort}:${dhtPort}`;
      if (seen.has(key)) return;
      seen.add(key);
      pairs.push({ btPort, dhtPort });
    });
  return pairs;
}

export default function AdvancedSettings() {
  const navigate = useNavigate();
  const {
    useProxy,
    proxyProtocol,
    proxyHost,
    proxyPort,
    proxyUsername,
    proxyPassword,
    proxyBypass,
    trackerSource,
    trackerList,
    trackerLocalDirs,
    autoUpdateTracker,
    rpcPort,
    rpcSecret,
    aria2ExecutablePath,
    enableDeveloperLogs,
    showDeveloperLogsEntry,
    developerLogLevel,
    developerLogMaxEntries,
    upnp,
    btPort,
    dhtPort,
    listenPortSyncMode,
    listenPortHistory,
    userAgent,
    userAgentRules,
    logLevel,
  } = useAdvancedSettingsValues();
  const { updateSetting } = useSettingsActions();
  const resetAdvancedSettings = useAdvancedSettingsStore((state) => state.resetAdvancedSettings);
  const resetBasicSettings = useBasicSettingsStore((state) => state.resetBasicSettings);
  const logs = useDeveloperLogStore((state) => state.logs);
  const clearLogs = useDeveloperLogStore((state) => state.clearLogs);
  const [showSecret, setShowSecret] = useState(false);
  const [showProxyPassword, setShowProxyPassword] = useState(false);
  const [installDir, setInstallDir] = useState('');
  const [trackerSyncAt, setTrackerSyncAt] = useState('');
  const [syncFailures, setSyncFailures] = useState<string[]>([]);
  const [trackerSyncPreview, setTrackerSyncPreview] = useState<TrackerSyncPreview | null>(null);
  const [rpcProbeState, setRpcProbeState] = useState<RpcProbeState | null>(null);
  const [rpcProbing, setRpcProbing] = useState(false);
  const [engineProbeState, setEngineProbeState] = useState<Aria2EngineStatus | null>(null);
  const [engineProbing, setEngineProbing] = useState(false);
  const [clearingAllTasks, setClearingAllTasks] = useState(false);
  const [appLogReading, setAppLogReading] = useState(false);
  const [appLogClearing, setAppLogClearing] = useState(false);
  const [appLogContent, setAppLogContent] = useState('');
  const [appLogUpdatedAt, setAppLogUpdatedAt] = useState('');
  const [appLogFileSizeBytes, setAppLogFileSizeBytes] = useState(0);
  const [appLogFileModifiedAt, setAppLogFileModifiedAt] = useState<number | null>(null);
  const [appLogRecentMinutes, setAppLogRecentMinutes] = useState(0);
  const [appLogLevelFilter, setAppLogLevelFilter] = useState<AppLogLevelFilter>('all');
  const [appLogKeyword, setAppLogKeyword] = useState('');
  const [downloadHistoryFilter, setDownloadHistoryFilter] = useState<DownloadHistoryStatusFilter>('all');
  const [downloadHistoryKeyword, setDownloadHistoryKeyword] = useState('');
  const [downloadHistoryCheck, setDownloadHistoryCheck] = useState<DownloadHistoryCheckResult | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [restoreAction, setRestoreAction] = useState<RestoreActionType | null>(null);
  const [restoreToken, setRestoreToken] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [listenPortProbing, setListenPortProbing] = useState(false);
  const [listenPortProbeState, setListenPortProbeState] = useState<ListenPortProbeState | null>(null);
  const [notices, setNotices] = useState<{ id: number; type: NoticeType; text: string }[]>([]);
  const [restarting, setRestarting] = useState(false);
  const clearAllTasks = useTaskStore((state) => state.clearAllTasks);
  const clearCompletedTasks = useTaskStore((state) => state.clearCompleted);
  const tasks = useTaskStore((state) => state.tasks);
  const trackerDefaultLocalDirs = useMemo(() => buildDefaultTrackerLocalDirs(installDir), [installDir]);
  const trackerLocalDirList = useMemo(() => {
    const legacySet = new Set(LEGACY_TRACKER_LOCAL_DIRS.map((item) => normalizePathForCompare(item)));
    const parsed = parseTrackerLocalDirs(trackerLocalDirs).filter((item) => !legacySet.has(normalizePathForCompare(item)));
    return parsed.length > 0 ? parsed : trackerDefaultLocalDirs;
  }, [trackerDefaultLocalDirs, trackerLocalDirs]);
  const trackerPrimaryLocalDir = trackerLocalDirList[0] ?? trackerDefaultLocalDirs[0] ?? '';
  const listenPortHistoryItems = useMemo(() => parseListenPortHistory(listenPortHistory), [listenPortHistory]);

  const pushNotice = (type: NoticeType, text: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setNotices((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setNotices((prev) => prev.filter((item) => item.id !== id));
    }, 4500);
  };

  useEffect(() => {
    if (!trackerLocalDirs.trim()) return;
    const legacySet = new Set(LEGACY_TRACKER_LOCAL_DIRS.map((item) => normalizePathForCompare(item)));
    const parsed = parseTrackerLocalDirs(trackerLocalDirs);
    if (parsed.length === 0) return;
    const sanitized = parsed.filter((item) => !legacySet.has(normalizePathForCompare(item)));
    if (sanitized.length === parsed.length) return;
    updateSetting('trackerLocalDirs', sanitized.join('\n'));
    pushNotice('info', sanitized.length === 0 ? '已移除旧机器 Tracker 目录，当前改为自动使用安装目录' : '已移除不可移植的旧机器 Tracker 目录');
  }, [trackerLocalDirs, updateSetting]);

  useEffect(() => {
    let canceled = false;
    const loadInstallDir = async () => {
      try {
        const dir = await appGetInstallDir();
        if (canceled) return;
        setInstallDir(dir);
      } catch (error) {
        if (canceled) return;
        writeDeveloperLog({
          source: 'advanced-settings',
          action: 'load_install_dir',
          level: 'warn',
          message: String(error),
        });
      }
    };
    void loadInstallDir();
    return () => {
      canceled = true;
    };
  }, []);

  const taskCachePath = installDir ? `${installDir}\\task-cache` : '';
  const appLogPath = installDir ? `${installDir}\\logs\\app.log` : '';
  const appLogLineCount = useMemo(() => {
    if (!appLogContent.trim()) return 0;
    return appLogContent.split(/\r?\n/).length;
  }, [appLogContent]);
  const appLogPreviewLines = useMemo(() => {
    if (!appLogContent.trim()) return [] as AppLogPreviewLine[];
    return appLogContent
      .split(/\r?\n/)
      .filter((item) => item.trim())
      .map((item, index) => ({
        id: `${index}-${item.slice(0, 32)}`,
        text: item,
        level: detectAppLogLineLevel(item),
        timestampMs: parseAppLogTimestampMs(item),
      }));
  }, [appLogContent]);
  const appLogFilteredLines = useMemo(() => {
    const keyword = appLogKeyword.trim().toLowerCase();
    const lowerBound = appLogRecentMinutes > 0 ? Date.now() - appLogRecentMinutes * 60 * 1000 : null;
    return appLogPreviewLines.filter((item) => {
      if (appLogLevelFilter !== 'all' && item.level !== appLogLevelFilter) return false;
      if (lowerBound !== null && item.timestampMs !== null && item.timestampMs < lowerBound) return false;
      if (keyword && !item.text.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [appLogKeyword, appLogLevelFilter, appLogPreviewLines, appLogRecentMinutes]);
  const appLogRotationRatio = useMemo(() => {
    if (APP_LOG_ROTATION_THRESHOLD_BYTES <= 0) return 0;
    return Math.min(1, appLogFileSizeBytes / APP_LOG_ROTATION_THRESHOLD_BYTES);
  }, [appLogFileSizeBytes]);
  const historyTasks = useMemo(() => tasks
    .filter((task) => task.status !== 'downloading')
    .sort((a, b) => {
      const ta = a.completedAt ?? a.createdAt ?? 0;
      const tb = b.completedAt ?? b.createdAt ?? 0;
      return tb - ta;
    }), [tasks]);
  const historySummary = useMemo(() => {
    const summary = { completed: 0, failed: 0, paused: 0, stopped: 0, totalBytes: 0 };
    historyTasks.forEach((task) => {
      if (task.status === 'completed') summary.completed += 1;
      if (task.status === 'failed') summary.failed += 1;
      if (task.status === 'paused') summary.paused += 1;
      if (task.status === 'stopped') summary.stopped += 1;
      if (task.status === 'completed') summary.totalBytes += task.totalBytes > 0 ? task.totalBytes : task.downloadedBytes;
    });
    return summary;
  }, [historyTasks]);
  const filteredHistoryTasks = useMemo(() => {
    const keyword = downloadHistoryKeyword.trim().toLowerCase();
    return historyTasks.filter((task) => {
      if (downloadHistoryFilter !== 'all' && task.status !== downloadHistoryFilter) return false;
      if (!keyword) return true;
      const target = `${task.name} ${task.url} ${task.savePath}`.toLowerCase();
      return target.includes(keyword);
    });
  }, [downloadHistoryFilter, downloadHistoryKeyword, historyTasks]);
  const restoreScopeSummary = useMemo(() => ({
    taskCount: tasks.length,
    completedCount: tasks.filter((task) => task.status === 'completed').length,
    logCount: logs.length,
  }), [logs.length, tasks]);

  const handleCheckDownloadHistoryIntegrity = () => {
    const samples: string[] = [];
    let issueCount = 0;
    historyTasks.forEach((task) => {
      const taskLabel = `${task.name || task.id}(${task.id.slice(-6)})`;
      if (!task.savePath.trim()) {
        issueCount += 1;
        if (samples.length < 6) samples.push(`${taskLabel} 缺少保存路径`);
      }
      if (task.status === 'completed') {
        const total = task.totalBytes > 0 ? task.totalBytes : task.downloadedBytes;
        if (total <= 0) {
          issueCount += 1;
          if (samples.length < 6) samples.push(`${taskLabel} 文件大小异常`);
        }
        if (task.downloadedBytes < total) {
          issueCount += 1;
          if (samples.length < 6) samples.push(`${taskLabel} 已完成但下载量不足`);
        }
        if (task.files.some((item) => item.length > 0 && item.completedLength < item.length)) {
          issueCount += 1;
          if (samples.length < 6) samples.push(`${taskLabel} 文件条目未全部完成`);
        }
      }
      if (task.status === 'failed' && !(task.errorMessage ?? '').trim() && !(task.errorCode ?? '').trim()) {
        issueCount += 1;
        if (samples.length < 6) samples.push(`${taskLabel} 失败任务缺少错误信息`);
      }
    });
    const result: DownloadHistoryCheckResult = {
      checkedAt: new Date().toISOString(),
      issueCount,
      samples,
    };
    setDownloadHistoryCheck(result);
    if (issueCount === 0) {
      pushNotice('success', `完整性检查通过（共 ${historyTasks.length} 条）`);
      return;
    }
    pushNotice('warning', `完整性检查发现 ${issueCount} 个问题，请查看下方结果`);
  };

  const handleOpenDownloadHistory = () => {
    navigate('/completed');
  };

  const handleClearDownloadHistory = async () => {
    if (clearingHistory) return;
    setClearingHistory(true);
    try {
      await clearCompletedTasks();
      setDownloadHistoryCheck(null);
      pushNotice('success', '下载历史已清空（已完成记录）');
    } catch (error) {
      writeDeveloperLog({
        source: 'advanced-settings',
        action: 'clear_download_history',
        level: 'warn',
        message: String(error),
      });
      pushNotice('warning', `清空下载历史失败：${normalizeErrorMessage(error)}`);
    } finally {
      setClearingHistory(false);
    }
  };

  const handleOpenPath = async (path: string, fallbackMessage: string) => {
    if (!path) {
      pushNotice('warning', fallbackMessage);
      return;
    }
    try {
      await openPath(path);
    } catch (error) {
      writeDeveloperLog({
        source: 'advanced-settings',
        action: 'open_path',
        level: 'error',
        message: String(error),
        details: safeJson({ path }),
      });
      pushNotice('warning', '打开路径失败，请检查权限');
    }
  };

  const handleExportDiagnostics = async () => {
    try {
      const payload = safeJson(
        logs.map((item) => ({
          timestamp: item.timestamp,
          source: item.source,
          action: item.action,
          level: item.level,
          message: item.message,
          details: item.details ?? '',
        }))
      );
      const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `developer-diagnostics-${Date.now()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      pushNotice('success', '诊断日志已导出');
    } catch (error) {
      writeDeveloperLog({
        source: 'advanced-settings',
        action: 'export_diagnostics',
        level: 'error',
        message: String(error),
      });
      pushNotice('warning', '导出失败，请稍后重试');
    }
  };

  const handleRefreshAppLog = async () => {
    if (!appLogPath) {
      pushNotice('warning', '日志路径未就绪');
      return;
    }
    if (appLogReading) return;
    setAppLogReading(true);
    try {
      const [content, meta] = await Promise.all([appReadTextFile(appLogPath), appGetFileMeta(appLogPath)]);
      const lines = content.split(/\r?\n/);
      setAppLogContent(lines.slice(-400).join('\n'));
      setAppLogUpdatedAt(new Date().toISOString());
      setAppLogFileSizeBytes(meta.sizeBytes ?? 0);
      setAppLogFileModifiedAt(meta.modifiedAt ?? null);
      pushNotice('success', `日志已刷新（共 ${lines.filter((item) => item.trim()).length} 行，预览末尾 400 行）`);
    } catch (error) {
      const message = normalizeErrorMessage(error);
      if (isMissingFileError(message)) {
        setAppLogContent('');
        setAppLogUpdatedAt(new Date().toISOString());
        setAppLogFileSizeBytes(0);
        setAppLogFileModifiedAt(null);
        pushNotice('info', 'app.log 尚未生成，当前无可读取内容');
        return;
      }
      writeDeveloperLog({
        source: 'advanced-settings',
        action: 'refresh_app_log',
        level: 'warn',
        message,
        details: safeJson({ appLogPath }),
      });
      pushNotice('warning', `读取应用日志失败：${message}`);
    } finally {
      setAppLogReading(false);
    }
  };

  const handleDownloadAppLog = async () => {
    if (!appLogPath) {
      pushNotice('warning', '日志路径未就绪');
      return;
    }
    try {
      const content = await appReadTextFile(appLogPath);
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `app-log-${Date.now()}.log`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      pushNotice('success', '应用日志已导出');
    } catch (error) {
      writeDeveloperLog({
        source: 'advanced-settings',
        action: 'download_app_log',
        level: 'warn',
        message: String(error),
        details: safeJson({ appLogPath }),
      });
      pushNotice('warning', `导出应用日志失败：${normalizeErrorMessage(error)}`);
    }
  };

  const handleClearAppLog = async () => {
    if (!appLogPath) {
      pushNotice('warning', '日志路径未就绪');
      return;
    }
    if (appLogClearing) return;
    setAppLogClearing(true);
    try {
      await appTruncateTextFile(appLogPath);
      setAppLogContent('');
      setAppLogUpdatedAt(new Date().toISOString());
      setAppLogFileSizeBytes(0);
      setAppLogFileModifiedAt(Date.now());
      pushNotice('success', '应用日志已清空');
    } catch (error) {
      writeDeveloperLog({
        source: 'advanced-settings',
        action: 'clear_app_log',
        level: 'error',
        message: String(error),
        details: safeJson({ appLogPath }),
      });
      pushNotice('warning', `清空应用日志失败：${normalizeErrorMessage(error)}`);
    } finally {
      setAppLogClearing(false);
    }
  };

  useEffect(() => {
    if (!appLogPath) return;
    void handleRefreshAppLog();
  }, [appLogPath]);

  const loadTrackerSyncPreview = async () => {
    const currentSource = (trackerSource || '').trim() || 'trackers_best.txt';
    const result = await readTrackerSource(currentSource, trackerLocalDirList);
    if (result.content) {
      const normalized = normalizeTrackerLines(result.content);
      const currentNormalized = normalizeTrackerLines(trackerList);
      const currentSet = new Set(currentNormalized);
      const nextSet = new Set(normalized);
      const added = normalized.filter((line) => !currentSet.has(line));
      const removed = currentNormalized.filter((line) => !nextSet.has(line));
      setTrackerSyncPreview({
        source: currentSource,
        path: result.source,
        nextList: normalized.join('\n'),
        nextCount: normalized.length,
        added,
        removed,
      });
      setSyncFailures([]);
      return;
    }
    setTrackerSyncPreview(null);
    setSyncFailures((result.errors ?? []).slice(0, 8));
    const normalized = normalizeTrackerLines(trackerList);
    updateSetting('trackerList', normalized.join('\n'));
    pushNotice('warning', `未找到可用 Tracker 来源，已仅完成去重。共尝试 ${result.candidatesTried} 个候选项`);
  };

  const handleApplyTrackerSyncPreview = () => {
    if (!trackerSyncPreview) return;
    updateSetting('trackerSource', trackerSyncPreview.source);
    updateSetting('trackerList', trackerSyncPreview.nextList);
    setTrackerSyncAt(new Date().toISOString());
    pushNotice('success', `已应用同步：${trackerSyncPreview.nextCount} 条，新增 ${trackerSyncPreview.added.length}，移除 ${trackerSyncPreview.removed.length}`);
    setTrackerSyncPreview(null);
  };

  const handlePickTrackerLocalDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: trackerPrimaryLocalDir || undefined,
      });
      if (selected && typeof selected === 'string') {
        const nextDirs = [selected, ...trackerLocalDirList.filter((item) => item !== selected)];
        updateSetting('trackerLocalDirs', nextDirs.join('\n'));
      }
    } catch (error) {
      writeDeveloperLog({
        source: 'advanced-settings',
        action: 'select_tracker_local_dir',
        level: 'warn',
        message: String(error),
      });
      pushNotice('warning', '无法打开目录选择器');
    }
  };

  const handleRestartEngine = async () => {
    if (restarting) return;
    setRestarting(true);
    pushNotice('info', '正在更新并重启 aria2 引擎...');
    try {
      await aria2RestartEngine();
      const status = await aria2GetEngineStatus(true);
      setEngineProbeState(status);
      if (status.status === 'online') {
        pushNotice('success', 'aria2 引擎已在线');
      } else if (status.status === 'auth_failed') {
        pushNotice('warning', 'aria2 鉴权失败，请检查 RPC 密钥');
      } else {
        pushNotice('warning', 'aria2 仍离线，请检查端口和可执行路径');
      }
    } catch (error) {
      pushNotice('warning', String(error));
    } finally {
      setRestarting(false);
    }
  };

  const handleProbeAria2Engine = async (forceRefresh: boolean) => {
    if (engineProbing) return;
    setEngineProbing(true);
    try {
      const status = await aria2GetEngineStatus(forceRefresh, {
        rpcPort,
        rpcSecret,
        aria2ExecutablePath,
      });
      setEngineProbeState(status);
      if (status.status === 'online') {
        pushNotice('success', `引擎在线：${status.version}`);
      } else if (status.status === 'auth_failed') {
        pushNotice('warning', '引擎鉴权失败，请检查 RPC 密钥');
      } else {
        pushNotice('warning', '引擎离线，请检查可执行文件与端口');
      }
    } catch (error) {
      setEngineProbeState({
        status: 'offline',
        version: '不可用',
        enabledFeatures: [],
        message: normalizeErrorMessage(error),
      });
      pushNotice('warning', `引擎检测失败：${normalizeErrorMessage(error)}`);
    } finally {
      setEngineProbing(false);
    }
  };

  const handleClearAllTasksWithNotice = async () => {
    if (clearingAllTasks) return;
    setClearingAllTasks(true);
    try {
      await clearAllTasks();
      pushNotice('success', '已清除所有任务');
    } finally {
      setClearingAllTasks(false);
    }
  };

  const handleRestoreSettings = async () => {
    if (!restoreAction || restoring) return;
    if (restoreAction === 'factory' && restoreToken.trim().toUpperCase() !== 'RESET') {
      pushNotice('warning', '请输入 RESET 以确认恢复出厂设置');
      return;
    }
    setRestoring(true);
    try {
      if (restoreAction === 'advanced') {
        resetAdvancedSettings();
        setRpcProbeState(null);
        setEngineProbeState(null);
        setListenPortProbeState(null);
        setTrackerSyncPreview(null);
        setSyncFailures([]);
        pushNotice('success', '进阶设置已恢复默认值');
      } else {
        resetBasicSettings();
        resetAdvancedSettings();
        clearLogs();
        await clearAllTasks();
        setDownloadHistoryCheck(null);
        if (appLogPath) {
          await appTruncateTextFile(appLogPath);
          setAppLogContent('');
          setAppLogUpdatedAt(new Date().toISOString());
          setAppLogFileSizeBytes(0);
          setAppLogFileModifiedAt(Date.now());
        }
        pushNotice('success', `已恢复出厂设置，清理任务 ${restoreScopeSummary.taskCount} 条、开发者日志 ${restoreScopeSummary.logCount} 条`);
      }
      setRestoreAction(null);
      setRestoreToken('');
    } catch (error) {
      writeDeveloperLog({
        source: 'advanced-settings',
        action: 'restore_settings',
        level: 'error',
        message: String(error),
      });
      pushNotice('warning', `恢复设置失败：${normalizeErrorMessage(error)}`);
    } finally {
      setRestoring(false);
    }
  };

  const handleOpenRestoreDialog = (action: RestoreActionType) => {
    setRestoreAction(action);
    setRestoreToken('');
  };

  const handleExportSettingsBackup = async () => {
    try {
      const basicState = useBasicSettingsStore.getState();
      const advancedState = useAdvancedSettingsStore.getState();
      const basicPayload = Object.fromEntries(
        basicSettingsKeys.map((key) => [key, basicState[key]])
      ) as unknown as BasicSettingsValues;
      const advancedPayload = Object.fromEntries(
        advancedSettingsKeys.map((key) => [key, advancedState[key]])
      ) as unknown as AdvancedSettingsValues;
      const payload = safeJson({
        exportedAt: new Date().toISOString(),
        schemaVersion: 1,
        basic: basicPayload,
        advanced: advancedPayload,
      });
      const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `tinyaii-settings-backup-${Date.now()}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      pushNotice('success', '设置备份已导出');
    } catch (error) {
      writeDeveloperLog({
        source: 'advanced-settings',
        action: 'export_settings_backup',
        level: 'warn',
        message: String(error),
      });
      pushNotice('warning', '导出设置备份失败');
    }
  };

  const handleImportSettingsBackup = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (!selected || Array.isArray(selected)) return;
      const content = await appReadTextFile(selected);
      const parsed = JSON.parse(content) as {
        basic?: unknown;
        advanced?: unknown;
      };
      const nextBasic = migrateBasicSettings(parsed.basic, basicSettingsDefaults);
      const nextAdvanced = migrateAdvancedSettings(parsed.advanced, advancedSettingsDefaults);
      const basicStore = useBasicSettingsStore.getState();
      const advancedStore = useAdvancedSettingsStore.getState();
      basicSettingsKeys.forEach((key) => basicStore.updateBasicSetting(key, nextBasic[key]));
      advancedSettingsKeys.forEach((key) => advancedStore.updateAdvancedSetting(key, nextAdvanced[key]));
      pushNotice('success', '设置备份已导入');
    } catch (error) {
      writeDeveloperLog({
        source: 'advanced-settings',
        action: 'import_settings_backup',
        level: 'warn',
        message: String(error),
      });
      pushNotice('warning', `导入设置备份失败：${normalizeErrorMessage(error)}`);
    }
  };

  const handleApply = () => {
    pushNotice('success', '进阶设置已保存并应用');
  };

  const handleDiscard = () => {
    resetAdvancedSettings();
    pushNotice('info', '已放弃修改并恢复默认值');
  };

  const handleApplyProxyPreset = (preset: 'off' | 'http' | 'socks5') => {
    if (preset === 'off') {
      updateSetting('useProxy', false);
      pushNotice('info', '已切换为直连模式');
      return;
    }
    if (preset === 'http') {
      updateSetting('useProxy', true);
      updateSetting('proxyProtocol', 'http');
      updateSetting('proxyHost', '127.0.0.1');
      updateSetting('proxyPort', 7890);
      pushNotice('info', '已应用 HTTP 代理预设');
      return;
    }
    updateSetting('useProxy', true);
    updateSetting('proxyProtocol', 'socks5');
    updateSetting('proxyHost', '127.0.0.1');
    updateSetting('proxyPort', 1080);
    pushNotice('info', '已应用 SOCKS5 代理预设');
  };

  const handleApplyTrackerPreset = (preset: 'best' | 'balanced' | 'minimal') => {
    const selected = TRACKER_PRESETS[preset];
    updateSetting('trackerSource', selected.source);
    updateSetting('trackerList', selected.list);
    pushNotice('info', `已应用 ${preset === 'best' ? '高可用' : preset === 'balanced' ? '均衡' : '精简'} Tracker 预设`);
  };

  const handleDeduplicateTrackers = () => {
    const normalized = normalizeTrackerLines(trackerList);
    updateSetting('trackerList', normalized.join('\n'));
    pushNotice('info', `去重完成，保留 ${normalized.length} 条`);
  };

  const handleClearTrackers = () => {
    updateSetting('trackerSource', 'custom');
    updateSetting('trackerList', '');
    pushNotice('info', 'Tracker 列表已清空');
  };

  const handleApplyRpcPreset = (preset: 'default' | 'secure' | 'lan') => {
    if (preset === 'default') {
      updateSetting('rpcPort', 16800);
      updateSetting('rpcSecret', '');
      setRpcProbeState(null);
      pushNotice('info', '已应用默认 RPC 预设');
      return;
    }
    if (preset === 'secure') {
      updateSetting('rpcPort', 16800);
      updateSetting('rpcSecret', randomSecret(24));
      setRpcProbeState(null);
      pushNotice('info', '已应用安全 RPC 预设');
      return;
    }
    updateSetting('rpcPort', 6800);
    updateSetting('rpcSecret', rpcSecret.trim() || randomSecret(24));
    setRpcProbeState(null);
    pushNotice('info', '已应用局域网 RPC 预设');
  };

  const handleProbeRpcConfig = async () => {
    if (rpcProbing) return;
    setRpcProbing(true);
    setRpcProbeState(null);
    try {
      const status = await aria2GetEngineStatus(true, {
        rpcPort,
        rpcSecret,
        aria2ExecutablePath,
      });
      setRpcProbeState({
        status: status.status,
        message: status.message,
        version: status.version,
      });
      if (status.status === 'online') {
        pushNotice('success', `RPC 可用：${status.version}`);
      } else if (status.status === 'auth_failed') {
        pushNotice('warning', 'RPC 鉴权失败，请检查密钥');
      } else {
        pushNotice('warning', 'RPC 连接失败，请检查端口与引擎状态');
      }
    } catch (error) {
      const message = normalizeErrorMessage(error);
      setRpcProbeState({
        status: 'offline',
        message,
        version: '不可用',
      });
      pushNotice('warning', `RPC 测试失败：${message}`);
    } finally {
      setRpcProbing(false);
    }
  };

  const handleApplyListenPortPreset = (preset: 'default' | 'compat' | 'high') => {
    const applyListenPorts = (nextBtRaw: number, nextDhtRaw: number) => {
      const normalizedBt = clamp(nextBtRaw, 1, listenPortSyncMode === 'adjacent' ? 65534 : 65535);
      const normalizedDht = listenPortSyncMode === 'same'
        ? normalizedBt
        : listenPortSyncMode === 'adjacent'
          ? normalizedBt + 1
          : clamp(nextDhtRaw, 1, 65535);
      updateSetting('btPort', normalizedBt);
      updateSetting('dhtPort', normalizedDht);
      setListenPortProbeState(null);
      return { normalizedBt, normalizedDht };
    };
    const recordListenPortHistory = (nextBt: number, nextDht: number) => {
      const entries = [`${nextBt}:${nextDht}`, ...listenPortHistoryItems.map((item) => `${item.btPort}:${item.dhtPort}`)];
      const deduped = Array.from(new Set(entries)).slice(0, 8);
      updateSetting('listenPortHistory', deduped.join('\n'));
    };
    if (preset === 'default') {
      updateSetting('upnp', advancedSettingsDefaults.upnp);
      const { normalizedBt, normalizedDht } = applyListenPorts(advancedSettingsDefaults.btPort, advancedSettingsDefaults.dhtPort);
      recordListenPortHistory(normalizedBt, normalizedDht);
      pushNotice('info', '已应用默认监听端口预设');
      return;
    }
    if (preset === 'compat') {
      updateSetting('upnp', true);
      const { normalizedBt, normalizedDht } = applyListenPorts(6881, 6889);
      recordListenPortHistory(normalizedBt, normalizedDht);
      pushNotice('info', '已应用兼容预设');
      return;
    }
    updateSetting('upnp', true);
    const nextBt = randomPortInRange(20000, listenPortSyncMode === 'adjacent' ? 49999 : 50000);
    const nextDht = listenPortSyncMode === 'independent' ? randomPortInRange(20000, 50000) : nextBt + 1;
    const { normalizedBt, normalizedDht } = applyListenPorts(nextBt, nextDht);
    recordListenPortHistory(normalizedBt, normalizedDht);
    pushNotice('info', '已应用高位端口预设');
  };

  const handleRandomizeListenPorts = () => {
    const applyListenPorts = (nextBtRaw: number, nextDhtRaw: number) => {
      const normalizedBt = clamp(nextBtRaw, 1, listenPortSyncMode === 'adjacent' ? 65534 : 65535);
      const normalizedDht = listenPortSyncMode === 'same'
        ? normalizedBt
        : listenPortSyncMode === 'adjacent'
          ? normalizedBt + 1
          : clamp(nextDhtRaw, 1, 65535);
      updateSetting('btPort', normalizedBt);
      updateSetting('dhtPort', normalizedDht);
      setListenPortProbeState(null);
      return { normalizedBt, normalizedDht };
    };
    const recordListenPortHistory = (nextBt: number, nextDht: number) => {
      const entries = [`${nextBt}:${nextDht}`, ...listenPortHistoryItems.map((item) => `${item.btPort}:${item.dhtPort}`)];
      const deduped = Array.from(new Set(entries)).slice(0, 8);
      updateSetting('listenPortHistory', deduped.join('\n'));
    };
    const nextBt = randomPortInRange(20000, listenPortSyncMode === 'adjacent' ? 49999 : 50000);
    let nextDht = listenPortSyncMode === 'independent' ? randomPortInRange(20000, 50000) : nextBt + 1;
    if (listenPortSyncMode === 'independent' && nextDht === nextBt) {
      nextDht = clamp(nextBt + 1, 1, 65535);
    }
    const { normalizedBt, normalizedDht } = applyListenPorts(nextBt, nextDht);
    recordListenPortHistory(normalizedBt, normalizedDht);
    pushNotice('info', `已随机生成端口：BT ${normalizedBt} / DHT ${normalizedDht}`);
  };

  const handleAvoidListenPortConflict = () => {
    if (listenPortSyncMode !== 'independent') {
      pushNotice('info', '当前端口联动模式下无需手动避让');
      return;
    }
    if (btPort !== dhtPort) {
      pushNotice('info', '当前 BT 与 DHT 端口未冲突');
      return;
    }
    const nextDht = dhtPort >= 65535 ? 65534 : dhtPort + 1;
    updateSetting('dhtPort', nextDht);
    pushNotice('info', `已自动避让冲突：DHT 调整为 ${nextDht}`);
  };

  const handleSetBtPort = (nextBtRaw: number) => {
    const normalizedBt = clamp(nextBtRaw, 1, listenPortSyncMode === 'adjacent' ? 65534 : 65535);
    updateSetting('btPort', normalizedBt);
    if (listenPortSyncMode === 'same') {
      updateSetting('dhtPort', normalizedBt);
    }
    if (listenPortSyncMode === 'adjacent') {
      updateSetting('dhtPort', normalizedBt + 1);
    }
    setListenPortProbeState(null);
  };

  const handleSetDhtPort = (nextDhtRaw: number) => {
    if (listenPortSyncMode !== 'independent') return;
    updateSetting('dhtPort', clamp(nextDhtRaw, 1, 65535));
    setListenPortProbeState(null);
  };

  const handleApplyListenPortHistory = (nextBt: number, nextDht: number) => {
    const normalizedBt = clamp(nextBt, 1, listenPortSyncMode === 'adjacent' ? 65534 : 65535);
    const normalizedDht = listenPortSyncMode === 'same'
      ? normalizedBt
      : listenPortSyncMode === 'adjacent'
        ? normalizedBt + 1
        : clamp(nextDht, 1, 65535);
    updateSetting('btPort', normalizedBt);
    updateSetting('dhtPort', normalizedDht);
    setListenPortProbeState(null);
    pushNotice('info', `已应用端口组合：BT ${normalizedBt} / DHT ${normalizedDht}`);
  };

  const handleProbeListenPorts = async () => {
    if (listenPortProbing) return;
    setListenPortProbing(true);
    try {
      const result = await appProbeListenPorts(btPort, dhtPort);
      const nextState: ListenPortProbeState = {
        btAvailable: result.bt.available,
        dhtAvailable: result.dht.available,
        btTcpAvailable: result.bt.tcpAvailable,
        btUdpAvailable: result.bt.udpAvailable,
        dhtTcpAvailable: result.dht.tcpAvailable,
        dhtUdpAvailable: result.dht.udpAvailable,
        checkedAt: Date.now(),
      };
      setListenPortProbeState(nextState);
      if (nextState.btAvailable && nextState.dhtAvailable) {
        const entries = [`${btPort}:${dhtPort}`, ...listenPortHistoryItems.map((item) => `${item.btPort}:${item.dhtPort}`)];
        const deduped = Array.from(new Set(entries)).slice(0, 8);
        updateSetting('listenPortHistory', deduped.join('\n'));
        pushNotice('success', '端口检测通过，可用于监听');
      } else {
        pushNotice('warning', '存在占用风险，请调整后重试');
      }
    } catch (error) {
      const message = normalizeErrorMessage(error);
      writeDeveloperLog({
        source: 'advanced-settings',
        action: 'probe_listen_ports',
        level: 'warn',
        message,
      });
      pushNotice('warning', `端口检测失败：${message}`);
    } finally {
      setListenPortProbing(false);
    }
  };

  const handleSetListenPortSyncMode = (mode: 'independent' | 'same' | 'adjacent') => {
    updateSetting('listenPortSyncMode', mode);
    const normalizedBt = clamp(btPort, 1, mode === 'adjacent' ? 65534 : 65535);
    const normalizedDht = mode === 'same' ? normalizedBt : mode === 'adjacent' ? normalizedBt + 1 : dhtPort;
    updateSetting('btPort', normalizedBt);
    updateSetting('dhtPort', clamp(normalizedDht, 1, 65535));
    setListenPortProbeState(null);
  };

  const handleApplyUserAgentPreset = (preset: keyof typeof USER_AGENT_PRESETS) => {
    updateSetting('userAgent', USER_AGENT_PRESETS[preset]);
    pushNotice('info', `已应用 ${preset === 'aria2' ? 'Aria2' : preset === 'transmission' ? 'Transmission' : preset === 'chrome' ? 'Chrome' : preset === 'firefox' ? 'Firefox' : 'curl'} User-Agent 预设`);
  };

  const handleNormalizeUserAgent = () => {
    const normalized = normalizeUserAgent(userAgent);
    updateSetting('userAgent', normalized);
    if (!normalized) {
      pushNotice('info', 'User-Agent 已清空，将回退到 aria2 默认值');
      return;
    }
    pushNotice('success', '已将 User-Agent 规范为单行');
  };

  const handleSelectAria2Executable = async () => {
    try {
      const selected = await open({
        directory: false,
        multiple: false,
        defaultPath: aria2ExecutablePath || undefined,
        filters: [{ name: 'aria2 可执行文件', extensions: ['exe'] }],
      });
      if (selected && typeof selected === 'string') {
        updateSetting('aria2ExecutablePath', selected);
      }
    } catch (error) {
      writeDeveloperLog({
        source: 'advanced-settings',
        action: 'select_aria2_executable',
        level: 'error',
        message: String(error),
      });
      pushNotice('warning', '无法打开可执行文件选择器');
    }
  };

  const proxyPolicyText = useProxy
    ? `当前策略：${proxyProtocol.toUpperCase()}://${proxyHost || '未填写主机'}:${proxyPort}${proxyUsername ? `，用户名 ${proxyUsername}` : '，匿名访问'}`
    : '当前策略：直连，不经过代理';
  const trackerStats = useMemo(() => {
    const lines = trackerList
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    const unique = new Set(lines);
    return {
      total: lines.length,
      unique: unique.size,
      duplicate: Math.max(0, lines.length - unique.size),
    };
  }, [trackerList]);
  const trackerPolicyText = `当前策略：来源 ${trackerSource || '自定义'}，${autoUpdateTracker ? '每日自动更新' : '手动维护'}，${trackerStats.unique} 条唯一 Tracker`;
  const rpcSecretStrength = rpcSecret.length >= 20 ? '强' : rpcSecret.length >= 12 ? '中' : rpcSecret.length > 0 ? '弱' : '未设置';
  const rpcPolicyText = `当前策略：127.0.0.1:${rpcPort}，密钥${rpcSecret ? `已设置（${rpcSecretStrength}）` : '未设置'}`;
  const aria2EnginePolicyText = `当前策略：${aria2ExecutablePath.trim() ? '使用指定 aria2c 路径' : '自动发现 aria2c'}，RPC 127.0.0.1:${rpcPort}`;
  const listenPortPolicyText = `当前策略：${upnp ? '自动映射开启' : '手动端口映射'}，BT ${btPort}，DHT ${dhtPort}`;
  const listenPortSyncModeLabel = listenPortSyncMode === 'same' ? '同端口' : listenPortSyncMode === 'adjacent' ? '相邻端口' : '独立配置';
  const listenPortProbeText = listenPortProbeState
    ? `最近检测：BT ${listenPortProbeState.btAvailable ? '可用' : '占用'}(TCP ${listenPortProbeState.btTcpAvailable ? '通' : '占'} / UDP ${listenPortProbeState.btUdpAvailable ? '通' : '占'})，DHT ${listenPortProbeState.dhtAvailable ? '可用' : '占用'}(TCP ${listenPortProbeState.dhtTcpAvailable ? '通' : '占'} / UDP ${listenPortProbeState.dhtUdpAvailable ? '通' : '占'})`
    : '尚未检测端口占用';
  const hasListenPortConflict = btPort === dhtPort;
  const hasPrivilegedPort = btPort < 1024 || dhtPort < 1024;
  const normalizedUserAgent = normalizeUserAgent(userAgent);
  const userAgentLineCount = userAgent
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean).length;
  const userAgentHasLineBreak = /[\r\n]/.test(userAgent);
  const userAgentTooLong = normalizedUserAgent.length > USER_AGENT_MAX_LENGTH;
  const parsedUserAgentRules = parseUserAgentRules(userAgentRules);
  const userAgentPolicyText = normalizedUserAgent
    ? `当前策略：使用自定义 User-Agent（${normalizedUserAgent.length} 字符）`
    : '当前策略：使用 aria2 默认 User-Agent';

  return (
    <div className="flex flex-col h-full bg-main relative">
      {/* Header */}
      <div className="px-8 py-6 border-b border-black/5 shrink-0">
        <h1 className="text-xl font-medium text-text-main">进阶设置</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar pb-32">
        <div className="max-w-3xl">
          <Section title="代理">
            <Row label="启用代理">
              <Toggle checked={useProxy} onChange={(v) => updateSetting('useProxy', v)} />
            </Row>
            <Row label="当前策略">
              <span className="text-[12px] text-text-muted">{proxyPolicyText}</span>
            </Row>
            <Row label="快捷预设">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleApplyProxyPreset('off')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  直连
                </button>
                <button
                  onClick={() => handleApplyProxyPreset('http')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  HTTP
                </button>
                <button
                  onClick={() => handleApplyProxyPreset('socks5')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  SOCKS5
                </button>
              </div>
            </Row>
            <Row label="代理协议">
              <Select
                value={proxyProtocol}
                onChange={(v) => updateSetting('proxyProtocol', v as 'http' | 'https' | 'socks5')}
                options={[
                  { label: 'HTTP', value: 'http' },
                  { label: 'HTTPS', value: 'https' },
                  { label: 'SOCKS5', value: 'socks5' },
                ]}
                className="w-36"
              />
            </Row>
            <Row label="代理地址">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={proxyHost}
                  onChange={(e) => updateSetting('proxyHost', e.target.value.trim())}
                  placeholder="127.0.0.1"
                  className="w-48 px-3 h-[32px] border border-black/10 rounded-md bg-white text-[13px] text-text-main focus:outline-none focus:border-[#e5a038]"
                />
                <div className="flex items-center border border-black/10 rounded-md overflow-hidden bg-white h-[32px] w-36">
                  <input
                    type="number"
                    value={proxyPort}
                    onChange={(e) => updateSetting('proxyPort', normalizeProxyPort(toNumber(e.target.value, proxyPort), proxyPort))}
                    className="flex-1 px-3 h-full text-[13px] focus:outline-none min-w-0 bg-transparent"
                  />
                  <div className="flex items-center px-1 h-full border-l border-black/10">
                    <button
                      onClick={() => updateSetting('proxyPort', normalizeProxyPort(proxyPort - 1, proxyPort))}
                      className="p-1 hover:bg-black/5 text-text-muted cursor-pointer"
                    >
                      <Minus size={14} />
                    </button>
                    <button
                      onClick={() => updateSetting('proxyPort', normalizeProxyPort(proxyPort + 1, proxyPort))}
                      className="p-1 hover:bg-black/5 text-text-muted cursor-pointer"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <span className="text-[12px] text-text-muted">端口范围 1-65535</span>
              </div>
            </Row>
            <Row label="代理认证">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={proxyUsername}
                  onChange={(e) => updateSetting('proxyUsername', e.target.value)}
                  placeholder="用户名（可选）"
                  className="w-36 px-3 h-[32px] border border-black/10 rounded-md bg-white text-[13px] text-text-main focus:outline-none focus:border-[#e5a038]"
                />
                <div className="flex items-center border border-black/10 rounded-md overflow-hidden bg-white h-[32px] w-48">
                  <input
                    type={showProxyPassword ? 'text' : 'password'}
                    value={proxyPassword}
                    onChange={(e) => updateSetting('proxyPassword', e.target.value)}
                    placeholder="密码（可选）"
                    className="flex-1 px-3 h-full text-[13px] focus:outline-none min-w-0 bg-transparent"
                  />
                  <button
                    onClick={() => setShowProxyPassword(!showProxyPassword)}
                    className="w-8 h-full flex items-center justify-center hover:bg-black/5 text-text-muted border-l border-black/10 cursor-pointer transition-colors"
                  >
                    {showProxyPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </Row>
            <Row label="绕过列表" align="start">
              <textarea
                className="w-[28rem] h-20 px-3 py-2 border border-black/10 rounded-md bg-white text-[13px] text-text-main focus:outline-none focus:border-[#e5a038] resize-none leading-relaxed custom-scrollbar"
                value={proxyBypass}
                onChange={(e) => updateSetting('proxyBypass', e.target.value)}
                placeholder="多个目标用英文逗号分隔，例如 localhost,127.0.0.1,::1"
                spellCheck={false}
              />
            </Row>
            <Row>
              <span className="text-[12px] text-text-muted">格式示例：{proxyProtocol}://{proxyUsername ? `${proxyUsername}:***@` : ''}{proxyHost || 'host'}:{proxyPort}</span>
            </Row>
          </Section>

          <Section title="Tracker 服务器">
            <Row label="当前策略">
              <span className="text-[12px] text-text-muted">{trackerPolicyText}</span>
            </Row>
            <Row label="快捷预设">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleApplyTrackerPreset('best')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  高可用
                </button>
                <button
                  onClick={() => handleApplyTrackerPreset('balanced')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  均衡
                </button>
                <button
                  onClick={() => handleApplyTrackerPreset('minimal')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  精简
                </button>
              </div>
            </Row>
            <Row label="Tracker 来源">
              <div className="flex items-center gap-2">
                <Select
                  value={trackerSource || 'custom'}
                  onChange={(value) => {
                    const next = value as
                      | 'trackers_best.txt'
                      | 'trackers_balanced.txt'
                      | 'trackers_minimal.txt'
                      | 'best_aria2.txt'
                      | 'all_aria2.txt'
                      | 'http_aria2.txt'
                      | 'nohttp_aria2.txt'
                      | 'custom';
                    if (next === 'custom') {
                      updateSetting('trackerSource', 'custom');
                      return;
                    }
                    if (next === 'trackers_best.txt' || next === 'trackers_balanced.txt' || next === 'trackers_minimal.txt') {
                      const preset = next === 'trackers_best.txt'
                        ? TRACKER_PRESETS.best
                        : next === 'trackers_balanced.txt'
                          ? TRACKER_PRESETS.balanced
                          : TRACKER_PRESETS.minimal;
                      updateSetting('trackerSource', preset.source);
                      updateSetting('trackerList', preset.list);
                      return;
                    }
                    updateSetting('trackerSource', next);
                  }}
                  options={[...TRACKER_SOURCE_OPTIONS]}
                  className="w-48"
                />
                <button
                  onClick={() => void loadTrackerSyncPreview()}
                  className="flex items-center gap-1 px-3 h-[32px] border border-[#e5a038] text-[#e5a038] rounded-md hover:bg-[#e5a038]/5 text-[13px] cursor-pointer transition-colors"
                >
                  <RefreshCw size={14} />
                  预览同步
                </button>
                <button
                  onClick={handleDeduplicateTrackers}
                  className="px-3 h-[32px] border border-black/10 rounded-md bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer"
                >
                  去重
                </button>
                <button
                  onClick={handleClearTrackers}
                  className="px-3 h-[32px] border border-red-300 text-red-500 rounded-md bg-white hover:bg-red-50 text-[13px] transition-colors cursor-pointer"
                >
                  清空
                </button>
              </div>
            </Row>
            <Row label="本地目录">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={trackerPrimaryLocalDir}
                  onChange={(e) => {
                    const nextValue = e.target.value.trim();
                    const nextDirs = nextValue
                      ? [nextValue, ...trackerLocalDirList.filter((item) => item !== trackerPrimaryLocalDir && item !== nextValue)]
                      : trackerLocalDirList.filter((item) => item !== trackerPrimaryLocalDir);
                    updateSetting('trackerLocalDirs', nextDirs.join('\n'));
                  }}
                  placeholder="例如：D:\Download\trackerslist-master（留空将自动使用安装目录）"
                  className="w-[28rem] px-3 h-[32px] border border-black/10 rounded-md bg-white text-[13px] text-text-main focus:outline-none focus:border-[#e5a038]"
                />
                <button
                  onClick={() => void handlePickTrackerLocalDir()}
                  className="w-8 h-[32px] flex items-center justify-center border border-black/10 rounded-md bg-white hover:bg-black/5 text-text-muted cursor-pointer transition-colors"
                >
                  <FolderOpen size={16} />
                </button>
              </div>
            </Row>
            <Row label="目录列表" align="start">
              <textarea
                className="w-[28rem] h-20 px-3 py-2 border border-black/10 rounded-md bg-white text-[13px] text-text-main focus:outline-none focus:border-[#e5a038] resize-none leading-relaxed custom-scrollbar"
                value={trackerLocalDirs}
                onChange={(e) => updateSetting('trackerLocalDirs', e.target.value)}
                spellCheck={false}
              />
            </Row>
            {syncFailures.length > 0 ? (
              <Row label="失败明细" align="start">
                <div className="w-[28rem] px-3 py-2 rounded-md border border-amber-200 bg-amber-50 text-[12px] text-amber-800 leading-relaxed">
                  {syncFailures.join('\n')}
                </div>
              </Row>
            ) : null}
            <Row label="Tracker 列表" align="start">
              <textarea
                className="w-[28rem] h-48 px-3 py-2 border border-black/10 rounded-md bg-white text-[13px] text-text-main focus:outline-none focus:border-[#e5a038] resize-none leading-relaxed custom-scrollbar"
                value={trackerList}
                onChange={(e) => updateSetting('trackerList', e.target.value)}
                spellCheck={false}
              />
            </Row>
            
            <Row>
              <div className="text-[13px] text-text-main flex items-center gap-2">
                推荐使用:
                <button
                  onClick={() => void openUrl('https://github.com/ngosang/trackerslist')}
                  className="text-[#e5a038] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  ngosang/trackerslist
                  <ExternalLink size={12} />
                </button>
                <button
                  onClick={() => void openUrl('https://github.com/XIU2/TrackersListCollection')}
                  className="text-[#e5a038] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  XIU2/TrackersListCollection
                  <ExternalLink size={12} />
                </button>
              </div>
            </Row>
            <Row>
              <div className="text-[12px] text-text-muted">
                当前共 {trackerStats.total} 条，唯一 {trackerStats.unique} 条，重复 {trackerStats.duplicate} 条
              </div>
            </Row>
            <Row>
              <div className="text-[12px] text-text-muted">
                预览同步会优先读取本地目录，找不到时自动回退到 GitHub/CDN 在线列表。
              </div>
            </Row>
            
            <Row label="每天自动更新 Tracker 列表">
              <Toggle checked={autoUpdateTracker} onChange={(v) => updateSetting('autoUpdateTracker', v)} />
            </Row>
            
            <Row>
              <div className="text-[13px] text-text-muted">
                {trackerSyncAt ? new Date(trackerSyncAt).toLocaleString('zh-CN', { hour12: false }) : '尚未同步'}
              </div>
            </Row>
          </Section>

          <Section title="RPC">
            <Row label="当前策略">
              <span className="text-[12px] text-text-muted">{rpcPolicyText}</span>
            </Row>
            <Row label="快捷预设">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleApplyRpcPreset('default')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  默认
                </button>
                <button
                  onClick={() => handleApplyRpcPreset('secure')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  安全
                </button>
                <button
                  onClick={() => handleApplyRpcPreset('lan')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  局域网
                </button>
              </div>
            </Row>
            <Row label="RPC 监听端口">
              <div className="flex items-center gap-2">
                <div className="flex items-center border border-black/10 rounded-md overflow-hidden bg-white h-[32px] w-36">
                  <input
                    type="number"
                    value={rpcPort}
                    onChange={(e) => updateSetting('rpcPort', clamp(toNumber(e.target.value, rpcPort), 1, 65535))}
                    className="flex-1 px-3 h-full text-[13px] focus:outline-none min-w-0 bg-transparent"
                  />
                  <div className="flex items-center px-1 h-full border-l border-black/10">
                    <button
                      onClick={() => updateSetting('rpcPort', clamp(rpcPort - 1, 1, 65535))}
                      className="p-1 hover:bg-black/5 text-text-muted cursor-pointer"
                    >
                      <Minus size={14} />
                    </button>
                    <button
                      onClick={() => updateSetting('rpcPort', clamp(rpcPort + 1, 1, 65535))}
                      className="p-1 hover:bg-black/5 text-text-muted cursor-pointer"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => updateSetting('rpcPort', randomPort())}
                  className="w-8 h-[32px] flex items-center justify-center border border-black/10 rounded-md bg-white hover:bg-black/5 text-text-muted cursor-pointer transition-colors"
                >
                  <Box size={16} />
                </button>
                <button
                  onClick={() => updateSetting('rpcPort', advancedSettingsDefaults.rpcPort)}
                  className="px-3 h-[32px] border border-red-300 text-red-500 rounded-md bg-white hover:bg-red-50 text-[13px] transition-colors cursor-pointer"
                >
                  默认端口
                </button>
              </div>
            </Row>
            
            <Row label="RPC 密钥">
              <div className="flex items-center gap-2">
                <div className="flex items-center border border-black/10 rounded-md overflow-hidden bg-white h-[32px] w-64">
                  <input
                    type={showSecret ? "text" : "password"}
                    value={rpcSecret}
                    onChange={(e) => updateSetting('rpcSecret', e.target.value)}
                    className="flex-1 px-3 h-full text-[13px] focus:outline-none min-w-0 bg-transparent"
                  />
                  <button
                    onClick={() => setShowSecret(!showSecret)}
                    className="w-8 h-full flex items-center justify-center hover:bg-black/5 text-text-muted border-l border-black/10 cursor-pointer transition-colors"
                  >
                    {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <button
                  onClick={() => updateSetting('rpcSecret', randomSecret(24))}
                  className="px-3 h-[32px] border border-black/10 rounded-md bg-white hover:bg-black/5 text-[13px] text-text-main cursor-pointer transition-colors"
                >
                  生成
                </button>
                <button
                  onClick={() => updateSetting('rpcSecret', '')}
                  className="px-3 h-[32px] border border-red-300 text-red-500 rounded-md bg-white hover:bg-red-50 text-[13px] transition-colors cursor-pointer"
                >
                  清空
                </button>
              </div>
            </Row>
            <Row>
              <div className="text-[12px] text-text-muted">
                密钥强度：{rpcSecretStrength}（建议至少 16 位，包含大小写与数字）
              </div>
            </Row>
            <Row label="RPC 测试">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleProbeRpcConfig()}
                  disabled={rpcProbing}
                  className="flex items-center gap-1 px-3 h-[32px] border border-[#e5a038] text-[#e5a038] rounded-md hover:bg-[#e5a038]/5 text-[13px] cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={14} className={rpcProbing ? 'animate-spin' : ''} />
                  {rpcProbing ? '测试中...' : '测试连接'}
                </button>
                {rpcProbeState ? (
                  <span className={`text-[12px] ${rpcProbeState.status === 'online' ? 'text-emerald-600' : rpcProbeState.status === 'auth_failed' ? 'text-amber-600' : 'text-rose-600'}`}>
                    {rpcProbeState.status === 'online' ? `在线 · ${rpcProbeState.version}` : rpcProbeState.status === 'auth_failed' ? '鉴权失败' : '离线'} · {rpcProbeState.message}
                  </span>
                ) : (
                  <span className="text-[12px] text-text-muted">修改端口或密钥后可立即测试</span>
                )}
              </div>
            </Row>
          </Section>

          <Section title="监听端口">
            <Row label="当前策略">
              <span className="text-[12px] text-text-muted">{listenPortPolicyText}，联动 {listenPortSyncModeLabel}</span>
            </Row>
            <Row label="端口联动">
              <Select
                value={listenPortSyncMode}
                onChange={(v) => handleSetListenPortSyncMode(v as 'independent' | 'same' | 'adjacent')}
                options={[
                  { label: '独立配置', value: 'independent' },
                  { label: '同端口', value: 'same' },
                  { label: '相邻端口', value: 'adjacent' },
                ]}
                className="w-40"
              />
            </Row>
            <Row label="快捷预设">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleApplyListenPortPreset('default')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  默认
                </button>
                <button
                  onClick={() => handleApplyListenPortPreset('compat')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  兼容
                </button>
                <button
                  onClick={() => handleApplyListenPortPreset('high')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  高位端口
                </button>
                <button
                  onClick={handleRandomizeListenPorts}
                  className="px-3 py-1 border border-[#e5a038]/40 text-[#e5a038] rounded-md bg-white hover:bg-[#e5a038]/5 text-[12px] transition-colors cursor-pointer"
                >
                  随机一组
                </button>
              </div>
            </Row>
            <Row label="UPnP/NAT-PMP">
              <Toggle checked={upnp} onChange={(v) => updateSetting('upnp', v)} />
            </Row>
            <Row label="端口可用性">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleProbeListenPorts}
                  disabled={listenPortProbing}
                  className="px-3 h-[28px] border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {listenPortProbing ? '检测中...' : '检测占用'}
                </button>
                <span className={`text-[12px] ${listenPortProbeState && listenPortProbeState.btAvailable && listenPortProbeState.dhtAvailable ? 'text-emerald-600' : listenPortProbeState ? 'text-rose-600' : 'text-text-muted'}`}>
                  {listenPortProbeText}
                </span>
              </div>
            </Row>
            <Row label="推荐组合">
              <div className="flex items-center gap-2 flex-wrap">
                {listenPortHistoryItems.length > 0 ? listenPortHistoryItems.map((item) => (
                  <button
                    key={`${item.btPort}-${item.dhtPort}`}
                    onClick={() => handleApplyListenPortHistory(item.btPort, item.dhtPort)}
                    className="px-3 h-[28px] border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                  >
                    BT {item.btPort} / DHT {item.dhtPort}
                  </button>
                )) : (
                  <span className="text-[12px] text-text-muted">暂无历史组合</span>
                )}
                <button
                  onClick={() => updateSetting('listenPortHistory', '')}
                  className="px-3 h-[28px] border border-red-300 text-red-500 rounded-md bg-white hover:bg-red-50 text-[12px] transition-colors cursor-pointer"
                >
                  清空
                </button>
              </div>
            </Row>
            
            <Row label="BT 监听端口">
              <div className="flex items-center gap-2">
                <div className="flex items-center border border-black/10 rounded-md overflow-hidden bg-white h-[32px] w-36">
                  <input
                    type="number"
                    value={btPort}
                    onChange={(e) => handleSetBtPort(toNumber(e.target.value, btPort))}
                    className="flex-1 px-3 h-full text-[13px] focus:outline-none min-w-0 bg-transparent"
                  />
                  <div className="flex items-center px-1 h-full border-l border-black/10">
                    <button
                      onClick={() => handleSetBtPort(btPort - 1)}
                      className="p-1 hover:bg-black/5 text-text-muted cursor-pointer"
                    >
                      <Minus size={14} />
                    </button>
                    <button
                      onClick={() => handleSetBtPort(btPort + 1)}
                      className="p-1 hover:bg-black/5 text-text-muted cursor-pointer"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => handleSetBtPort(randomPort())}
                  className="w-8 h-[32px] flex items-center justify-center border border-black/10 rounded-md bg-white hover:bg-black/5 text-text-muted cursor-pointer transition-colors"
                >
                  <Box size={16} />
                </button>
                <button
                  onClick={() => handleSetBtPort(advancedSettingsDefaults.btPort)}
                  className="px-3 h-[32px] border border-red-300 text-red-500 rounded-md bg-white hover:bg-red-50 text-[13px] transition-colors cursor-pointer"
                >
                  默认
                </button>
              </div>
            </Row>
            
            <Row label="DHT 监听端口">
              <div className="flex items-center gap-2">
                <div className="flex items-center border border-black/10 rounded-md overflow-hidden bg-white h-[32px] w-36">
                  <input
                    type="number"
                    value={dhtPort}
                    onChange={(e) => handleSetDhtPort(toNumber(e.target.value, dhtPort))}
                    disabled={listenPortSyncMode !== 'independent'}
                    className="flex-1 px-3 h-full text-[13px] focus:outline-none min-w-0 bg-transparent disabled:bg-black/5 disabled:text-text-muted"
                  />
                  <div className="flex items-center px-1 h-full border-l border-black/10">
                    <button
                      onClick={() => handleSetDhtPort(dhtPort - 1)}
                      disabled={listenPortSyncMode !== 'independent'}
                      className="p-1 hover:bg-black/5 text-text-muted cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Minus size={14} />
                    </button>
                    <button
                      onClick={() => handleSetDhtPort(dhtPort + 1)}
                      disabled={listenPortSyncMode !== 'independent'}
                      className="p-1 hover:bg-black/5 text-text-muted cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => handleSetDhtPort(randomPort())}
                  disabled={listenPortSyncMode !== 'independent'}
                  className="w-8 h-[32px] flex items-center justify-center border border-black/10 rounded-md bg-white hover:bg-black/5 text-text-muted cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Box size={16} />
                </button>
                <button
                  onClick={() => handleSetDhtPort(advancedSettingsDefaults.dhtPort)}
                  disabled={listenPortSyncMode !== 'independent'}
                  className="px-3 h-[32px] border border-red-300 text-red-500 rounded-md bg-white hover:bg-red-50 text-[13px] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                >
                  默认
                </button>
              </div>
            </Row>
            {hasListenPortConflict ? (
              <Row label="端口冲突">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] text-rose-600">BT 与 DHT 使用同一端口，可能降低可连接性</span>
                  <button
                    onClick={handleAvoidListenPortConflict}
                    className="px-3 h-[28px] border border-rose-300 text-rose-600 rounded-md bg-white hover:bg-rose-50 text-[12px] transition-colors cursor-pointer"
                  >
                    自动避让
                  </button>
                </div>
              </Row>
            ) : null}
            {hasPrivilegedPort ? (
              <Row>
                <span className="text-[12px] text-amber-700">检测到系统保留端口（1-1023），建议改用 1024 以上端口</span>
              </Row>
            ) : null}
          </Section>

          <Section title="User-Agent">
            <Row label="当前策略">
              <span className="text-[12px] text-text-muted">{userAgentPolicyText}</span>
            </Row>
            <Row label="快捷预设">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => handleApplyUserAgentPreset('aria2')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  Aria2
                </button>
                <button
                  onClick={() => handleApplyUserAgentPreset('transmission')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  Transmission
                </button>
                <button
                  onClick={() => handleApplyUserAgentPreset('chrome')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  Chrome
                </button>
                <button
                  onClick={() => handleApplyUserAgentPreset('firefox')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  Firefox
                </button>
                <button
                  onClick={() => handleApplyUserAgentPreset('curl')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  curl
                </button>
              </div>
            </Row>
            <Row label="模拟 User-Agent" align="start">
              <textarea
                className="w-[28rem] h-24 px-3 py-2 border border-black/10 rounded-md bg-white text-[13px] text-text-main focus:outline-none focus:border-[#e5a038] resize-none leading-relaxed custom-scrollbar"
                value={userAgent}
                onChange={(e) => updateSetting('userAgent', e.target.value)}
                spellCheck={false}
              />
            </Row>
            <Row label="域名规则" align="start">
              <textarea
                className="w-[28rem] h-20 px-3 py-2 border border-black/10 rounded-md bg-white text-[13px] text-text-main focus:outline-none focus:border-[#e5a038] resize-none leading-relaxed custom-scrollbar"
                value={userAgentRules}
                onChange={(e) => updateSetting('userAgentRules', e.target.value)}
                placeholder="示例：*.example.com => Mozilla/5.0 ..."
                spellCheck={false}
              />
            </Row>
            <Row label="状态">
              <span className={`text-[12px] ${userAgentHasLineBreak || userAgentTooLong ? 'text-amber-700' : 'text-text-muted'}`}>
                共 {userAgent.length} 字符，非空行 {userAgentLineCount} 行
                {userAgentHasLineBreak ? '，含换行符，建议规范为单行' : ''}
                {userAgentTooLong ? `，长度建议不超过 ${USER_AGENT_MAX_LENGTH}` : ''}
                {parsedUserAgentRules.length > 0 ? `，已配置 ${parsedUserAgentRules.length} 条域名规则` : ''}
              </span>
            </Row>
            <Row>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleNormalizeUserAgent}
                  className="px-4 h-[32px] border border-[#e5a038]/40 text-[#e5a038] rounded-md text-[13px] bg-white hover:bg-[#e5a038]/5 cursor-pointer transition-colors"
                >
                  规范为单行
                </button>
                <button
                  onClick={() => updateSetting('userAgent', '')}
                  className="px-4 h-[32px] border border-red-300 text-red-500 rounded-md text-[13px] bg-white hover:bg-red-50 cursor-pointer transition-colors"
                >
                  清空
                </button>
                <button
                  onClick={() => updateSetting('userAgent', advancedSettingsDefaults.userAgent)}
                  className="px-4 h-[32px] border border-red-300 text-red-500 rounded-md text-[13px] bg-white hover:bg-red-50 cursor-pointer transition-colors"
                >
                  恢复默认
                </button>
              </div>
            </Row>
          </Section>

          <Section title="aria2 下载引擎">
            <Row label="当前策略">
              <span className="text-[12px] text-text-muted">{aria2EnginePolicyText}</span>
            </Row>
            <Row label="引擎状态">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => void handleProbeAria2Engine(true)}
                  disabled={engineProbing}
                  className="flex items-center gap-1 px-3 h-[32px] border border-[#e5a038] text-[#e5a038] rounded-md hover:bg-[#e5a038]/5 text-[13px] cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={14} className={engineProbing ? 'animate-spin' : ''} />
                  {engineProbing ? '检测中...' : '检测引擎'}
                </button>
                {engineProbeState ? (
                  <span className={`text-[12px] ${engineProbeState.status === 'online' ? 'text-emerald-600' : engineProbeState.status === 'auth_failed' ? 'text-amber-600' : 'text-rose-600'}`}>
                    {engineProbeState.status === 'online' ? `在线 · ${engineProbeState.version}` : engineProbeState.status === 'auth_failed' ? '鉴权失败' : '离线'} · {engineProbeState.message}
                  </span>
                ) : (
                  <span className="text-[12px] text-text-muted">可检测当前端口和可执行文件是否可用</span>
                )}
              </div>
            </Row>
            {engineProbeState?.enabledFeatures?.length ? (
              <Row label="引擎特性">
                <div className="flex items-center gap-2 flex-wrap">
                  {engineProbeState.enabledFeatures.map((feature) => (
                    <span key={feature} className="px-2 py-0.5 text-[12px] rounded-full border border-black/10 bg-white text-text-main">
                      {feature}
                    </span>
                  ))}
                </div>
              </Row>
            ) : null}
            <Row label="aria2c 可执行文件">
              <div className="flex items-center h-[32px] w-[28rem]">
                <input
                  type="text"
                  value={aria2ExecutablePath}
                  onChange={(e) => updateSetting('aria2ExecutablePath', e.target.value)}
                  placeholder="留空则自动从系统路径和常见目录查找 aria2c"
                  className="flex-1 px-3 h-full border border-black/10 border-r-0 rounded-l-md bg-white focus:outline-none text-[13px] text-text-main"
                />
                <button onClick={handleSelectAria2Executable} className="w-10 h-full flex items-center justify-center border border-black/10 rounded-r-md bg-white hover:bg-black/5 text-text-muted transition-colors cursor-pointer">
                  <FolderOpen size={16} />
                </button>
              </div>
            </Row>
            <Row label="任务缓存文件">
              <div className="flex items-center h-[32px] w-[28rem]">
                <input
                  type="text"
                  value={taskCachePath}
                  readOnly
                  className="flex-1 px-3 h-full border border-black/10 border-r-0 rounded-l-md bg-white focus:outline-none text-[13px] text-text-main"
                />
                <button
                  onClick={() => void handleOpenPath(taskCachePath, '安装目录未就绪')}
                  className="w-10 h-full flex items-center justify-center border border-black/10 rounded-r-md bg-white hover:bg-black/5 text-text-muted transition-colors cursor-pointer"
                >
                  <FolderOpen size={16} />
                </button>
              </div>
            </Row>
            <Row>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleRestartEngine()}
                  disabled={restarting}
                  className="flex items-center gap-1.5 px-4 py-1.5 border border-[#e5a038] text-[#e5a038] rounded-md text-[13px] hover:bg-[#e5a038]/5 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={14} className={restarting ? 'animate-spin' : ''} />
                  {restarting ? '重启中...' : '更新并重启引擎'}
                </button>
                <button
                  onClick={() => void handleClearAllTasksWithNotice()}
                  disabled={clearingAllTasks}
                  className="px-4 py-1.5 border border-red-300 text-red-500 rounded-md text-[13px] hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {clearingAllTasks ? '清理中...' : '清除所有任务'}
                </button>
              </div>
            </Row>
          </Section>

          <Section title="应用日志">
            <Row label="日志文件">
              <div className="flex items-center h-[32px] w-[28rem]">
                <input
                  type="text"
                  value={appLogPath}
                  readOnly
                  className="flex-1 px-3 h-full border border-black/10 border-r-0 rounded-l-md bg-white focus:outline-none text-[13px] text-text-main"
                />
                <button
                  onClick={() => void handleOpenPath(appLogPath, '日志路径未就绪')}
                  className="w-10 h-full flex items-center justify-center border border-black/10 rounded-r-md bg-white hover:bg-black/5 text-text-muted transition-colors cursor-pointer"
                >
                  <FolderOpen size={16} />
                </button>
              </div>
            </Row>
            <Row label="日志预览">
              <div className="w-[40rem]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] text-text-muted">
                    {appLogUpdatedAt ? `最近刷新：${new Date(appLogUpdatedAt).toLocaleString('zh-CN', { hour12: false })} · 匹配 ${appLogFilteredLines.length} / 预览 ${appLogLineCount} 行` : '尚未加载日志内容'}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void handleRefreshAppLog()}
                      disabled={appLogReading}
                      className="flex items-center gap-1.5 px-3 h-[28px] border border-black/10 rounded-md text-[12px] bg-white hover:bg-black/5 text-text-main transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <RefreshCw size={12} className={appLogReading ? 'animate-spin' : ''} />
                      {appLogReading ? '刷新中...' : '刷新日志'}
                    </button>
                    <button
                      onClick={() => void handleDownloadAppLog()}
                      className="flex items-center gap-1.5 px-3 h-[28px] border border-[#e5a038] rounded-md text-[12px] bg-white hover:bg-[#e5a038]/5 text-[#e5a038] transition-colors cursor-pointer"
                    >
                      <Download size={12} />
                      导出 app.log
                    </button>
                    <button
                      onClick={() => void handleClearAppLog()}
                      disabled={appLogClearing}
                      className="flex items-center gap-1.5 px-3 h-[28px] border border-red-300 rounded-md text-[12px] bg-white hover:bg-red-50 text-red-500 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <Trash2 size={12} />
                      {appLogClearing ? '清空中...' : '清空 app.log'}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <Select
                    value={String(appLogRecentMinutes)}
                    onChange={(value) => setAppLogRecentMinutes(clamp(toNumber(value, 0), 0, 360))}
                    options={APP_LOG_RECENT_MINUTES_OPTIONS}
                    className="w-full"
                  />
                  <Select
                    value={appLogLevelFilter}
                    onChange={(value) => setAppLogLevelFilter(value as AppLogLevelFilter)}
                    options={[
                      { label: '全部级别', value: 'all' },
                      { label: 'error', value: 'error' },
                      { label: 'warn', value: 'warn' },
                      { label: 'info', value: 'info' },
                      { label: 'debug', value: 'debug' },
                    ]}
                    className="w-full"
                  />
                  <div className="flex items-center h-[32px] px-2 border border-black/10 rounded-md bg-white">
                    <input
                      value={appLogKeyword}
                      onChange={(event) => setAppLogKeyword(event.target.value)}
                      placeholder="关键字筛选"
                      className="w-full text-[12px] text-text-main bg-transparent focus:outline-none"
                    />
                  </div>
                </div>
                <div className="h-48 rounded-md border border-black/10 bg-white overflow-auto custom-scrollbar px-3 py-2 font-mono text-[12px] leading-5">
                  {appLogFilteredLines.length === 0 ? (
                    <div className="text-text-muted">暂无匹配日志</div>
                  ) : (
                    appLogFilteredLines.map((line) => (
                      <div key={line.id} className="whitespace-pre-wrap break-words text-text-main">
                        {highlightAppLogText(line.text, appLogKeyword)}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Row>
            <Row label="轮转状态">
              <div className="w-[40rem] rounded-md border border-black/10 bg-white px-3 py-2">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-text-main flex items-center gap-1.5">
                    <Gauge size={13} />
                    当前大小 {formatBytes(appLogFileSizeBytes)} / 阈值 {formatBytes(APP_LOG_ROTATION_THRESHOLD_BYTES)}
                  </span>
                  <span className={appLogRotationRatio >= 1 ? 'text-red-500' : appLogRotationRatio >= 0.8 ? 'text-[#c7892f]' : 'text-text-muted'}>
                    {appLogRotationRatio >= 1 ? '已达阈值' : appLogRotationRatio >= 0.8 ? '接近阈值' : '正常'}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-black/5 overflow-hidden">
                  <div
                    className={appLogRotationRatio >= 1 ? 'h-full bg-red-400' : appLogRotationRatio >= 0.8 ? 'h-full bg-[#e5a038]' : 'h-full bg-[#2f7ed8]'}
                    style={{ width: `${Math.max(4, Math.round(appLogRotationRatio * 100))}%` }}
                  />
                </div>
                <div className="mt-1 text-[12px] text-text-muted">
                  文件更新时间：{appLogFileModifiedAt ? new Date(appLogFileModifiedAt).toLocaleString('zh-CN', { hour12: false }) : '未知'}
                </div>
              </div>
            </Row>
            <Row label="开发者日志采集">
              <Toggle checked={enableDeveloperLogs} onChange={(v) => updateSetting('enableDeveloperLogs', v)} />
            </Row>
            <Row label="开发者日志入口">
              <Toggle checked={showDeveloperLogsEntry} onChange={(v) => updateSetting('showDeveloperLogsEntry', v)} />
            </Row>
            <Row label="开发者日志级别">
              <Select
                value={developerLogLevel}
                onChange={(v) => updateSetting('developerLogLevel', v as 'debug' | 'info' | 'warn' | 'error')}
                options={[
                  { label: 'debug', value: 'debug' },
                  { label: 'info', value: 'info' },
                  { label: 'warn', value: 'warn' },
                  { label: 'error', value: 'error' },
                ]}
                className="w-32"
              />
            </Row>
            <Row label="开发者日志保留条数">
              <div className="flex items-center border border-black/10 rounded-md bg-white overflow-hidden w-36 h-[32px]">
                <input
                  type="number"
                  min={100}
                  max={5000}
                  value={developerLogMaxEntries}
                  onChange={(e) => updateSetting('developerLogMaxEntries', clamp(toNumber(e.target.value, 800), 100, 5000))}
                  className="flex-1 px-3 h-full text-[13px] focus:outline-none"
                />
                <div className="flex items-center px-1 h-full border-l border-black/10">
                  <button
                    onClick={() => updateSetting('developerLogMaxEntries', clamp(developerLogMaxEntries + 50, 100, 5000))}
                    className="p-1 hover:bg-black/5 text-text-muted cursor-pointer"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    onClick={() => updateSetting('developerLogMaxEntries', clamp(developerLogMaxEntries - 50, 100, 5000))}
                    className="p-1 hover:bg-black/5 text-text-muted cursor-pointer"
                  >
                    <Minus size={14} />
                  </button>
                </div>
              </div>
            </Row>
            <Row label="日志级别">
              <div className="flex items-center gap-3">
                <Select 
                  value={logLevel} 
                  onChange={(v) => updateSetting('logLevel', v)} 
                  options={[{label: 'debug', value: 'debug'}, {label: 'info', value: 'info'}, {label: 'warn', value: 'warn'}, {label: 'error', value: 'error'}]} 
                  className="w-32" 
                />
                <button
                  onClick={() => void handleExportDiagnostics()}
                  className="flex items-center gap-1.5 px-4 h-[32px] border border-[#e5a038] text-[#e5a038] rounded-md text-[13px] hover:bg-[#e5a038]/5 transition-colors cursor-pointer"
                >
                  <Download size={14} /> 导出诊断日志
                </button>
                <button
                  onClick={clearLogs}
                  className="flex items-center gap-1.5 px-4 h-[32px] border border-red-300 text-red-500 rounded-md text-[13px] bg-white hover:bg-red-50 transition-colors cursor-pointer"
                >
                  <Trash2 size={14} /> 清空日志
                </button>
              </div>
            </Row>
          </Section>

          <Section title="下载历史">
            <Row label="历史概览">
              <div className="text-[12px] text-text-muted">
                共 {historyTasks.length} 条，已完成 {historySummary.completed} 条，失败 {historySummary.failed} 条，暂停 {historySummary.paused} 条，停止 {historySummary.stopped} 条，累计完成 {formatBytes(historySummary.totalBytes)}
              </div>
            </Row>
            <Row label="筛选">
              <div className="w-[40rem] grid grid-cols-[9rem_1fr] gap-2">
                <Select
                  value={downloadHistoryFilter}
                  onChange={(value) => setDownloadHistoryFilter(value as DownloadHistoryStatusFilter)}
                  options={[
                    { label: '全部状态', value: 'all' },
                    { label: '已完成', value: 'completed' },
                    { label: '失败', value: 'failed' },
                    { label: '暂停', value: 'paused' },
                    { label: '停止', value: 'stopped' },
                  ]}
                  className="w-full"
                />
                <div className="flex items-center h-[32px] px-2 border border-black/10 rounded-md bg-white">
                  <input
                    value={downloadHistoryKeyword}
                    onChange={(event) => setDownloadHistoryKeyword(event.target.value)}
                    placeholder="名称 / URL / 保存路径"
                    className="w-full text-[12px] text-text-main bg-transparent focus:outline-none"
                  />
                </div>
              </div>
            </Row>
            <Row label="历史预览">
              <div className="w-[40rem]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] text-text-muted">当前匹配 {filteredHistoryTasks.length} 条，展示最近 20 条</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCheckDownloadHistoryIntegrity}
                      className="px-3 h-[28px] border border-black/20 text-text-main rounded-md text-[12px] hover:bg-black/5 transition-colors cursor-pointer"
                    >
                      完整性检查
                    </button>
                    <button
                      onClick={handleOpenDownloadHistory}
                      className="px-3 h-[28px] border border-black/20 text-text-main rounded-md text-[12px] hover:bg-black/5 transition-colors cursor-pointer"
                    >
                      查看历史记录
                    </button>
                    <button
                      onClick={() => void handleClearDownloadHistory()}
                      disabled={clearingHistory}
                      className="px-3 h-[28px] border border-red-300 text-red-500 rounded-md text-[12px] hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {clearingHistory ? '清空中...' : '清空历史记录'}
                    </button>
                  </div>
                </div>
                <div className="rounded-md border border-black/10 bg-white overflow-hidden">
                  <div className="grid grid-cols-[7rem_6rem_1fr_7rem] gap-2 px-3 py-2 text-[12px] text-text-muted border-b border-black/10">
                    <span>时间</span>
                    <span>状态</span>
                    <span>任务</span>
                    <span className="text-right">大小</span>
                  </div>
                  <div className="max-h-56 overflow-auto custom-scrollbar">
                    {filteredHistoryTasks.slice(0, 20).length === 0 ? (
                      <div className="px-3 py-3 text-[12px] text-text-muted">暂无历史记录</div>
                    ) : (
                      filteredHistoryTasks.slice(0, 20).map((task) => (
                        <div key={task.id} className="grid grid-cols-[7rem_6rem_1fr_7rem] gap-2 px-3 py-2 text-[12px] border-b border-black/5 last:border-b-0">
                          <span className="text-text-muted">{formatDateTime(task.completedAt ?? task.createdAt)}</span>
                          <span className={task.status === 'failed' ? 'text-red-500' : task.status === 'completed' ? 'text-emerald-600' : 'text-[#c7892f]'}>
                            {task.status === 'completed' ? '已完成' : task.status === 'failed' ? '失败' : task.status === 'paused' ? '暂停' : '停止'}
                          </span>
                          <span className="truncate text-text-main" title={task.name || task.url}>{task.name || task.url}</span>
                          <span className="text-right text-text-main">{formatBytes(task.totalBytes > 0 ? task.totalBytes : task.downloadedBytes)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </Row>
            {downloadHistoryCheck ? (
              <Row label="检查结果">
                <div className="w-[40rem] rounded-md border border-black/10 bg-white px-3 py-2">
                  <div className={`text-[12px] ${downloadHistoryCheck.issueCount > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                    {formatDateTime(new Date(downloadHistoryCheck.checkedAt).getTime())} · {downloadHistoryCheck.issueCount > 0 ? `发现 ${downloadHistoryCheck.issueCount} 个问题` : '未发现问题'}
                  </div>
                  {downloadHistoryCheck.samples.length > 0 ? (
                    <div className="mt-1 space-y-1">
                      {downloadHistoryCheck.samples.map((sample) => (
                        <div key={sample} className="text-[12px] text-text-muted">{sample}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Row>
            ) : null}
          </Section>

          <Section title="恢复设置">
            <Row label="当前数据">
              <div className="text-[12px] text-text-muted">
                当前任务 {restoreScopeSummary.taskCount} 条（已完成 {restoreScopeSummary.completedCount} 条），开发者日志 {restoreScopeSummary.logCount} 条
              </div>
            </Row>
            <Row>
              <button
                onClick={() => void handleOpenPath(installDir, '安装目录未就绪')}
                className="flex items-center gap-1.5 px-4 py-1.5 border border-black/20 text-text-main rounded-md text-[13px] hover:bg-black/5 transition-colors cursor-pointer"
              >
                <FolderOpen size={14} /> 打开配置文件夹
              </button>
              <button
                onClick={() => void handleExportSettingsBackup()}
                className="px-4 py-1.5 border border-black/20 text-text-main rounded-md text-[13px] hover:bg-black/5 transition-colors cursor-pointer"
              >
                导出设置备份
              </button>
              <button
                onClick={() => void handleImportSettingsBackup()}
                className="px-4 py-1.5 border border-black/20 text-text-main rounded-md text-[13px] hover:bg-black/5 transition-colors cursor-pointer"
              >
                导入设置备份
              </button>
            </Row>
            <Row>
              <button
                onClick={() => handleOpenRestoreDialog('advanced')}
                className="px-4 py-1.5 border border-[#e5a038] text-[#e5a038] rounded-md text-[13px] hover:bg-[#e5a038]/5 transition-colors cursor-pointer"
              >
                恢复默认设置
              </button>
              <button
                onClick={() => handleOpenRestoreDialog('factory')}
                className="px-4 py-1.5 border border-red-300 text-red-500 rounded-md text-[13px] hover:bg-red-50 transition-colors cursor-pointer"
              >
                恢复出厂设置
              </button>
              <span className="text-[12px] text-text-muted">出厂恢复会清空任务记录、开发者日志与 app.log</span>
            </Row>
          </Section>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-main via-main to-transparent flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <button
            onClick={handleApply}
            className="px-6 py-2 bg-[#387b3e] hover:bg-[#2e6833] text-white rounded-md text-[13px] transition-colors shadow-sm cursor-pointer"
          >
            保存并应用
          </button>
          <button
            onClick={handleDiscard}
            className="px-6 py-2 bg-red-100 hover:bg-red-200 text-red-500 rounded-md text-[13px] transition-colors shadow-sm cursor-pointer"
          >
            放弃
          </button>
          <button
            onClick={() => void handleRestartEngine()}
            disabled={restarting}
            className="flex items-center gap-2 px-6 py-2 bg-white border border-[#e5a038]/30 text-[#e5a038] hover:bg-[#e5a038]/5 rounded-md text-[13px] transition-colors shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw size={14} className={restarting ? 'animate-spin' : ''} />
            {restarting ? '重启中...' : '更新并重启 aria2 引擎'}
          </button>
        </div>
        <div className="pointer-events-auto">
          <button
            onClick={handleApply}
            className="w-10 h-10 flex items-center justify-center rounded-full border border-black/10 bg-white hover:bg-black/5 text-text-muted transition-colors shadow-sm cursor-pointer"
          >
            <Gauge size={18} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      {trackerSyncPreview ? (
        <div className="fixed inset-0 z-[80] bg-black/35 flex items-center justify-center p-6">
          <div className="w-[42rem] max-h-[80vh] rounded-xl bg-white border border-black/10 shadow-xl flex flex-col">
            <div className="px-5 h-12 border-b border-black/5 flex items-center justify-between">
              <span className="text-[14px] font-medium text-text-main">Tracker 同步预览</span>
              <button
                onClick={() => setTrackerSyncPreview(null)}
                className="w-7 h-7 rounded-md border border-black/10 hover:bg-black/5 text-text-muted flex items-center justify-center cursor-pointer transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4 text-[13px] text-text-main space-y-3 overflow-y-auto custom-scrollbar">
              <div className="text-text-muted text-[12px] break-all">
                文件：{trackerSyncPreview.path}
              </div>
              <div className="flex items-center gap-3 text-[12px]">
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">新增 {trackerSyncPreview.added.length}</span>
                <span className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200">移除 {trackerSyncPreview.removed.length}</span>
                <span className="px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200">目标总数 {trackerSyncPreview.nextCount}</span>
              </div>
              {trackerSyncPreview.added.length > 0 ? (
                <div>
                  <div className="text-[12px] text-emerald-700 mb-1">将新增（最多显示 20 条）</div>
                  <div className="px-3 py-2 rounded-md border border-emerald-100 bg-emerald-50/40 text-[12px] leading-relaxed break-all">
                    {trackerSyncPreview.added.slice(0, 20).join('\n')}
                  </div>
                </div>
              ) : null}
              {trackerSyncPreview.removed.length > 0 ? (
                <div>
                  <div className="text-[12px] text-rose-700 mb-1">将移除（最多显示 20 条）</div>
                  <div className="px-3 py-2 rounded-md border border-rose-100 bg-rose-50/40 text-[12px] leading-relaxed break-all">
                    {trackerSyncPreview.removed.slice(0, 20).join('\n')}
                  </div>
                </div>
              ) : null}
              {trackerSyncPreview.added.length === 0 && trackerSyncPreview.removed.length === 0 ? (
                <div className="text-[12px] text-text-muted">本次同步与当前列表一致，不会产生变更。</div>
              ) : null}
            </div>
            <div className="px-5 py-3 border-t border-black/5 flex items-center justify-end gap-2">
              <button
                onClick={() => setTrackerSyncPreview(null)}
                className="px-4 h-[32px] rounded-md border border-black/10 bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleApplyTrackerSyncPreview}
                className="px-4 h-[32px] rounded-md border border-[#e5a038] bg-[#e5a038] text-white hover:bg-[#d49028] text-[13px] transition-colors cursor-pointer"
              >
                应用同步
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {restoreAction ? createPortal(
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/35" onClick={() => (restoring ? null : setRestoreAction(null))} />
          <div className="relative w-[30rem] rounded-xl border border-black/10 bg-white shadow-xl p-5">
            <button
              onClick={() => setRestoreAction(null)}
              disabled={restoring}
              className="absolute top-3 right-3 w-7 h-7 rounded-md border border-black/10 hover:bg-black/5 text-text-muted flex items-center justify-center cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X size={14} />
            </button>
            <div className="flex items-center gap-2 text-text-main">
              <AlertTriangle size={16} className={restoreAction === 'factory' ? 'text-red-500' : 'text-[#e5a038]'} />
              <span className="text-[15px] font-medium">{restoreAction === 'factory' ? '确认恢复出厂设置' : '确认恢复进阶默认设置'}</span>
            </div>
            <div className="mt-3 text-[13px] text-text-muted leading-relaxed">
              {restoreAction === 'factory'
                ? `将重置基础与进阶设置，并清空任务 ${restoreScopeSummary.taskCount} 条、开发者日志 ${restoreScopeSummary.logCount} 条及 app.log。`
                : '将重置当前页面涉及的全部进阶配置为默认值。'}
            </div>
            {restoreAction === 'factory' ? (
              <div className="mt-3">
                <div className="text-[12px] text-text-main mb-1">请输入 RESET 继续</div>
                <input
                  value={restoreToken}
                  onChange={(event) => setRestoreToken(event.target.value)}
                  className="w-full h-[32px] px-3 border border-black/10 rounded-md bg-white text-[13px] text-text-main focus:outline-none focus:border-red-300"
                />
              </div>
            ) : null}
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={() => setRestoreAction(null)}
                disabled={restoring}
                className="px-4 h-[32px] border border-black/10 rounded-md bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
              <button
                onClick={() => void handleRestoreSettings()}
                disabled={restoring || (restoreAction === 'factory' && restoreToken.trim().toUpperCase() !== 'RESET')}
                className={`px-4 h-[32px] rounded-md text-[13px] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${restoreAction === 'factory' ? 'border border-red-300 bg-red-500 hover:bg-red-600 text-white' : 'border border-[#e5a038] bg-[#e5a038] hover:bg-[#d49028] text-white'}`}
              >
                {restoring ? '执行中...' : '确认恢复'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
      {notices.length > 0 ? (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[70] flex flex-col gap-2">
          {notices.map((item) => (
            <div key={item.id} className="min-w-[260px] h-[40px] px-4 rounded-[10px] bg-white border border-black/5 shadow-lg flex items-center justify-between">
              <div className="flex items-center gap-3 text-[13px] text-text-main">
                {item.type === 'info' ? (
                  <div className="w-4 h-4 rounded-full bg-[#3b82f6] flex items-center justify-center shrink-0">
                    <span className="text-white text-[11px] font-bold leading-none italic">i</span>
                  </div>
                ) : null}
                {item.type === 'warning' ? (
                  <div className="w-4 h-4 rounded-full bg-[#f5a524] flex items-center justify-center shrink-0">
                    <span className="text-white text-[11px] font-bold leading-none">!</span>
                  </div>
                ) : null}
                {item.type === 'success' ? (
                  <div className="w-4 h-4 rounded-full bg-[#10b981] flex items-center justify-center shrink-0">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                ) : null}
                <span>{item.text}</span>
              </div>
              <button
                onClick={() => setNotices((prev) => prev.filter((v) => v.id !== item.id))}
                className="text-text-muted hover:text-text-main cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

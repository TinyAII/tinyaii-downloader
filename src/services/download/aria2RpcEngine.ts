import { useAdvancedSettingsStore } from '../../store/settings/advancedStore';
import { safeJson, writeDeveloperLog } from '../../store/developerLogStore';
import type {
  CreateTaskPayload,
  DownloadTask,
  DownloadTaskDetail,
  TaskFile,
  TaskSourceType,
  TaskStatus,
} from '../../types/task';
import { validateAndNormalizeTaskPayload } from '../../utils/taskValidation';

interface Aria2RpcConfig {
  rpcPort: number;
  rpcSecret: string;
  aria2ExecutablePath: string;
}

interface Aria2GlobalSpeedLimit {
  uploadLimitBytes: number;
  downloadLimitBytes: number;
}

interface Aria2GlobalBtOptions {
  autoDownloadTorrent: boolean;
  forceEncrypt: boolean;
  keepSeeding: boolean;
  seedRatio: number;
  seedTimeMinutes: number;
}

interface Aria2RemoteTask {
  id: string;
  sourceType: TaskSourceType;
  url: string;
  name: string;
  status: TaskStatus;
  splitCount: number;
  savePath: string;
  totalBytes: number;
  downloadedBytes: number;
  speedBytes: number;
  uploadSpeedBytes: number;
  createdAt: number;
  completedAt: number | null;
  bitfield: string;
  pieceLength: number;
  connections: number;
  errorCode: string;
  errorMessage: string;
  files: TaskFile[];
}

interface Aria2RemoteTorrentPeer {
  address: string;
  client: string;
  progress: number;
  downloadSpeedBytes: number;
  uploadSpeedBytes: number;
  flag: string;
  isSeeder: boolean;
}

interface Aria2RemoteTorrentTracker {
  index: number;
  url: string;
  protocol: string;
  status: 'online' | 'offline' | 'unknown';
}

interface Aria2RemoteTorrentDetail {
  infoHash: string;
  comment: string;
  createdAt: number | null;
  mode: string;
  pieceCount: number;
  pieceLength: number;
  uploadSpeedBytes: number;
  uploadedBytes: number;
  seeders: number;
  connections: number;
  peers: Aria2RemoteTorrentPeer[];
  trackers: Aria2RemoteTorrentTracker[];
}

interface Aria2RemoteTaskDetail {
  torrent: Aria2RemoteTorrentDetail | null;
}

interface Aria2VersionInfo {
  version: string;
  enabledFeatures: string[];
}

export type Aria2ConnectionStatus = 'online' | 'offline' | 'auth_failed';

export interface Aria2EngineStatus {
  status: Aria2ConnectionStatus;
  version: string;
  enabledFeatures: string[];
  message: string;
}

export interface TaskOptionConstraints {
  minSplitCount: number;
  maxSplitCount: number;
  maxConnectionPerServer: number;
  defaultSplitCount: number;
  defaultMaxConnectionsPerServer: number;
}

export interface TaskTransferOptions {
  splitCount: number;
  maxConnectionPerServer: number;
}

export interface ListenPortProbeItem {
  port: number;
  tcpAvailable: boolean;
  udpAvailable: boolean;
  available: boolean;
}

export interface ListenPortProbeResult {
  bt: ListenPortProbeItem;
  dht: ListenPortProbeItem;
}

export interface AppFileMeta {
  sizeBytes: number;
  modifiedAt: number | null;
}

const EMPTY_ADVANCED = {
  userAgent: '',
  authorization: '',
  referer: '',
  cookie: '',
  proxy: '',
};

const STATUS_CACHE_TTL_MS = 60 * 1000;
const OFFLINE_STATUS_CACHE_TTL_MS = 5 * 1000;
let cachedEngineStatus: { value: Aria2EngineStatus; expiresAt: number } | null = null;
let lastErrorFingerprint = '';
let lastErrorTime = 0;
const failureFingerprintByTaskId = new Map<string, string>();

function toConfig(config?: Aria2RpcConfig): Aria2RpcConfig {
  if (config) return config;
  const state = useAdvancedSettingsStore.getState();
  return {
    rpcPort: state.rpcPort,
    rpcSecret: state.rpcSecret,
    aria2ExecutablePath: state.aria2ExecutablePath,
  };
}

function mapRemoteTask(task: Aria2RemoteTask): DownloadTask {
  return {
    ...task,
    displayTotalBytes: task.totalBytes > 0 ? task.totalBytes : null,
    advanced: EMPTY_ADVANCED,
  };
}

async function invokeCommand<T>(command: string, args: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

async function invokeCommandLogged<T>(command: string, args: Record<string, unknown>) {
  try {
    return await invokeCommand<T>(command, args);
  } catch (error) {
    addAria2Log(command, 'error', normalizeErrorMessage(error), safeJson(args));
    throw error;
  }
}

async function invokeCommandWithTimeout<T>(command: string, args: Record<string, unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`调用超时: ${command}`));
      }, timeoutMs);
    });
    return await Promise.race([invokeCommandLogged<T>(command, args), timeoutPromise]);
  } catch (error) {
    const message = normalizeErrorMessage(error);
    const fingerprint = `${command}|${message}`;
    const now = Date.now();
    if (fingerprint !== lastErrorFingerprint || now - lastErrorTime > 3000) {
      addAria2Log(command, 'error', message, safeJson(args));
      lastErrorFingerprint = fingerprint;
      lastErrorTime = now;
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeErrorMessage(error: unknown) {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function addAria2Log(action: string, level: 'debug' | 'info' | 'warn' | 'error', message: string, details?: string) {
  writeDeveloperLog({
    source: 'aria2',
    action,
    level,
    message,
    details,
  });
}

function classifyConnectionStatus(message: string): Aria2ConnectionStatus {
  const text = message.toLowerCase();
  if (
    text.includes('unauthorized') ||
    text.includes('token') ||
    text.includes('secret') ||
    text.includes('401')
  ) {
    return 'auth_failed';
  }
  return 'offline';
}

function buildTaskFailureReason(task: DownloadTask) {
  const message = (task.errorMessage ?? '').trim();
  if (message) {
    const lower = message.toLowerCase();
    if (message.includes('The Link Has Expired') || message.includes('Link Has Expired') || lower.includes('link has expired')) {
      return '下载链接已过期，请更换有效链接后重试';
    }
    if (message.includes('429') || lower.includes('too many requests')) {
      return '源站触发限流（429），建议降低并发连接后重试';
    }
    if (message.includes('403') && lower.includes('forbidden')) {
      return '源站拒绝访问（403），请检查链接鉴权信息';
    }
    return message;
  }
  const code = (task.errorCode ?? '').trim();
  if (code) return `aria2 返回错误码 ${code}，但未提供错误描述`;
  return '任务进入失败状态，但未返回错误详情';
}

function logFailedTaskDetails(tasks: DownloadTask[]) {
  const liveTaskIds = new Set<string>();
  tasks.forEach((task) => {
    liveTaskIds.add(task.id);
    if (task.status !== 'failed') {
      failureFingerprintByTaskId.delete(task.id);
      return;
    }
    const reason = buildTaskFailureReason(task);
    const fingerprint = `${task.errorCode ?? ''}|${task.errorMessage ?? ''}|${task.downloadedBytes}|${task.totalBytes}`;
    if (failureFingerprintByTaskId.get(task.id) === fingerprint) {
      return;
    }
    failureFingerprintByTaskId.set(task.id, fingerprint);
    addAria2Log(
      'aria2_task_failed',
      'error',
      `任务失败: ${task.name || task.id}，原因：${reason}`,
      safeJson({
        gid: task.id,
        url: task.url,
        status: task.status,
        errorCode: task.errorCode ?? '',
        errorMessage: task.errorMessage ?? '',
        downloadedBytes: task.downloadedBytes,
        totalBytes: task.totalBytes,
      })
    );
  });
  Array.from(failureFingerprintByTaskId.keys()).forEach((taskId) => {
    if (!liveTaskIds.has(taskId)) {
      failureFingerprintByTaskId.delete(taskId);
    }
  });
}

export async function aria2CreateTasks(payload: CreateTaskPayload, config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  const constraints = await aria2GetTaskOptionConstraints();
  const validatedPayload = validateAndNormalizeTaskPayload(payload, constraints);
  const remoteTasks = await invokeCommandLogged<Aria2RemoteTask[]>('aria2_add_tasks', {
    request: {
      payload: validatedPayload,
      config: requestConfig,
    },
  });
  addAria2Log(
    'aria2_add_tasks',
    'info',
    `任务创建成功: ${remoteTasks.length} 条`,
    safeJson({
      savePath: validatedPayload.savePath,
      splitCount: validatedPayload.splitCount,
      maxConnectionsPerServer: validatedPayload.maxConnectionsPerServer,
      links: validatedPayload.links.length,
    })
  );
  return remoteTasks.map((task) => ({
    ...mapRemoteTask(task),
    requestedMaxConnectionsPerServer: validatedPayload.maxConnectionsPerServer,
    requestedSplitCount: validatedPayload.splitCount,
  }));
}

export async function aria2FetchTasks(config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  const remoteTasks = await invokeCommandLogged<Aria2RemoteTask[]>('aria2_get_tasks', {
    config: requestConfig,
  });
  const tasks = remoteTasks.map(mapRemoteTask);
  logFailedTaskDetails(tasks);
  return tasks;
}

export async function aria2GetTaskDetail(
  taskId: string,
  options?: { probeTrackers?: boolean },
  config?: Aria2RpcConfig
) {
  const requestConfig = toConfig(config);
  const detail = await invokeCommandLogged<Aria2RemoteTaskDetail>('aria2_get_task_detail', {
    request: {
      taskId,
      probeTrackers: options?.probeTrackers ?? false,
      config: requestConfig,
    },
  });
  return detail as DownloadTaskDetail;
}

export async function aria2StartTask(taskId: string, transferOptions: TaskTransferOptions, config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  const constraints = await aria2GetTaskOptionConstraints();
  const splitCount = Math.min(Math.max(transferOptions.splitCount, constraints.minSplitCount), constraints.maxSplitCount);
  const maxConnectionPerServer = Math.min(
    Math.max(transferOptions.maxConnectionPerServer, constraints.minSplitCount),
    constraints.maxConnectionPerServer
  );
  await invokeCommandLogged<void>('aria2_start_task', {
    request: {
      taskId,
      splitCount,
      maxConnectionPerServer,
      config: requestConfig,
    },
  });
}

export async function aria2PauseTask(taskId: string, config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  await invokeCommandLogged<void>('aria2_pause_task', { taskId, config: requestConfig });
}

/**
 * 替换任务的 URI（用于网盘直链 token 过期后刷新链接）
 * 调用 aria2.changeUri，不重建任务、不丢进度
 * @returns 未被移除的 URI 数量
 */
export async function aria2ChangeUri(
  taskId: string,
  fileIndex: number,
  delUris: string[],
  addUris: string[],
  config?: Aria2RpcConfig
) {
  const requestConfig = toConfig(config);
  return invokeCommandLogged<number>('aria2_change_uri', {
    taskId,
    fileIndex,
    delUris,
    addUris,
    config: requestConfig,
  });
}

export async function aria2StopTask(taskId: string, config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  await invokeCommandLogged<void>('aria2_stop_task', { taskId, config: requestConfig });
}

export async function aria2RemoveTask(
  taskId: string,
  options?: {
    deleteDownloadedFiles?: boolean;
    downloadedFilePaths?: string[];
  },
  config?: Aria2RpcConfig
) {
  const requestConfig = toConfig(config);
  await invokeCommandLogged<void>('aria2_remove_task', {
    taskId,
    deleteDownloadedFiles: options?.deleteDownloadedFiles ?? false,
    downloadedFilePaths: options?.downloadedFilePaths ?? [],
    config: requestConfig,
  });
}

export async function aria2StartAll(config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  await invokeCommandLogged<void>('aria2_start_all_tasks', { config: requestConfig });
}

export async function aria2PauseAll(config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  await invokeCommandLogged<void>('aria2_pause_all_tasks', { config: requestConfig });
}

export async function aria2StopAll(config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  await invokeCommandLogged<void>('aria2_stop_all_tasks', { config: requestConfig });
}

export async function aria2ClearCompleted(config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  await invokeCommandLogged<void>('aria2_clear_completed_tasks', { config: requestConfig });
}

export async function aria2ClearAll(config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  await invokeCommandLogged<void>('aria2_clear_all_tasks', { config: requestConfig });
}

export async function aria2GetVersion(config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  return invokeCommandWithTimeout<Aria2VersionInfo>('aria2_get_version', { config: requestConfig }, 20000);
}

export async function aria2GetEngineStatus(forceRefresh = false, config?: Aria2RpcConfig) {
  const now = Date.now();
  if (!forceRefresh && cachedEngineStatus && cachedEngineStatus.expiresAt > now) {
    return cachedEngineStatus.value;
  }
  try {
    const result = await aria2GetVersion(config);
    const version = result.version.trim();
    const value: Aria2EngineStatus = {
      status: 'online',
      version: version ? (version.startsWith('v') ? version : `v${version}`) : '未知版本',
      enabledFeatures: result.enabledFeatures,
      message: '连接正常',
    };
    cachedEngineStatus = { value, expiresAt: now + STATUS_CACHE_TTL_MS };
    return value;
  } catch (error) {
    const message = normalizeErrorMessage(error);
    const status = classifyConnectionStatus(message);
    addAria2Log('engine_status_check', 'error', message, safeJson({ forceRefresh, config: toConfig(config), status }));
    const value: Aria2EngineStatus = {
      status,
      version: '不可用',
      enabledFeatures: [],
      message: status === 'auth_failed' ? '鉴权失败' : '连接失败',
    };
    const ttl = status === 'offline' ? OFFLINE_STATUS_CACHE_TTL_MS : STATUS_CACHE_TTL_MS;
    cachedEngineStatus = { value, expiresAt: now + ttl };
    return value;
  }
}

export async function aria2RestartEngine(config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  addAria2Log('update_and_restart', 'info', '开始更新并重启 aria2 引擎', safeJson({ config: requestConfig }));
  await invokeCommandWithTimeout<void>('aria2_update_and_restart_engine', { config: requestConfig }, 120000);
  addAria2Log('update_and_restart', 'info', 'aria2 引擎更新并重启完成');
  cachedEngineStatus = null;
}

export async function aria2SetGlobalSpeedLimit(limit: Aria2GlobalSpeedLimit, config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  await invokeCommandLogged<void>('aria2_set_global_speed_limit', {
    request: limit,
    config: requestConfig,
  });
}

export async function aria2SetGlobalBtOptions(options: Aria2GlobalBtOptions, config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  await invokeCommandLogged<void>('aria2_set_global_bt_options', {
    request: options,
    config: requestConfig,
  });
}

export async function aria2SetGlobalTrackerList(trackerList: string, config?: Aria2RpcConfig) {
  const requestConfig = toConfig(config);
  await invokeCommandLogged<void>('aria2_set_global_tracker_list', {
    trackerList,
    config: requestConfig,
  });
}

export async function aria2GetTaskOptionConstraints() {
  return invokeCommand<TaskOptionConstraints>('aria2_get_task_option_constraints', {});
}

export async function appGetInstallDir() {
  return invokeCommand<string>('app_get_install_dir', {});
}

export async function appReadTextFile(filePath: string) {
  return invokeCommand<string>('app_read_text_file', { filePath });
}

export async function appWriteTextFile(filePath: string, content: string) {
  return invokeCommand<void>('app_write_text_file', { filePath, content });
}

export async function appHttpGetText(url: string, headers?: Record<string, string>) {
  return invokeCommand<string>('app_http_get_text', {
    request: {
      url,
      headers: headers || {},
    },
  });
}

export async function appGetFileMeta(filePath: string) {
  return invokeCommand<AppFileMeta>('app_get_file_meta', { filePath });
}

export async function appTruncateTextFile(filePath: string) {
  return invokeCommand<void>('app_truncate_text_file', { filePath });
}

export async function appProbeListenPorts(btPort: number, dhtPort: number) {
  return invokeCommand<ListenPortProbeResult>('app_probe_listen_ports', {
    request: { btPort, dhtPort },
  });
}

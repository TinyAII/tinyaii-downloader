import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  aria2ChangeUri,
  aria2ClearAll,
  aria2ClearCompleted,
  aria2CreateTasks,
  aria2FetchTasks,
  aria2PauseAll,
  aria2PauseTask,
  aria2RemoveTask,
  aria2StartTask,
  aria2StopAll,
  aria2StopTask,
} from '../services/download/aria2RpcEngine';
import { resolveTaskPayloadByPlugins } from '../services/resolver/linkResolverEngine';
import { resolverPlugins } from '../services/resolver/registry';
import { useBasicSettingsStore } from './settings/basicStore';
import { useAdvancedSettingsStore } from './settings/advancedStore';
import { useResolverAuthStore } from './resolverAuth';
import { applyGithubMirror, resolveMirror } from '../utils/githubMirror';
import { writeDeveloperLog } from './developerLogStore';
import type { CreateTaskPayload, DownloadTask } from '../types/task';
import { buildRetryTaskPayload, type TaskRemoveRequest } from '../utils/taskActions';

interface TaskState {
  tasks: DownloadTask[];
  bootRuntime: () => void;
  createTasks: (payload: CreateTaskPayload, mirrorPrefixOverride?: string | null) => Promise<number>;
  refreshTasks: () => Promise<void>;
  startTask: (taskId: string) => Promise<void>;
  retryTask: (taskId: string) => Promise<boolean>;
  pauseTask: (taskId: string) => Promise<void>;
  stopTask: (taskId: string) => Promise<void>;
  removeTask: (taskId: string, options?: TaskRemoveRequest) => Promise<void>;
  startAll: () => Promise<void>;
  pauseAll: () => Promise<void>;
  stopAll: () => Promise<void>;
  clearCompleted: () => Promise<void>;
  clearAllTasks: () => Promise<void>;
  // 软重启任务：pause → 等待落盘 → start，保留进度且重新下发用户原始参数
  reconnectTask: (taskId: string) => Promise<boolean>;
  // 刷新鉴权链接：对网盘直链 token 过期场景，调用解析插件拿新链接走 aria2.changeUri 替换
  refreshTaskLink: (taskId: string) => Promise<boolean>;
}

let runtimeTimer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight = false;
const lowConnectionFingerprintByTaskId = new Map<string, string>();

// pause 后等待时间：让 aria2 完成控制文件（.aria2）落盘，避免进度丢失
// 这是技术性参数，不暴露给用户
const RECONNECT_PAUSE_DELAY_MS = 800;
const lastReconnectAtByTaskId = new Map<string, number>();

function normalizeErrorMessage(error: unknown) {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

function isBtPayload(payload: CreateTaskPayload) {
  return payload.type === 'torrent' || payload.links.some((link) => link.trim().startsWith('magnet:?'));
}

function withDefaultBtOptions(payload: CreateTaskPayload): CreateTaskPayload {
  if (!isBtPayload(payload) || payload.btOptions) {
    return payload;
  }
  const basicSettings = useBasicSettingsStore.getState();
  const advancedSettings = useAdvancedSettingsStore.getState();
  return {
    ...payload,
    btOptions: {
      autoDownloadTorrent: basicSettings.autoDownloadTorrent,
      forceEncrypt: basicSettings.forceEncrypt,
      keepSeeding: basicSettings.keepSeeding,
      seedRatio: basicSettings.seedRatio,
      seedTimeMinutes: basicSettings.seedTimeMinutes,
      trackerList: advancedSettings.trackerList,
    },
  };
}

function ensureRuntime(refreshTasks: () => Promise<void>) {
  if (runtimeTimer) return;
  runtimeTimer = setInterval(() => {
    void refreshTasks();
  }, 1000);
}

function logLowConnectionTasks(tasks: DownloadTask[]) {
  const livingTaskIds = new Set<string>();
  tasks.forEach((task) => {
    livingTaskIds.add(task.id);
    if (task.status !== 'downloading') {
      lowConnectionFingerprintByTaskId.delete(task.id);
      return;
    }
    const targetConnections = task.requestedMaxConnectionsPerServer ?? 0;
    const realtimeConnections = task.connections ?? 0;
    if (targetConnections < 32 || realtimeConnections <= 0 || realtimeConnections > 16 || realtimeConnections * 2 >= targetConnections) {
      lowConnectionFingerprintByTaskId.delete(task.id);
      return;
    }
    const fingerprint = `${targetConnections}|${realtimeConnections}|${task.speedBytes}`;
    if (lowConnectionFingerprintByTaskId.get(task.id) === fingerprint) {
      return;
    }
    lowConnectionFingerprintByTaskId.set(task.id, fingerprint);
    writeDeveloperLog({
      source: 'task-store',
      action: 'connection_bottleneck',
      level: 'warn',
      message: `任务连接受限：目标 ${targetConnections}，实时 ${realtimeConnections}`,
      details: JSON.stringify({
        taskId: task.id,
        taskName: task.name,
        targetConnections,
        realtimeConnections,
        speedBytes: task.speedBytes,
        url: task.url,
      }),
    });
  });
  Array.from(lowConnectionFingerprintByTaskId.keys()).forEach((taskId) => {
    if (!livingTaskIds.has(taskId)) {
      lowConnectionFingerprintByTaskId.delete(taskId);
    }
  });
}

export const useTaskStore = create<TaskState>()(
  persist(
    (set, get) => ({
      tasks: [],
      bootRuntime: () => {
        ensureRuntime(get().refreshTasks);
        void get().refreshTasks();
      },
      createTasks: async (payload, mirrorPrefixOverride) => {
        try {
          const normalizedPayload = withDefaultBtOptions(payload);
          const { payload: resolvedPayload, appliedPlugins } = await resolveTaskPayloadByPlugins(
            normalizedPayload,
            useResolverAuthStore.getState().sessions
          );
          if (appliedPlugins.length) {
            writeDeveloperLog({
              source: 'task-store',
              action: 'resolve_links',
              level: 'info',
              message: '已应用链接解析插件',
              details: JSON.stringify({
                plugins: appliedPlugins,
                before: normalizedPayload.links.length,
                after: resolvedPayload.links.length,
              }),
            });
          }
          const { githubMirrorId, githubMirrorList } = useAdvancedSettingsStore.getState();
          const settingsMirror = resolveMirror(githubMirrorList, githubMirrorId);
          // undefined = 跟随设置；null / 空串 = 本次任务强制直连；其它 = 本次任务指定前缀
          const effectivePrefix =
            mirrorPrefixOverride === undefined ? settingsMirror.prefix : mirrorPrefixOverride ?? '';
          const effectiveLabel =
            mirrorPrefixOverride === undefined ? settingsMirror.label : '本次任务指定';
          const mirroredLinks = effectivePrefix
            ? resolvedPayload.links.map((link) => applyGithubMirror(link, effectivePrefix))
            : resolvedPayload.links;
          const mirrorApplied = mirroredLinks.some(
            (link, index) => link !== resolvedPayload.links[index]
          );
          if (mirrorApplied) {
            writeDeveloperLog({
              source: 'task-store',
              action: 'apply_github_mirror',
              level: 'info',
              message: `已通过加速地址建立任务：${effectiveLabel}`,
              details: JSON.stringify({
                prefix: effectivePrefix,
                count: mirroredLinks.length,
              }),
            });
          }
          const created = await aria2CreateTasks(
            mirrorApplied ? { ...resolvedPayload, links: mirroredLinks } : resolvedPayload
          );
          if (!created.length) return 0;
          // 为解析插件产生的任务补充元信息：插件 id、是否鉴权链接、原始分享链接
          // 这些字段用于运行中 token 过期时刷新链接
          const resolverPluginId = appliedPlugins[0];
          const resolverPlugin = resolverPlugins.find((p) => p.id === resolverPluginId);
          const originalShareLink = normalizedPayload.links[0] ?? '';
          const enrichedCreated = created.map((task) => {
            if (!resolverPlugin) return task;
            const isAuthLink = resolverPlugin.detectAuthLink
              ? resolverPlugin.detectAuthLink(task.url)
              : false;
            return {
              ...task,
              resolverPluginId,
              isAuthLink,
              originalShareLink: originalShareLink || undefined,
            };
          });
          set((state) => ({
            tasks: [...enrichedCreated, ...state.tasks.filter((task) => !enrichedCreated.some((item) => item.id === task.id))],
          }));
          ensureRuntime(get().refreshTasks);
          void get().refreshTasks();
          return created.length;
        } catch (error) {
          const message = normalizeErrorMessage(error);
          writeDeveloperLog({
            source: 'task-store',
            action: 'create_tasks',
            level: 'error',
            message,
          });
          throw new Error(message);
        }
      },
      refreshTasks: async () => {
        if (refreshInFlight) return;
        refreshInFlight = true;
        try {
          const tasks = await aria2FetchTasks();
          const existingTasks = get().tasks;
          const mergedTasks = tasks.map((item) => {
            const existing = existingTasks.find((task) => task.id === item.id);
            const nextTask: DownloadTask = {
              ...item,
              requestedMaxConnectionsPerServer: item.requestedMaxConnectionsPerServer ?? existing?.requestedMaxConnectionsPerServer,
              requestedSplitCount: item.requestedSplitCount ?? existing?.requestedSplitCount,
              seedingStartedAt: item.status === 'seeding'
                ? existing?.seedingStartedAt ?? Date.now()
                : null,
              // 保留首次记录的 completedAt：后端 aria2 不返回真实完成时间，
              // 用 SystemTime::now() 兜底会导致每秒刷新都覆盖为当前时间，
              // 这里优先用 existing 已记录的首次完成时间，避免显示一直在涨
              completedAt: existing?.completedAt ?? item.completedAt,
              // 保留解析插件元信息（aria2 tellStatus 不返回这些字段）
              resolverPluginId: existing?.resolverPluginId,
              isAuthLink: existing?.isAuthLink,
              originalShareLink: existing?.originalShareLink,
            };
            if ((item.advanced.userAgent || item.advanced.authorization || item.advanced.referer || item.advanced.cookie || item.advanced.proxy).trim()) {
              return nextTask;
            }
            return existing?.advanced ? { ...nextTask, advanced: existing.advanced } : nextTask;
          });
          set({ tasks: mergedTasks });
          logLowConnectionTasks(mergedTasks);
        } catch (error) {
          console.error('刷新 aria2 任务失败', error);
        } finally {
          refreshInFlight = false;
        }
      },
      startTask: async (taskId) => {
        try {
          const task = get().tasks.find((item) => item.id === taskId);
          const basicSettings = useBasicSettingsStore.getState();
          await aria2StartTask(taskId, {
            splitCount: task?.requestedSplitCount ?? basicSettings.defaultSplitCount,
            maxConnectionPerServer: task?.requestedMaxConnectionsPerServer ?? basicSettings.maxConnectionsPerServer,
          });
          await get().refreshTasks();
        } catch (error) {
          const message = normalizeErrorMessage(error);
          writeDeveloperLog({
            source: 'task-store',
            action: 'start_task',
            level: 'error',
            message,
          });
          console.error('开始任务失败', error);
        }
      },
      retryTask: async (taskId) => {
        try {
          const task = get().tasks.find((item) => item.id === taskId);
          if (!task) {
            return false;
          }
          const basicSettings = useBasicSettingsStore.getState();
          const payload = buildRetryTaskPayload(task, {
            defaultSplitCount: basicSettings.defaultSplitCount,
            defaultMaxConnectionsPerServer: basicSettings.maxConnectionsPerServer,
          });
          if (!payload) {
            return false;
          }
          await get().createTasks(payload);
          return true;
        } catch (error) {
          const message = normalizeErrorMessage(error);
          writeDeveloperLog({
            source: 'task-store',
            action: 'retry_task',
            level: 'error',
            message,
          });
          throw new Error(message);
        }
      },
      pauseTask: async (taskId) => {
        try {
          await aria2PauseTask(taskId);
          await get().refreshTasks();
        } catch (error) {
          console.error('暂停任务失败', error);
        }
      },
      // 软重启：pause → 等待落盘 → start（startTask 会重新下发用户原始 splitCount/maxConnectionPerServer）
      // 不改变用户设置的连接数，只是重建连接池，用于应对速度衰减
      reconnectTask: async (taskId) => {
        // 冷却时间从用户设置读取，默认 60 秒
        const cooldownMs = useBasicSettingsStore.getState().reconnectCooldownSeconds * 1000;
        const now = Date.now();
        const lastReconnectAt = lastReconnectAtByTaskId.get(taskId) ?? 0;
        if (now - lastReconnectAt < cooldownMs) {
          writeDeveloperLog({
            source: 'task-store',
            action: 'reconnect_skipped_cooldown',
            level: 'info',
            message: `任务 ${taskId} 重连冷却中（${Math.ceil((cooldownMs - (now - lastReconnectAt)) / 1000)}秒后可重试）`,
          });
          return false;
        }
        lastReconnectAtByTaskId.set(taskId, now);
        try {
          await aria2PauseTask(taskId);
          // 等待 aria2 落盘 .aria2 控制文件，避免进度丢失
          await new Promise((resolve) => setTimeout(resolve, RECONNECT_PAUSE_DELAY_MS));
          // startTask 内部会重新下发用户原始参数（requestedSplitCount/requestedMaxConnectionsPerServer）
          await get().startTask(taskId);
          writeDeveloperLog({
            source: 'task-store',
            action: 'reconnect_success',
            level: 'info',
            message: `任务 ${taskId} 已软重启（保留进度，重新建立连接）`,
          });
          return true;
        } catch (error) {
          const message = normalizeErrorMessage(error);
          writeDeveloperLog({
            source: 'task-store',
            action: 'reconnect_failed',
            level: 'error',
            message,
          });
          return false;
        }
      },
      stopTask: async (taskId) => {
        try {
          await aria2StopTask(taskId);
          await get().refreshTasks();
        } catch (error) {
          console.error('停止任务失败', error);
        }
      },
      // 刷新鉴权链接：调用解析插件拿新链接，走 aria2.changeUri 替换
      // 不重建任务、不丢进度，仅替换 URL
      refreshTaskLink: async (taskId) => {
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task) return false;
        // 必须有解析插件 id、原始分享链接、且是鉴权链接
        if (!task.resolverPluginId || !task.originalShareLink || !task.isAuthLink) {
          writeDeveloperLog({
            source: 'task-store',
            action: 'refresh_link_skipped',
            level: 'info',
            message: `任务 ${taskId} 非鉴权链接或缺少原始分享链接，跳过刷新`,
          });
          return false;
        }
        const plugin = resolverPlugins.find((p) => p.id === task.resolverPluginId);
        if (!plugin?.refresh) {
          writeDeveloperLog({
            source: 'task-store',
            action: 'refresh_link_unsupported',
            level: 'warn',
            message: `插件 ${task.resolverPluginId} 不支持刷新链接`,
          });
          return false;
        }
        try {
          // 构造解析上下文：用原始分享链接作为 matchedLinks
          const sessions = useResolverAuthStore.getState().sessions;
          const result = await plugin.refresh({
            payload: {
              type: 'link',
              links: [task.originalShareLink],
              torrentFiles: [],
              rename: task.name,
              splitCount: task.splitCount,
              maxConnectionsPerServer: task.requestedMaxConnectionsPerServer ?? 1,
              savePath: task.savePath,
              advanced: task.advanced,
            },
            matchedLinks: [task.originalShareLink],
            sessions,
          });
          if (!result.links?.length) {
            writeDeveloperLog({
              source: 'task-store',
              action: 'refresh_link_empty',
              level: 'warn',
              message: `任务 ${taskId} 刷新链接返回空`,
            });
            return false;
          }
          const newLink = result.links[0];
          // 调用 aria2.changeUri 替换链接（fileIndex=0，单文件任务）
          await aria2ChangeUri(taskId, 0, [task.url], [newLink]);
          // 更新本地 task.url 与 advanced（如果插件返回了新 patch）
          const updatedTasks = get().tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  url: newLink,
                  advanced: result.advancedPatch
                    ? { ...t.advanced, ...result.advancedPatch }
                    : t.advanced,
                }
              : t
          );
          set({ tasks: updatedTasks });
          writeDeveloperLog({
            source: 'task-store',
            action: 'refresh_link_success',
            level: 'info',
            message: `任务 ${taskId} 链接已刷新`,
          });
          return true;
        } catch (error) {
          const message = normalizeErrorMessage(error);
          writeDeveloperLog({
            source: 'task-store',
            action: 'refresh_link_failed',
            level: 'error',
            message,
          });
          return false;
        }
      },
      removeTask: async (taskId, options) => {
        try {
          await aria2RemoveTask(taskId, options);
          // 清理任务级缓存，避免 Map 累积垃圾
          lastReconnectAtByTaskId.delete(taskId);
          lowConnectionFingerprintByTaskId.delete(taskId);
          await get().refreshTasks();
        } catch (error) {
          console.error('删除任务失败', error);
        }
      },
      startAll: async () => {
        try {
          const basicSettings = useBasicSettingsStore.getState();
          const resumableTasks = get().tasks.filter((task) => task.status === 'paused' || task.status === 'failed');
          await Promise.all(
            resumableTasks.map((task) =>
              aria2StartTask(task.id, {
                splitCount: task.requestedSplitCount ?? basicSettings.defaultSplitCount,
                maxConnectionPerServer: task.requestedMaxConnectionsPerServer ?? basicSettings.maxConnectionsPerServer,
              })
            )
          );
          await get().refreshTasks();
        } catch (error) {
          const message = normalizeErrorMessage(error);
          writeDeveloperLog({
            source: 'task-store',
            action: 'start_all_tasks',
            level: 'error',
            message,
          });
          console.error('全部开始失败', error);
        }
      },
      pauseAll: async () => {
        try {
          await aria2PauseAll();
          await get().refreshTasks();
        } catch (error) {
          console.error('全部暂停失败', error);
        }
      },
      stopAll: async () => {
        try {
          await aria2StopAll();
          await get().refreshTasks();
        } catch (error) {
          console.error('全部停止失败', error);
        }
      },
      clearCompleted: async () => {
        try {
          await aria2ClearCompleted();
          await get().refreshTasks();
        } catch (error) {
          console.error('清理已完成任务失败', error);
        }
      },
      clearAllTasks: async () => {
        try {
          await aria2ClearAll();
          await get().refreshTasks();
        } catch (error) {
          console.error('清空任务失败', error);
        }
      },
    }),
    {
      name: 'tinyaii-tasks',
      storage: createJSONStorage(() => localStorage),
      partialize: ({
        tasks,
      }) => ({ tasks }),
    }
  )
);

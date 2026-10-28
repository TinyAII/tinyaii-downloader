import type { CreateTaskPayload, DownloadTask } from '../types/task';

export interface TaskRemoveDialogState {
  deleteDownloadedFiles: boolean;
}

export interface TaskRemoveRequest extends TaskRemoveDialogState {
  downloadedFilePaths: string[];
}

export interface TaskRetryTransferOptions {
  defaultSplitCount: number;
  defaultMaxConnectionsPerServer: number;
}

function uniquePaths(paths: string[]) {
  return Array.from(new Set(paths.map((item) => item.trim()).filter(Boolean)));
}

export function getTaskDisplayFileName(task: DownloadTask) {
  const filePath = task.files?.[0]?.path?.trim() || '';
  if (!filePath) return task.name;
  const parts = filePath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || task.name;
}

export function getTaskPrimaryFilePath(task: DownloadTask) {
  return task.files.map((file) => file.path?.trim()).find((item): item is string => Boolean(item)) ?? '';
}

export function getTaskOpenTarget(task: DownloadTask) {
  return getTaskPrimaryFilePath(task) || task.savePath.trim();
}

export function getTaskFolderTarget(task: DownloadTask) {
  return getTaskPrimaryFilePath(task) || task.savePath.trim();
}

export function getTaskFilePaths(task: DownloadTask) {
  return uniquePaths(task.files.map((file) => file.path ?? ''));
}

export function getTaskDownloadedFilePaths(task: DownloadTask) {
  if (task.status === 'completed' || task.status === 'seeding') {
    return getTaskFilePaths(task);
  }
  return uniquePaths(
    task.files
      .filter((file) => file.completedLength > 0)
      .map((file) => file.path ?? '')
  );
}

export function buildTaskRemoveRequest(task: DownloadTask, state: TaskRemoveDialogState): TaskRemoveRequest {
  return {
    ...state,
    downloadedFilePaths: state.deleteDownloadedFiles ? getTaskDownloadedFilePaths(task) : [],
  };
}

export function canRetryTask(task: DownloadTask) {
  const url = task.url.trim();
  return Boolean(url) && !url.startsWith('torrent://');
}

export function getRetryActionTitle(task: DownloadTask) {
  if (task.status === 'failed') return '恢复下载';
  if (task.status === 'completed') return '重新下载';
  return '开始下载';
}

export function buildRetryTaskPayload(
  task: DownloadTask,
  options: TaskRetryTransferOptions
): CreateTaskPayload | null {
  const url = task.url.trim();
  if (!canRetryTask(task)) {
    return null;
  }
  return {
    type: 'link',
    links: [url],
    rename: '',
    splitCount: task.requestedSplitCount ?? options.defaultSplitCount,
    maxConnectionsPerServer: task.requestedMaxConnectionsPerServer ?? options.defaultMaxConnectionsPerServer,
    savePath: task.savePath,
    advanced: {
      userAgent: task.advanced.userAgent,
      authorization: task.advanced.authorization,
      referer: task.advanced.referer,
      cookie: task.advanced.cookie,
      proxy: task.advanced.proxy,
    },
  };
}

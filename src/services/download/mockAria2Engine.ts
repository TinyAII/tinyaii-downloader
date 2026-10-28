import type { CreateTaskPayload, DownloadTask, TaskStatus } from '../../types/task';

const MIN_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MIN_SPEED_BYTES = 256 * 1024;
const MAX_SPEED_BYTES = 4 * 1024 * 1024;

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildTaskId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildTaskName(url: string, rename: string, index: number, totalCount: number) {
  if (rename.trim()) {
    return totalCount > 1 ? `${rename.trim()}-${index + 1}` : rename.trim();
  }

  try {
    const parsed = new URL(url);
    const fromPath = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    if (fromPath) return fromPath;
    return parsed.hostname || `任务-${index + 1}`;
  } catch {
    return `任务-${index + 1}`;
  }
}

function parsePositiveInteger(input: string | null) {
  if (!input) return null;
  const normalized = input.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function extractTotalBytesFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const queryKeys = ['xl', 'size', 'filesize', 'length', 'bytes', 'clen', 'content-length'];
    for (const key of queryKeys) {
      const value = parsePositiveInteger(parsed.searchParams.get(key));
      if (value) {
        return value;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function createTask(url: string, payload: CreateTaskPayload, index: number, totalCount: number): DownloadTask {
  const parsedTotalBytes = extractTotalBytesFromUrl(url);
  const totalBytes = parsedTotalBytes ?? randomBetween(MIN_TOTAL_BYTES, MAX_TOTAL_BYTES);
  return {
    id: buildTaskId(),
    sourceType: payload.type,
    url,
    name: buildTaskName(url, payload.rename, index, totalCount),
    status: 'downloading',
    splitCount: payload.splitCount,
    savePath: payload.savePath,
    totalBytes,
    displayTotalBytes: parsedTotalBytes,
    downloadedBytes: 0,
    speedBytes: 0,
    uploadSpeedBytes: 0,
    createdAt: Date.now(),
    completedAt: null,
    bitfield: '',
    pieceLength: 1048576,
    connections: 1,
    errorCode: '',
    errorMessage: '',
    files: [{
      index: 1,
      path: buildTaskName(url, payload.rename, index, totalCount),
      length: totalBytes,
      completedLength: 0,
      selected: true,
    }],
    advanced: payload.advanced,
  };
}

function withStatus(task: DownloadTask, status: TaskStatus): DownloadTask {
  if (task.status === 'completed') {
    return task;
  }
  return {
    ...task,
    status,
    speedBytes: status === 'downloading' ? task.speedBytes : 0,
    uploadSpeedBytes: status === 'seeding' ? task.uploadSpeedBytes : 0,
  };
}

export function createTasksFromPayload(payload: CreateTaskPayload): DownloadTask[] {
  const sourceLinks = payload.type === 'link' ? payload.links : ['torrent://local-file'];
  const links = sourceLinks.map((item) => item.trim()).filter(Boolean);
  return links.map((link, index) => createTask(link, payload, index, links.length));
}

export function startTask(task: DownloadTask): DownloadTask {
  const nextStatus = task.sourceType === 'torrent' && task.totalBytes > 0 && task.downloadedBytes >= task.totalBytes
    ? 'seeding'
    : 'downloading';
  return withStatus(task, nextStatus);
}

export function pauseTask(task: DownloadTask): DownloadTask {
  return withStatus(task, 'paused');
}

export function stopTask(task: DownloadTask): DownloadTask {
  return withStatus(task, 'stopped');
}

export function advanceDownloadingTasks(tasks: DownloadTask[]): DownloadTask[] {
  return tasks.map((task) => {
    if (task.status === 'seeding') {
      return {
        ...task,
        speedBytes: 0,
        uploadSpeedBytes: randomBetween(MIN_SPEED_BYTES / 4, MAX_SPEED_BYTES / 2),
      };
    }

    if (task.status !== 'downloading') {
      return task.status === 'completed' ? task : { ...task, speedBytes: 0, uploadSpeedBytes: 0 };
    }

    const speedBytes = randomBetween(MIN_SPEED_BYTES, MAX_SPEED_BYTES);
    const downloadedBytes = Math.min(task.downloadedBytes + speedBytes, task.totalBytes);
    const isCompleted = downloadedBytes >= task.totalBytes;

    if (isCompleted) {
      return {
        ...task,
        status: task.sourceType === 'torrent' ? 'seeding' : 'completed',
        downloadedBytes: task.totalBytes,
        displayTotalBytes: task.displayTotalBytes ?? task.totalBytes,
        speedBytes: 0,
        uploadSpeedBytes: task.sourceType === 'torrent' ? randomBetween(MIN_SPEED_BYTES / 4, MAX_SPEED_BYTES / 2) : 0,
        completedAt: task.sourceType === 'torrent' ? null : Date.now(),
      };
    }

    return {
      ...task,
      downloadedBytes,
      speedBytes,
      uploadSpeedBytes: 0,
    };
  });
}

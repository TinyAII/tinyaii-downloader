import type { StartupResumeMode } from '../store/settings/types';
import type { DownloadTask } from '../types/task';

const DEFAULT_RESUME_BATCH_SIZE = 6;
const MIN_RESUME_BATCH_SIZE = 1;
const MAX_RESUME_BATCH_SIZE = 24;

const resumableStatusByMode: Record<StartupResumeMode, DownloadTask['status'][]> = {
  all: ['paused', 'stopped', 'failed'],
  paused: ['paused'],
  failed: ['failed'],
};

export function pickTasksForStartupResume(tasks: DownloadTask[], mode: StartupResumeMode) {
  const allowedStatus = new Set(resumableStatusByMode[mode]);
  return tasks.filter((task) => allowedStatus.has(task.status));
}

export function normalizeResumeBatchSize(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_RESUME_BATCH_SIZE;
  const integerValue = Math.trunc(value);
  return Math.min(Math.max(integerValue, MIN_RESUME_BATCH_SIZE), MAX_RESUME_BATCH_SIZE);
}

export function splitTasksIntoBatches(tasks: DownloadTask[], batchSize: number) {
  const normalizedBatchSize = normalizeResumeBatchSize(batchSize);
  const batches: DownloadTask[][] = [];
  for (let index = 0; index < tasks.length; index += normalizedBatchSize) {
    batches.push(tasks.slice(index, index + normalizedBatchSize));
  }
  return batches;
}

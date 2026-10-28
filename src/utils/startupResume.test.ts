import { describe, expect, it } from 'vitest';
import type { DownloadTask } from '../types/task';
import {
  normalizeResumeBatchSize,
  pickTasksForStartupResume,
  splitTasksIntoBatches,
} from './startupResume';

const makeTask = (id: string, status: DownloadTask['status']): DownloadTask => ({
  id,
  sourceType: 'link',
  url: `https://example.com/${id}`,
  name: id,
  status,
  splitCount: 8,
  savePath: 'C:/downloads',
  totalBytes: 1024,
  downloadedBytes: 256,
  speedBytes: 0,
  uploadSpeedBytes: 0,
  createdAt: 1,
  completedAt: null,
  bitfield: '',
  pieceLength: 1024,
  connections: 1,
  files: [],
  advanced: {
    userAgent: '',
    authorization: '',
    referer: '',
    cookie: '',
    proxy: '',
  },
});

describe('startup resume selection', () => {
  const tasks: DownloadTask[] = [
    makeTask('downloading-task', 'downloading'),
    makeTask('paused-task', 'paused'),
    makeTask('stopped-task', 'stopped'),
    makeTask('failed-task', 'failed'),
    makeTask('completed-task', 'completed'),
  ];

  it('selects paused, stopped and failed in all mode', () => {
    expect(pickTasksForStartupResume(tasks, 'all').map((item) => item.id)).toEqual([
      'paused-task',
      'stopped-task',
      'failed-task',
    ]);
  });

  it('selects paused only in paused mode', () => {
    expect(pickTasksForStartupResume(tasks, 'paused').map((item) => item.id)).toEqual([
      'paused-task',
    ]);
  });

  it('selects failed only in failed mode', () => {
    expect(pickTasksForStartupResume(tasks, 'failed').map((item) => item.id)).toEqual([
      'failed-task',
    ]);
  });

  it('normalizes batch size from max concurrent setting', () => {
    expect(normalizeResumeBatchSize(0)).toBe(1);
    expect(normalizeResumeBatchSize(7.9)).toBe(7);
    expect(normalizeResumeBatchSize(999)).toBe(24);
    expect(normalizeResumeBatchSize(Number.NaN)).toBe(6);
  });

  it('splits selected tasks into concurrent batches', () => {
    const selected = pickTasksForStartupResume(tasks, 'all');
    const batches = splitTasksIntoBatches(selected, 2);
    expect(batches.map((batch) => batch.map((item) => item.id))).toEqual([
      ['paused-task', 'stopped-task'],
      ['failed-task'],
    ]);
  });
});

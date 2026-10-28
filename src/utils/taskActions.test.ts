import { describe, expect, it } from 'vitest';
import type { DownloadTask } from '../types/task';
import {
  buildRetryTaskPayload,
  buildTaskRemoveRequest,
  canRetryTask,
  getRetryActionTitle,
  getTaskDisplayFileName,
  getTaskDownloadedFilePaths,
} from './taskActions';

function createTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: 'task-1',
    sourceType: 'link',
    url: 'https://example.com/archive.zip',
    name: 'archive.zip',
    status: 'completed',
    splitCount: 16,
    savePath: 'C:/downloads',
    totalBytes: 200,
    displayTotalBytes: 200,
    downloadedBytes: 200,
    speedBytes: 0,
    uploadSpeedBytes: 0,
    createdAt: 1,
    completedAt: 2,
    bitfield: '',
    pieceLength: 0,
    connections: 1,
    requestedMaxConnectionsPerServer: 8,
    requestedSplitCount: 12,
    errorCode: '',
    errorMessage: '',
    files: [
      {
        index: 1,
        path: 'C:/downloads/archive.zip',
        length: 200,
        completedLength: 200,
        selected: true,
      },
    ],
    advanced: {
      userAgent: 'UA',
      authorization: 'Bearer demo',
      referer: 'https://example.com',
      cookie: 'a=1',
      proxy: '',
    },
    ...overrides,
  };
}

describe('task action helpers', () => {
  it('builds remove request with downloaded file scope', () => {
    const task = createTask({
      status: 'failed',
      files: [
        {
          index: 1,
          path: 'C:/downloads/archive.zip',
          length: 200,
          completedLength: 50,
          selected: true,
        },
        {
          index: 2,
          path: 'C:/downloads/empty.txt',
          length: 20,
          completedLength: 0,
          selected: true,
        },
      ],
    });
    expect(buildTaskRemoveRequest(task, { deleteDownloadedFiles: true })).toEqual({
      deleteDownloadedFiles: true,
      downloadedFilePaths: ['C:/downloads/archive.zip'],
    });
  });

  it('treats completed files as downloaded files', () => {
    const task = createTask();
    expect(getTaskDownloadedFilePaths(task)).toEqual(['C:/downloads/archive.zip']);
  });

  it('treats seeding files as downloaded files', () => {
    const task = createTask({ sourceType: 'torrent', status: 'seeding', completedAt: null });
    expect(getTaskDownloadedFilePaths(task)).toEqual(['C:/downloads/archive.zip']);
  });

  it('creates retry payload from existing task settings', () => {
    const task = createTask({ status: 'completed' });
    expect(buildRetryTaskPayload(task, { defaultSplitCount: 16, defaultMaxConnectionsPerServer: 16 })).toEqual({
      type: 'link',
      links: ['https://example.com/archive.zip'],
      rename: '',
      splitCount: 12,
      maxConnectionsPerServer: 8,
      savePath: 'C:/downloads',
      advanced: {
        userAgent: 'UA',
        authorization: 'Bearer demo',
        referer: 'https://example.com',
        cookie: 'a=1',
        proxy: '',
      },
    });
  });

  it('rejects retry for local torrent placeholder links', () => {
    const task = createTask({
      sourceType: 'torrent',
      url: 'torrent://local-file',
    });
    expect(canRetryTask(task)).toBe(false);
    expect(buildRetryTaskPayload(task, { defaultSplitCount: 16, defaultMaxConnectionsPerServer: 16 })).toBeNull();
  });

  it('derives display labels from task status', () => {
    expect(getRetryActionTitle(createTask({ status: 'failed' }))).toBe('恢复下载');
    expect(getRetryActionTitle(createTask({ status: 'completed' }))).toBe('重新下载');
    expect(getTaskDisplayFileName(createTask())).toBe('archive.zip');
  });
});

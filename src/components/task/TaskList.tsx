import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, Trash2, FolderOpen, Copy, FileText, RotateCcw, ExternalLink, Zap } from 'lucide-react';
import { revealItemInDir, openPath } from '@tauri-apps/plugin-opener';
import type { DownloadTask } from '../../types/task';
import { formatBytes, formatSpeed, formatTime } from '../../utils/format';
import TaskRemoveDialog from './TaskRemoveDialog';
import {
  buildTaskRemoveRequest,
  canRetryTask,
  getRetryActionTitle,
  getTaskFolderTarget,
  getTaskOpenTarget,
  type TaskRemoveDialogState,
  type TaskRemoveRequest,
} from '../../utils/taskActions';

interface TaskListProps {
  mode: 'downloading' | 'completed';
  tasks: DownloadTask[];
  onStart: (taskId: string) => void;
  onPause: (taskId: string) => void;
  onStop: (taskId: string) => void;
  onRemove: (task: DownloadTask, options: TaskRemoveRequest) => void | Promise<void>;
  onRetry?: (task: DownloadTask) => void | Promise<void>;
  // 软重启：pause → start，保留进度，重新建立连接（不改变用户设置的连接数）
  onReconnect?: (taskId: string) => void | Promise<void>;
  showProgress?: boolean;
  onTaskClick?: (task: DownloadTask) => void;
}

interface ContextMenuState {
  taskId: string;
  x: number;
  y: number;
}

function isSeedingTask(task: DownloadTask) {
  return task.status === 'seeding';
}

function statusText(task: DownloadTask) {
  if (isSeedingTask(task)) return '做种中';
  if (task.status === 'completed') return '已完成';
  if (task.status === 'paused') return '已暂停';
  if (task.status === 'stopped') return '已停止';
  if (task.status === 'failed') return '失败';
  return '下载中';
}

function statusBadgeClass(task: DownloadTask) {
  if (isSeedingTask(task)) {
    return 'bg-emerald-50 text-emerald-600';
  }
  if (task.status === 'failed') {
    return 'bg-red-50 text-red-500';
  }
  return 'bg-black/5 text-text-main';
}

export default function TaskList({
  mode,
  tasks,
  onStart,
  onPause,
  onStop,
  onRemove,
  onRetry,
  onReconnect,
  showProgress = true,
  onTaskClick,
}: TaskListProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [removeDialogTask, setRemoveDialogTask] = useState<DownloadTask | null>(null);
  const [removeDialogState, setRemoveDialogState] = useState<TaskRemoveDialogState>({
    deleteDownloadedFiles: false,
  });
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === contextMenu?.taskId) ?? null,
    [contextMenu?.taskId, tasks]
  );

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };

    window.addEventListener('click', closeMenu);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [contextMenu]);

  const menuX = contextMenu ? Math.min(contextMenu.x, window.innerWidth - 176) : 0;
  const menuY = contextMenu ? Math.min(contextMenu.y, window.innerHeight - 172) : 0;
  const startDisabled =
    !selectedTask ||
    selectedTask.status === 'downloading' ||
    selectedTask.status === 'seeding' ||
    selectedTask.status === 'completed' ||
    selectedTask.status === 'stopped';
  const pauseDisabled =
    !selectedTask ||
    selectedTask.status === 'paused' ||
    selectedTask.status === 'stopped' ||
    selectedTask.status === 'completed';
  const stopDisabled = !selectedTask || selectedTask.status === 'stopped' || selectedTask.status === 'completed';
  const selectedTaskIsSeeding = selectedTask ? isSeedingTask(selectedTask) : false;

  const openRemoveDialog = (task: DownloadTask) => {
    setRemoveDialogTask(task);
    setRemoveDialogState({
      deleteDownloadedFiles: false,
    });
  };

  const closeRemoveDialog = () => {
    setRemoveDialogTask(null);
    setRemoveDialogState({
      deleteDownloadedFiles: false,
    });
  };

  const confirmRemoveTask = () => {
    if (!removeDialogTask) return;
    void onRemove(removeDialogTask, buildTaskRemoveRequest(removeDialogTask, removeDialogState));
    closeRemoveDialog();
  };

  const handleTaskClick = (task: DownloadTask) => {
    onTaskClick?.(task);
  };

  const handleOpenFile = async (task: DownloadTask) => {
    const target = getTaskOpenTarget(task);
    if (!target) return;
    try {
      await openPath(target);
    } catch (err) {
      console.error('Failed to open task file', err);
    }
  };

  const handleOpenFolder = async (task: DownloadTask) => {
    const target = getTaskFolderTarget(task);
    if (!target) return;
    try {
      if (target === task.savePath.trim()) {
        await openPath(target);
        return;
      }
      await revealItemInDir(target);
    } catch (err) {
      console.error('Failed to open folder', err);
    }
  };

  const handleCopyLink = async (task: DownloadTask) => {
    try {
      await navigator.clipboard.writeText(task.url);
    } catch (err) {
      console.error('Failed to copy task url', err);
    }
  };

  const handleRetryTask = (task: DownloadTask) => {
    if (!canRetryTask(task)) return;
    void onRetry?.(task);
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="px-8 py-4 space-y-3">
        {tasks.map((task) => {
          const progress = Math.min(
            100,
            task.totalBytes > 0 ? (task.downloadedBytes / task.totalBytes) * 100 : 0
          );
          const displayTotalText =
            typeof task.displayTotalBytes === 'number' && task.displayTotalBytes > 0
              ? formatBytes(task.displayTotalBytes)
              : '未知';

          return (
            <div
              key={task.id}
              onClick={() => handleTaskClick(task)}
              className="group relative rounded-xl border border-black/5 bg-white shadow-sm hover:shadow-md transition-all px-5 py-4 cursor-pointer overflow-hidden"
              onContextMenu={
                mode === 'downloading'
                  ? (event) => {
                      event.preventDefault();
                      setContextMenu({
                        taskId: task.id,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }
                  : undefined
              }
            >
              <div className="flex items-center justify-between gap-4 relative z-10">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] text-text-main font-medium truncate">{task.name}</p>
                  <p className="text-[12px] text-text-muted truncate mt-1">{task.url}</p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {mode === 'downloading' ? (
                    <>
                      {task.status === 'paused' || task.status === 'stopped' || task.status === 'failed' ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); onStart(task.id); }}
                          className="w-8 h-8 rounded-full bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center transition-colors cursor-pointer"
                          title={getRetryActionTitle(task)}
                        >
                          <Play size={15} className="ml-0.5" />
                        </button>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); onPause(task.id); }}
                          className="w-8 h-8 rounded-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 flex items-center justify-center transition-colors cursor-pointer"
                          title={isSeedingTask(task) ? '暂停做种' : '暂停'}
                        >
                          <Pause size={15} />
                        </button>
                      )}
                      {task.status === 'downloading' && onReconnect && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void onReconnect(task.id); }}
                          className="w-8 h-8 rounded-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 flex items-center justify-center transition-colors cursor-pointer"
                          title="重连（保留进度，重新建立连接，应对速度衰减）"
                        >
                          <Zap size={15} />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); openRemoveDialog(task); }}
                        className="w-8 h-8 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-500 flex items-center justify-center transition-colors cursor-pointer"
                        title="删除任务"
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleOpenFile(task); }}
                        className="w-8 h-8 rounded-full bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center transition-colors cursor-pointer"
                        title="打开文件"
                      >
                        <ExternalLink size={15} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRetryTask(task); }}
                        disabled={!canRetryTask(task)}
                        className="w-8 h-8 rounded-full bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center transition-colors cursor-pointer disabled:bg-black/5 disabled:text-text-muted/50 disabled:hover:bg-black/5 disabled:cursor-not-allowed"
                        title={canRetryTask(task) ? '重新下载' : '本地种子任务暂不支持重新下载'}
                      >
                        <RotateCcw size={15} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); openRemoveDialog(task); }}
                        className="w-8 h-8 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-500 flex items-center justify-center transition-colors cursor-pointer"
                        title="移除任务"
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}

                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await handleCopyLink(task);
                    }}
                    className="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 text-text-main flex items-center justify-center transition-colors cursor-pointer"
                    title="复制链接"
                  >
                    <Copy size={15} />
                  </button>

                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await handleOpenFolder(task);
                    }}
                    className="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 text-text-main flex items-center justify-center transition-colors cursor-pointer"
                    title="打开所在文件夹"
                  >
                    <FolderOpen size={15} />
                  </button>

                  <button
                    onClick={(e) => { e.stopPropagation(); onTaskClick?.(task); }}
                    className="w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 text-text-main flex items-center justify-center transition-colors cursor-pointer"
                    title="任务详情"
                  >
                    <FileText size={15} />
                  </button>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between text-[12px] text-text-muted relative z-10">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded-md font-medium ${statusBadgeClass(task)}`}>
                    {statusText(task)}
                  </span>
                  <span>{formatBytes(task.downloadedBytes)} / {displayTotalText}</span>
                </div>
                {mode === 'downloading' && (task.status === 'downloading' || task.status === 'seeding') ? (
                  <span className={`font-medium ${task.status === 'seeding' ? 'text-emerald-600' : 'text-primary'}`}>
                    {task.status === 'seeding' ? `↑ ${formatSpeed(task.uploadSpeedBytes)}` : formatSpeed(task.speedBytes)}
                  </span>
                ) : mode !== 'downloading' ? (
                  <span>{formatTime(task.completedAt)}</span>
                ) : null}
              </div>

              {showProgress && (
                <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/5">
                  <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {mode === 'downloading' && contextMenu && selectedTask && (
        <div
          className="fixed z-50 min-w-40 rounded-lg border border-black/10 bg-white shadow-lg p-1"
          style={{ left: `${menuX}px`, top: `${menuY}px` }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            disabled={startDisabled}
            onClick={() => {
              onStart(selectedTask.id);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-[13px] rounded-md text-text-main hover:bg-black/5 disabled:text-text-muted/50 disabled:hover:bg-transparent transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            开始
          </button>
          <button
            disabled={pauseDisabled}
            onClick={() => {
              onPause(selectedTask.id);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-[13px] rounded-md text-text-main hover:bg-black/5 disabled:text-text-muted/50 disabled:hover:bg-transparent transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {selectedTaskIsSeeding ? '暂停做种' : '暂停'}
          </button>
          <button
            disabled={stopDisabled}
            onClick={() => {
              onStop(selectedTask.id);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-[13px] rounded-md text-text-main hover:bg-black/5 disabled:text-text-muted/50 disabled:hover:bg-transparent transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            停止
          </button>
          <div className="h-px bg-black/10 my-1" />
          <button
            onClick={() => {
              openRemoveDialog(selectedTask);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 text-[13px] rounded-md text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
          >
            删除任务
          </button>
        </div>
      )}
      {removeDialogTask && (
        <TaskRemoveDialog
          task={removeDialogTask}
          state={removeDialogState}
          onChange={setRemoveDialogState}
          onClose={closeRemoveDialog}
          onConfirm={confirmRemoveTask}
        />
      )}
    </div>
  );
}

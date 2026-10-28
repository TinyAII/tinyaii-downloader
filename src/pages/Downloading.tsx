import { useMemo, useState } from 'react';
import { Plus, RotateCw, Play, Pause, Square, X, Gauge } from 'lucide-react';
import EmptyState from '../components/common/EmptyState';
import TaskList from '../components/task/TaskList';
import TaskDetailsModal from '../components/task/TaskDetailsModal';
import { Select } from '../components/ui/Select';
import { useTaskStore } from '../store/tasks';
import { useBasicSettingsStore } from '../store/settings/basicStore';
import type { DownloadTask } from '../types/task';
import { formatSpeed } from '../utils/format';
import type { TaskRemoveRequest } from '../utils/taskActions';

interface DownloadingProps {
  onNewTask?: () => void;
}

type DownloadingFilter = 'all' | 'downloading' | 'seeding' | 'paused' | 'failed' | 'stopped';

export default function Downloading({ onNewTask }: DownloadingProps) {
  const [selectedTask, setSelectedTask] = useState<DownloadTask | null>(null);
  const [statusFilter, setStatusFilter] = useState<DownloadingFilter>('all');
  const tasks = useTaskStore((state) => state.tasks);
  const refreshTasks = useTaskStore((state) => state.refreshTasks);
  const startAll = useTaskStore((state) => state.startAll);
  const pauseAll = useTaskStore((state) => state.pauseAll);
  const stopAll = useTaskStore((state) => state.stopAll);
  const clearCompleted = useTaskStore((state) => state.clearCompleted);
  const startTask = useTaskStore((state) => state.startTask);
  const pauseTask = useTaskStore((state) => state.pauseTask);
  const stopTask = useTaskStore((state) => state.stopTask);
  const removeTask = useTaskStore((state) => state.removeTask);
  const reconnectTask = useTaskStore((state) => state.reconnectTask);
  const showProgress = useBasicSettingsStore((state) => state.showProgress);
  const progressBarScope = useBasicSettingsStore((state) => state.progressBarScope);
  const handleRemoveTask = async (task: DownloadTask, options: TaskRemoveRequest) => {
    await removeTask(task.id, options);
    if (selectedTask?.id === task.id) {
      setSelectedTask(null);
    }
  };

  const downloadingTasks = useMemo(() => {
    const activeTasks = tasks.filter((task) => task.status !== 'completed');
    if (statusFilter === 'all') return activeTasks;
    return activeTasks.filter((task) => task.status === statusFilter);
  }, [statusFilter, tasks]);
  const shouldShowProgress = showProgress && (progressBarScope === 'all' || progressBarScope === 'downloading');
  const aggregatedTransferSpeed = downloadingTasks.reduce((acc, task) => {
    if (task.status === 'seeding') {
      return acc + (task.uploadSpeedBytes || 0);
    }
    return acc + (task.speedBytes || 0);
  }, 0);

  return (
    <div className="flex-1 flex flex-col h-full bg-main relative">
      <div className="flex items-center justify-between px-8 py-4 border-b border-black/5">
        <h1 className="text-xl font-medium text-text-main">下载中</h1>
        
        <div className="flex items-center gap-3">
          <Select
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as DownloadingFilter)}
            options={[
              { label: '全部任务', value: 'all' },
              { label: '下载中', value: 'downloading' },
              { label: '做种中', value: 'seeding' },
              { label: '已暂停', value: 'paused' },
              { label: '失败', value: 'failed' },
              { label: '已停止', value: 'stopped' },
            ]}
            className="w-32"
          />
          <button
            onClick={onNewTask}
            title="新建任务"
            className="w-6 h-6 flex items-center justify-center bg-primary hover:bg-primary-hover text-white rounded-full transition-colors cursor-pointer"
          >
            <Plus size={16} strokeWidth={2.5} />
          </button>
          
          <div className="h-4 w-[1px] bg-black/10 mx-1"></div>
          
          <button
            className="text-text-muted hover:text-text-main transition-colors cursor-pointer"
            title="刷新"
            onClick={refreshTasks}
          >
            <RotateCw size={16} strokeWidth={2} />
          </button>
          <button
            className="text-text-muted hover:text-text-main transition-colors cursor-pointer"
            title="全部开始"
            onClick={startAll}
          >
            <Play size={16} strokeWidth={2} />
          </button>
          <button
            className="text-text-muted hover:text-text-main transition-colors cursor-pointer"
            title="全部暂停"
            onClick={pauseAll}
          >
            <Pause size={16} strokeWidth={2} />
          </button>
          <button
            className="text-text-muted hover:text-text-main transition-colors cursor-pointer"
            title="全部停止"
            onClick={stopAll}
          >
            <Square size={14} strokeWidth={2} />
          </button>
          <button
            className="text-text-muted hover:text-text-main transition-colors cursor-pointer"
            title="清空已完成"
            onClick={clearCompleted}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
          <EmptyState
            showText={downloadingTasks.length === 0}
            title="Tiny Aii"
            subtitle="静待下载浪潮涌来"
          />
        </div>
        <div className="z-10 h-full overflow-hidden flex flex-col">
          {downloadingTasks.length > 0 && (
            <TaskList
              mode="downloading"
              tasks={downloadingTasks}
              onStart={startTask}
              onPause={pauseTask}
              onStop={stopTask}
              onRemove={handleRemoveTask}
              onReconnect={(taskId) => void reconnectTask(taskId)}
              showProgress={shouldShowProgress}
              onTaskClick={setSelectedTask}
            />
          )}
        </div>
      </div>

      <div className="absolute bottom-6 right-6">
        <div className="flex items-center gap-2 bg-white/90 backdrop-blur-md px-4 py-2 rounded-full border border-black/5 shadow-sm">
          <Gauge size={16} className="text-primary" />
          <span className="text-[13px] font-medium text-text-main min-w-[60px]">
            {formatSpeed(aggregatedTransferSpeed)}
          </span>
        </div>
      </div>

      {selectedTask && (
        <TaskDetailsModal 
          taskId={selectedTask.id} 
          onClose={() => setSelectedTask(null)} 
        />
      )}
    </div>
  );
}

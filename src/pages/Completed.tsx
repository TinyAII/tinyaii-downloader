import { useState } from 'react';
import { Plus, RotateCw, Trash2 } from 'lucide-react';
import EmptyState from '../components/common/EmptyState';
import TaskList from '../components/task/TaskList';
import TaskDetailsModal from '../components/task/TaskDetailsModal';
import { useTaskStore } from '../store/tasks';
import { useBasicSettingsStore } from '../store/settings/basicStore';
import type { DownloadTask } from '../types/task';
import type { TaskRemoveRequest } from '../utils/taskActions';

interface CompletedProps {
  onNewTask?: () => void;
}

export default function Completed({ onNewTask }: CompletedProps) {
  const [selectedTask, setSelectedTask] = useState<DownloadTask | null>(null);
  const tasks = useTaskStore((state) => state.tasks);
  const refreshTasks = useTaskStore((state) => state.refreshTasks);
  const clearCompleted = useTaskStore((state) => state.clearCompleted);
  const removeTask = useTaskStore((state) => state.removeTask);
  const retryTask = useTaskStore((state) => state.retryTask);
  const showProgress = useBasicSettingsStore((state) => state.showProgress);
  const progressBarScope = useBasicSettingsStore((state) => state.progressBarScope);
  const completedTasks = tasks.filter((task) => task.status === 'completed');
  const shouldShowProgress = showProgress && progressBarScope === 'all';
  const handleRemoveTask = async (task: DownloadTask, options: TaskRemoveRequest) => {
    await removeTask(task.id, options);
    if (selectedTask?.id === task.id) {
      setSelectedTask(null);
    }
  };

  const handleRetryTask = async (task: DownloadTask) => {
    await retryTask(task.id);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-main relative">
      <div className="flex items-center justify-between px-8 py-4 border-b border-black/5">
        <h1 className="text-xl font-medium text-text-main">已完成</h1>
        
        <div className="flex items-center gap-3">
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
            title="清空所有记录"
            onClick={clearCompleted}
          >
            <Trash2 size={16} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
          <EmptyState
            showText={completedTasks.length === 0}
            title="Tiny Aii"
            subtitle="等待下一次满载而归"
          />
        </div>
        <div className="z-10 h-full overflow-hidden flex flex-col">
          {completedTasks.length > 0 && (
            <TaskList
              mode="completed"
              tasks={completedTasks}
              onStart={() => {}}
              onPause={() => {}}
              onStop={() => {}}
              onRemove={handleRemoveTask}
              onRetry={handleRetryTask}
              showProgress={shouldShowProgress}
              onTaskClick={setSelectedTask}
            />
          )}
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

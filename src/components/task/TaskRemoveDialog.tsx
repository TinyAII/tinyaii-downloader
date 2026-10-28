import type { DownloadTask } from '../../types/task';
import { getTaskDisplayFileName, type TaskRemoveDialogState } from '../../utils/taskActions';

interface TaskRemoveDialogProps {
  task: DownloadTask | null;
  state: TaskRemoveDialogState;
  onChange: (state: TaskRemoveDialogState) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export default function TaskRemoveDialog({
  task,
  state,
  onChange,
  onClose,
  onConfirm,
}: TaskRemoveDialogProps) {
  if (!task) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-[480px] rounded-xl border border-black/10 bg-white shadow-xl px-7 py-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="text-[20px] leading-none text-[#f5a524]">!</div>
        <h3 className="mt-2 text-[18px] leading-tight text-text-main font-medium">移除任务</h3>
        <p className="mt-3 text-[14px] leading-6 text-text-main break-all">{getTaskDisplayFileName(task)}</p>
        <div className="mt-5 space-y-3">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={state.deleteDownloadedFiles}
              onChange={(event) => onChange({ ...state, deleteDownloadedFiles: event.target.checked })}
              className="w-5 h-5 rounded border border-black/20 accent-[#f5a524]"
            />
            <span className="text-[14px] leading-none text-text-main">删除已下载的文件</span>
          </label>
        </div>
        <div className="mt-8 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="min-w-20 px-4 py-1.5 rounded-md border border-black/20 text-text-main bg-white hover:bg-black/5 transition-colors cursor-pointer"
          >
            否
          </button>
          <button
            onClick={onConfirm}
            className="min-w-20 px-4 py-1.5 rounded-md bg-[#f5a524] text-white hover:bg-[#e19a1f] transition-colors cursor-pointer"
          >
            是
          </button>
        </div>
      </div>
    </div>
  );
}

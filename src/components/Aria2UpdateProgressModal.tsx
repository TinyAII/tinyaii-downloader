import { createPortal } from 'react-dom';
import { CheckCircle2, RefreshCw, TriangleAlert, X } from 'lucide-react';

export type Aria2UpdateProgressStatus = 'running' | 'success' | 'error';

interface Aria2UpdateProgressModalProps {
  isOpen: boolean;
  status: Aria2UpdateProgressStatus;
  title: string;
  detail: string;
  onClose: () => void;
}

const statusStyleMap: Record<Aria2UpdateProgressStatus, { icon: typeof RefreshCw; iconClass: string; badgeClass: string; badgeText: string }> = {
  running: {
    icon: RefreshCw,
    iconClass: 'text-[#e5a038] animate-spin',
    badgeClass: 'bg-[#fff6e3] text-[#c98217] border border-[#f4d18d]',
    badgeText: '进行中',
  },
  success: {
    icon: CheckCircle2,
    iconClass: 'text-emerald-500',
    badgeClass: 'bg-emerald-50 text-emerald-600 border border-emerald-200',
    badgeText: '已完成',
  },
  error: {
    icon: TriangleAlert,
    iconClass: 'text-red-500',
    badgeClass: 'bg-red-50 text-red-500 border border-red-200',
    badgeText: '需处理',
  },
};

export default function Aria2UpdateProgressModal({
  isOpen,
  status,
  title,
  detail,
  onClose,
}: Aria2UpdateProgressModalProps) {
  if (!isOpen) return null;

  const statusStyle = statusStyleMap[status];
  const StatusIcon = statusStyle.icon;

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[30rem] max-w-[92vw] rounded-xl border border-black/10 bg-main shadow-2xl overflow-hidden">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-md border border-black/10 hover:bg-black/5 text-text-muted hover:text-text-main transition-colors cursor-pointer z-10"
        >
          <X size={16} />
        </button>
        <div className="px-6 py-5 border-b border-black/5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#fff7e8] border border-[#f3d398] flex items-center justify-center shadow-sm">
              <StatusIcon size={20} className={statusStyle.iconClass} />
            </div>
            <div className="min-w-0 flex-1 pr-8">
              <div className="text-[18px] font-semibold text-text-main">更新 aria2 引擎</div>
              <div className="mt-1 text-[12px] text-text-muted">下载、替换并重启本地引擎，完成后自动关闭</div>
            </div>
          </div>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="inline-flex items-center rounded-full px-3 py-1 text-[12px] font-medium tracking-wide shadow-sm bg-white">
            <span className={statusStyle.badgeClass + ' rounded-full px-2.5 py-1'}>{statusStyle.badgeText}</span>
          </div>
          <div className="rounded-xl border border-black/10 bg-white px-4 py-4 shadow-sm">
            <div className="text-[15px] font-medium text-text-main">{title}</div>
            <div className="mt-2 text-[13px] leading-6 text-text-muted whitespace-pre-wrap break-words">{detail}</div>
            {status === 'running' ? (
              <div className="mt-4 h-2 rounded-full bg-[#fff3dc] overflow-hidden">
                <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-[#f6c25b] via-[#e5a038] to-[#f7d98b] animate-[gold-wave-flow_1.6s_linear_infinite]" />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

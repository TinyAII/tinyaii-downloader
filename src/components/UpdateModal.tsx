import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, X } from 'lucide-react';
import type { VersionCheckResult } from '../services/app/backendApi';

interface UpdateModalProps {
  isOpen: boolean;
  updateInfo: VersionCheckResult | null;
  onClose: () => void;
}

function sanitizeHtml(input: string) {
  if (!input || typeof window === 'undefined') return '';
  const template = document.createElement('template');
  template.innerHTML = input;
  const blockedTags = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'style'];
  blockedTags.forEach((tag) => {
    template.content.querySelectorAll(tag).forEach((node) => node.remove());
  });
  const allElements = template.content.querySelectorAll('*');
  allElements.forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        return;
      }
      if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
        element.removeAttribute(attribute.name);
      }
    });
    if (element.tagName.toLowerCase() === 'a') {
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return template.innerHTML;
}

export default function UpdateModal({ isOpen, updateInfo, onClose }: UpdateModalProps) {
  const releaseNotesHtml = useMemo(() => sanitizeHtml(updateInfo?.releaseNotes ?? ''), [updateInfo?.releaseNotes]);

  if (!isOpen || !updateInfo) return null;

  const handleOpenDownload = async () => {
    if (!updateInfo.downloadUrl) return;
    try {
      await openUrl(updateInfo.downloadUrl);
    } catch (_error) {
      window.open(updateInfo.downloadUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={() => (updateInfo.forceUpdate ? null : onClose())} />
      <div className="relative w-[42rem] max-w-[92vw] max-h-[85vh] rounded-xl border border-black/10 bg-main shadow-2xl overflow-hidden flex flex-col">
        {!updateInfo.forceUpdate ? (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-md border border-black/10 hover:bg-black/5 text-text-muted hover:text-text-main transition-colors cursor-pointer z-10"
          >
            <X size={16} />
          </button>
        ) : null}
        <div className="px-6 py-4 border-b border-black/5">
          <h3 className="text-[18px] font-semibold text-text-main">发现新版本 v{updateInfo.latestVersion}</h3>
          <div className="text-[12px] text-text-muted mt-1">
            当前版本 v{updateInfo.currentVersion}
            {updateInfo.forceUpdate ? ' · 此版本为强制更新' : ''}
          </div>
        </div>
        <div className="px-6 py-4 overflow-y-auto custom-scrollbar space-y-3">
          <div className="text-[13px] text-text-main/90">更新说明</div>
          {releaseNotesHtml ? (
            <div
              className="text-[13px] leading-6 text-text-main/90 bg-white border border-black/10 rounded-lg px-4 py-3"
              dangerouslySetInnerHTML={{ __html: releaseNotesHtml }}
            />
          ) : (
            <div className="text-[13px] text-text-muted bg-white border border-black/10 rounded-lg px-4 py-3">
              本次版本包含稳定性优化与体验改进。
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-black/5 flex items-center justify-end gap-3">
          {!updateInfo.forceUpdate ? (
            <button
              onClick={onClose}
              className="h-9 px-4 rounded-md border border-black/10 bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer"
            >
              稍后再说
            </button>
          ) : null}
          <button
            onClick={() => void handleOpenDownload()}
            className="h-9 px-4 rounded-md border border-[#e5a038] bg-[#e5a038] hover:bg-[#d49028] text-white text-[13px] transition-colors cursor-pointer inline-flex items-center gap-1.5"
          >
            <ExternalLink size={14} />
            立即更新
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

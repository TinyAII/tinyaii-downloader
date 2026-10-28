import { X, FolderOpen, UploadCloud, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { cn } from '../../utils/cn';
import { writeDeveloperLog } from '../../store/developerLogStore';
import { useBasicSettingsStore } from '../../store/settings/basicStore';
import { useAdvancedSettingsStore } from '../../store/settings/advancedStore';
import { appGetInstallDir, aria2GetTaskOptionConstraints } from '../../services/download/aria2RpcEngine';
import { formatBytes } from '../../utils/format';
import { getTorrentContentSizeFromBytes } from '../../utils/torrentMeta';
import {
  mapTaskCreationError,
  normalizeMaxConnectionsPerServer,
  normalizeUserAgentInput,
  resolveUserAgentForLinks,
  normalizeSplitCount,
  USER_AGENT_MAX_LENGTH,
  validateAndNormalizeTaskPayload,
} from '../../utils/taskValidation';
import type { CreateTaskPayload, TorrentFilePayload } from '../../types/task';

interface NewTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateTasks: (payload: CreateTaskPayload) => Promise<number>;
}

type TabType = 'link' | 'torrent';

function isTorrentFile(file: File) {
  const fileName = file.name.toLowerCase();
  return fileName.endsWith('.torrent') || file.type === 'application/x-bittorrent';
}

async function readFileAsTorrentPayload(file: File): Promise<TorrentFilePayload> {
  const [base64, rawBytes] = await Promise.all([
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`读取种子文件失败：${file.name}`));
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const payload = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result;
        if (!payload.trim()) {
          reject(new Error(`种子文件内容为空：${file.name}`));
          return;
        }
        resolve(payload.trim());
      };
      reader.readAsDataURL(file);
    }),
    file.arrayBuffer().then((buffer) => new Uint8Array(buffer)),
  ]);
  const contentSizeBytes = getTorrentContentSizeFromBytes(rawBytes);
  return {
    name: file.name,
    contentBase64: base64,
    sizeBytes: contentSizeBytes ?? file.size,
  };
}

function getTorrentFileKey(file: TorrentFilePayload) {
  return `${file.name}::${file.contentBase64.length}::${file.contentBase64.slice(0, 32)}`;
}

export default function NewTaskModal({ isOpen, onClose, onCreateTasks }: NewTaskModalProps) {
  const defaultDownloadDir = useBasicSettingsStore((state) => state.defaultDownloadDir);
  const defaultSplitCountSetting = useBasicSettingsStore((state) => state.defaultSplitCount);
  const maxConnectionsPerServerSetting = useBasicSettingsStore((state) => state.maxConnectionsPerServer);
  const autoDownloadTorrentSetting = useBasicSettingsStore((state) => state.autoDownloadTorrent);
  const forceEncryptSetting = useBasicSettingsStore((state) => state.forceEncrypt);
  const keepSeedingSetting = useBasicSettingsStore((state) => state.keepSeeding);
  const seedRatioSetting = useBasicSettingsStore((state) => state.seedRatio);
  const seedTimeMinutesSetting = useBasicSettingsStore((state) => state.seedTimeMinutes);
  const globalUserAgent = useAdvancedSettingsStore((state) => state.userAgent);
  const userAgentRules = useAdvancedSettingsStore((state) => state.userAgentRules);
  const [activeTab, setActiveTab] = useState<TabType>('link');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [splitCount, setSplitCount] = useState(() => defaultSplitCountSetting || 64);
  const [splitMin, setSplitMin] = useState(1);
  const [splitMax, setSplitMax] = useState(512);
  const [maxConnectionPerServer, setMaxConnectionPerServer] = useState(512);
  const [recommendedSplit, setRecommendedSplit] = useState(64);
  const [linkInput, setLinkInput] = useState('');
  const [rename, setRename] = useState('');
  const [savePath, setSavePath] = useState(() => defaultDownloadDir || '');
  const [userAgent, setUserAgent] = useState('');
  const [inheritGlobalUserAgent, setInheritGlobalUserAgent] = useState(true);
  const [authorization, setAuthorization] = useState('');
  const [referer, setReferer] = useState('');
  const [cookie, setCookie] = useState('');
  const [proxy, setProxy] = useState('');
  const [enableBtOverride, setEnableBtOverride] = useState(false);
  const [taskAutoDownloadTorrent, setTaskAutoDownloadTorrent] = useState(() => autoDownloadTorrentSetting);
  const [taskForceEncrypt, setTaskForceEncrypt] = useState(() => forceEncryptSetting);
  const [taskKeepSeeding, setTaskKeepSeeding] = useState(() => keepSeedingSetting);
  const [taskSeedRatio, setTaskSeedRatio] = useState(() => seedRatioSetting);
  const [taskSeedTimeMinutes, setTaskSeedTimeMinutes] = useState(() => seedTimeMinutesSetting);
  const [torrentFiles, setTorrentFiles] = useState<TorrentFilePayload[]>([]);
  const [isDraggingTorrent, setIsDraggingTorrent] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const torrentInputRef = useRef<HTMLInputElement | null>(null);

  const hasLinks = linkInput
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean).length > 0;

  const canSubmit = activeTab === 'torrent' ? torrentFiles.length > 0 : hasLinks;
  const validationConstraints = {
    minSplitCount: splitMin,
    maxSplitCount: splitMax,
    maxConnectionPerServer,
    defaultSplitCount: recommendedSplit,
    defaultMaxConnectionsPerServer: normalizeMaxConnectionsPerServer(maxConnectionsPerServerSetting, {
      minSplitCount: splitMin,
      maxSplitCount: splitMax,
      maxConnectionPerServer,
      defaultSplitCount: recommendedSplit,
      defaultMaxConnectionsPerServer: maxConnectionsPerServerSetting,
    }),
  };
  const effectiveSplitCount = normalizeSplitCount(splitCount, validationConstraints);
  const effectiveMaxConnectionsPerServer = normalizeMaxConnectionsPerServer(maxConnectionsPerServerSetting, validationConstraints);
  const sourceLinks = activeTab === 'link'
    ? linkInput.split('\n').map((item) => item.trim()).filter(Boolean)
    : [];
  const resolvedGlobalUserAgent = resolveUserAgentForLinks(sourceLinks, userAgentRules, globalUserAgent);
  const activeUserAgent = inheritGlobalUserAgent ? resolvedGlobalUserAgent.userAgent : userAgent;
  const normalizedUserAgent = normalizeUserAgentInput(activeUserAgent);
  const userAgentHasLineBreak = /[\r\n]/.test(activeUserAgent);
  const userAgentTooLong = normalizedUserAgent.length > USER_AGENT_MAX_LENGTH;

  useEffect(() => {
    if (!isOpen) return;
    let canceled = false;
    const loadTaskDefaults = async () => {
      try {
        const [constraints, installDir] = await Promise.all([
          aria2GetTaskOptionConstraints(),
          appGetInstallDir(),
        ]);
        if (canceled) return;
        setSplitMin(constraints.minSplitCount);
        setSplitMax(constraints.maxSplitCount);
        setMaxConnectionPerServer(constraints.maxConnectionPerServer);
        const fallback = Math.min(Math.max(defaultSplitCountSetting, constraints.minSplitCount), constraints.maxSplitCount);
        setRecommendedSplit(fallback);
        setSplitCount(fallback);
        setSavePath((prev) => {
          const custom = prev.trim();
          if (custom) return custom;
          return installDir;
        });
      } catch (error) {
        if (canceled) return;
        writeDeveloperLog({
          source: 'new-task-modal',
          action: 'load_task_defaults',
          level: 'warn',
          message: normalizeErrorMessage(error),
        });
        setSavePath((prev) => {
          if (prev.trim()) return prev;
          return defaultDownloadDir.trim();
        });
      }
    };
    void loadTaskDefaults();
    return () => {
      canceled = true;
    };
  }, [isOpen, defaultDownloadDir, defaultSplitCountSetting]);

  useEffect(() => {
    if (!isOpen) return;
    setTaskAutoDownloadTorrent(autoDownloadTorrentSetting);
    setTaskForceEncrypt(forceEncryptSetting);
    setTaskKeepSeeding(keepSeedingSetting);
    setTaskSeedRatio(seedRatioSetting);
    setTaskSeedTimeMinutes(seedTimeMinutesSetting);
    setEnableBtOverride(false);
    setInheritGlobalUserAgent(true);
    setUserAgent('');
  }, [
    isOpen,
    autoDownloadTorrentSetting,
    forceEncryptSetting,
    keepSeedingSetting,
    seedRatioSetting,
    seedTimeMinutesSetting,
  ]);

  const normalizeErrorMessage = (error: unknown) => {
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    return String(error);
  };

  const handlePickDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) return;
      setSavePath(selected);
    } catch {
      writeDeveloperLog({
        source: 'new-task-modal',
        action: 'open_directory_picker',
        level: 'error',
        message: '目录选择器打开失败',
      });
      setSubmitError('无法打开目录选择器，请检查系统权限后重试');
    }
  };

  const mergeTorrentFiles = (incoming: TorrentFilePayload[]) => {
    setTorrentFiles((current) => {
      const deduped = new Map<string, TorrentFilePayload>();
      [...current, ...incoming].forEach((item) => {
        const key = getTorrentFileKey(item);
        deduped.set(key, item);
      });
      return Array.from(deduped.values());
    });
  };

  const handleRemoveTorrentFile = (target: TorrentFilePayload) => {
    const targetKey = getTorrentFileKey(target);
    setTorrentFiles((current) => current.filter((item) => getTorrentFileKey(item) !== targetKey));
  };

  const handleTorrentFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    const validFiles = files.filter(isTorrentFile);
    if (!validFiles.length) {
      setSubmitError('仅支持导入 .torrent 种子文件');
      return;
    }
    try {
      const nextFiles = await Promise.all(validFiles.map((file) => readFileAsTorrentPayload(file)));
      mergeTorrentFiles(nextFiles);
      setSubmitError('');
    } catch (error) {
      setSubmitError(normalizeErrorMessage(error));
    }
  };

  const handlePickTorrentFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      await handleTorrentFiles(event.target.files);
    }
    event.target.value = '';
  };

  const handleSubmit = async () => {
    setSubmitError('');
    let payload: CreateTaskPayload;
    try {
      payload = validateAndNormalizeTaskPayload({
        type: activeTab,
        links: sourceLinks,
        torrentFiles,
        rename,
        splitCount,
        maxConnectionsPerServer: maxConnectionsPerServerSetting,
        savePath,
        advanced: {
          userAgent: activeUserAgent,
          authorization,
          referer,
          cookie,
          proxy,
        },
        btOptions: enableBtOverride ? {
          autoDownloadTorrent: taskAutoDownloadTorrent,
          forceEncrypt: taskForceEncrypt,
          keepSeeding: taskKeepSeeding,
          seedRatio: taskSeedRatio,
          seedTimeMinutes: taskSeedTimeMinutes,
        } : undefined,
      }, validationConstraints);
    } catch (error) {
      const message = normalizeErrorMessage(error);
      setSubmitError(message);
      return;
    }

    setSubmitting(true);
    try {
      const createdCount = await onCreateTasks(payload);
      if (createdCount <= 0) {
        setSubmitError('添加任务失败，请检查引擎连接与鉴权配置');
      }
    } catch (error) {
      const message = normalizeErrorMessage(error);
      writeDeveloperLog({
        source: 'new-task-modal',
        action: 'submit_task',
        level: 'error',
        message,
      });
      setSubmitError(mapTaskCreationError(message));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-main w-[680px] rounded-lg shadow-2xl flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <h2 className="text-lg font-medium text-text-main">新建任务</h2>
          <button 
            onClick={onClose}
            className="text-text-muted hover:text-text-main transition-colors"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4 border-b border-black/5 flex gap-6">
          <button
            onClick={() => setActiveTab('link')}
            className={cn(
              "pb-3 text-[15px] font-medium transition-colors relative",
              activeTab === 'link' 
                ? "text-primary" 
                : "text-text-muted hover:text-text-main"
            )}
          >
            链接任务
            {activeTab === 'link' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('torrent')}
            className={cn(
              "pb-3 text-[15px] font-medium transition-colors relative",
              activeTab === 'torrent' 
                ? "text-primary" 
                : "text-text-muted hover:text-text-main"
            )}
          >
            种子任务
            {activeTab === 'torrent' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
            )}
          </button>
        </div>

        {/* Content Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
          {activeTab === 'link' ? (
            <textarea 
              className="w-full h-32 p-3 border border-black/10 rounded-md bg-white focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 resize-none text-[13px] placeholder:text-text-muted/60"
              placeholder="每行一个下载链接（支持磁力链）"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
            />
          ) : (
            <div className="rounded-xl border border-[#d9cfbf] bg-[#f8f4ec] px-3 py-3">
              <input
                ref={torrentInputRef}
                type="file"
                accept=".torrent,application/x-bittorrent"
                multiple
                className="hidden"
                onChange={(event) => {
                  void handlePickTorrentFiles(event);
                }}
              />
              {torrentFiles.length > 0 ? (
                <div className="mb-2 space-y-2">
                  {torrentFiles.map((item) => (
                    <div
                      key={getTorrentFileKey(item)}
                      className="flex items-center gap-3 rounded-md border border-[#d7d0c4] bg-[#efebe4] px-3 py-2"
                    >
                      <div className="min-w-0 flex-1 truncate text-[13px] text-text-main">{item.name}</div>
                      <span className="rounded bg-[#d9ecff] px-2 py-0.5 text-[12px] font-medium text-[#4c8fd8]">Torrent</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTorrentFile(item)}
                        className="text-text-muted hover:text-text-main transition-colors cursor-pointer"
                        title="移除种子"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => torrentInputRef.current?.click()}
                onDragEnter={() => setIsDraggingTorrent(true)}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDraggingTorrent(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setIsDraggingTorrent(false);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDraggingTorrent(false);
                  void handleTorrentFiles(event.dataTransfer.files);
                }}
                className={cn(
                  "flex h-10 w-full items-center justify-center gap-2 rounded-md border border-dashed px-4 text-[13px] text-text-muted transition-colors cursor-pointer",
                  isDraggingTorrent
                    ? "border-primary bg-primary/10 text-text-main"
                    : "border-[#d7c8aa] bg-[#f6f1e8] hover:bg-[#f1eadf]"
                )}
              >
                <UploadCloud size={16} strokeWidth={1.8} />
                <span>将种子拖到此处，或点击选择</span>
              </button>
              <div className="mt-2 overflow-hidden rounded-md border border-[#d7d0c4] bg-white">
                <div className="grid grid-cols-[42px_56px_minmax(0,1fr)_110px] items-center border-b border-[#ebe4d7] bg-[#f3f3f5] px-3 py-2 text-[13px] font-medium text-text-main">
                  <div className="flex items-center justify-center">
                    <div className="flex h-4 w-4 items-center justify-center rounded-sm border border-[#d2b15f] bg-[#f0b63f] text-white text-[11px]">✓</div>
                  </div>
                  <span>序号</span>
                  <span>文件名</span>
                  <span className="text-right">大小</span>
                </div>
                <div className="max-h-44 overflow-y-auto custom-scrollbar">
                  {torrentFiles.length > 0 ? (
                    torrentFiles.map((item, index) => (
                      <div
                        key={getTorrentFileKey(item)}
                        className="grid grid-cols-[42px_56px_minmax(0,1fr)_110px] items-center px-3 py-3 text-[13px] text-text-main border-b border-[#f1ece3] last:border-b-0"
                      >
                        <div className="flex items-center justify-center">
                          <div className="flex h-4 w-4 items-center justify-center rounded-sm border border-[#d2b15f] bg-[#f0b63f] text-white text-[11px]">✓</div>
                        </div>
                        <span>{index + 1}</span>
                        <span className="truncate">{item.name}</span>
                        <span className="text-right tabular-nums">{formatBytes(item.sizeBytes ?? 0)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-6 text-center text-[12px] text-text-muted">
                      暂未选择种子文件，支持一次导入多个 .torrent 文件
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 flex-1">
                <span className="text-[13px] text-text-main shrink-0 w-14 text-right">重命名:</span>
                <input 
                  type="text" 
                  placeholder="选填"
                  value={rename}
                  onChange={(e) => setRename(e.target.value)}
                  className="flex-1 h-9 px-3 border border-black/10 rounded-md bg-white focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 text-[13px]"
                />
              </div>
              <div className="flex items-center gap-3 w-[240px]">
                <span className="text-[13px] text-text-main shrink-0 w-14 text-right">分片数:</span>
                <div className="flex h-9 flex-1 items-center rounded-md border border-black/10 bg-white overflow-hidden">
                  <input 
                    type="number" 
                    value={splitCount}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (Number.isNaN(value)) return;
                      setSplitCount(normalizeSplitCount(value, {
                        minSplitCount: splitMin,
                        maxSplitCount: splitMax,
                        maxConnectionPerServer,
                        defaultSplitCount: recommendedSplit,
                        defaultMaxConnectionsPerServer: maxConnectionsPerServerSetting,
                      }));
                    }}
                    className="flex-1 h-full min-w-0 px-2 text-center text-[13px] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setSplitCount((s) => normalizeSplitCount(s - 1, {
                      minSplitCount: splitMin,
                      maxSplitCount: splitMax,
                      maxConnectionPerServer,
                      defaultSplitCount: recommendedSplit,
                      defaultMaxConnectionsPerServer: maxConnectionsPerServerSetting,
                    }))}
                    className="flex h-full w-10 items-center justify-center border-l border-black/10 text-text-muted hover:bg-black/5 cursor-pointer transition-colors"
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSplitCount((s) => normalizeSplitCount(s + 1, {
                      minSplitCount: splitMin,
                      maxSplitCount: splitMax,
                      maxConnectionPerServer,
                      defaultSplitCount: recommendedSplit,
                      defaultMaxConnectionsPerServer: maxConnectionsPerServerSetting,
                    }))}
                    className="flex h-full w-10 items-center justify-center border-l border-black/10 text-text-muted hover:bg-black/5 cursor-pointer transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-text-main shrink-0 w-14 text-right">存储路径:</span>
              <div className="flex-1 flex">
                <input 
                  type="text" 
                  value={savePath}
                  onChange={(e) => setSavePath(e.target.value)}
                  className="flex-1 h-9 px-3 border border-black/10 border-r-0 rounded-l-md bg-white focus:outline-none text-[13px] text-text-main"
                />
                <button
                  onClick={() => void handlePickDirectory()}
                  className="px-3 h-9 border border-black/10 rounded-r-md bg-black/5 hover:bg-black/10 transition-colors cursor-pointer"
                >
                  <FolderOpen size={16} className="text-text-muted" strokeWidth={1.5} />
                </button>
              </div>
            </div>
          </div>
          <div className="mt-2 pl-[68px] text-[12px] text-text-muted">
            当前将使用：分片 {effectiveSplitCount}，单服务器连接 {effectiveMaxConnectionsPerServer}
          </div>
          {submitError ? <div className="mt-2 pl-[68px] text-[12px] text-red-500">{submitError}</div> : null}
          <div className="mt-6 flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <div className={cn(
                "w-4 h-4 rounded-sm border flex items-center justify-center transition-colors",
                showAdvanced ? "bg-primary border-primary" : "border-black/20 bg-white"
              )}>
                {showAdvanced && <div className="w-2 h-2 bg-white rounded-sm" style={{ clipPath: 'polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%)' }} />}
              </div>
              <input 
                type="checkbox" 
                className="hidden"
                checked={showAdvanced}
                onChange={(e) => setShowAdvanced(e.target.checked)}
              />
              <span className="text-[13px] text-text-main">高级选项</span>
            </label>
          </div>

          {/* Advanced Options Content */}
          {showAdvanced && (
            <div className="mt-4 space-y-4 pt-4 border-t border-black/5">
              {[
                { label: 'User-Agent:', placeholder: '请输入' },
                { label: '认证信息:', placeholder: '请输入' },
                { label: '来源页面:', placeholder: '请输入' },
                { label: 'Cookie:', placeholder: '请输入' },
                { label: '代理:', placeholder: '[http://][USER:PASSWORD@]HOST[:PORT]' }
              ].map((item, idx) => (
                <div key={idx} className="flex items-start gap-4">
                  <span className="text-[13px] text-text-main w-20 text-right pt-2 shrink-0">{item.label}</span>
                  <textarea 
                    className="flex-1 h-12 p-2 border border-black/10 rounded-md bg-white focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 resize-none text-[13px] placeholder:text-text-muted/60"
                    placeholder={item.placeholder}
                    disabled={item.label === 'User-Agent:' && inheritGlobalUserAgent}
                    value={
                      item.label === 'User-Agent:' ? (inheritGlobalUserAgent ? activeUserAgent : userAgent) :
                      item.label === '认证信息:' ? authorization :
                      item.label === '来源页面:' ? referer :
                      item.label === 'Cookie:' ? cookie : proxy
                    }
                    onChange={(e) => {
                      if (item.label === 'User-Agent:') setUserAgent(e.target.value);
                      if (item.label === '认证信息:') setAuthorization(e.target.value);
                      if (item.label === '来源页面:') setReferer(e.target.value);
                      if (item.label === 'Cookie:') setCookie(e.target.value);
                      if (item.label === '代理:') setProxy(e.target.value);
                    }}
                  />
                </div>
              ))}
              <div className="flex items-center gap-4 pl-24 -mt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={inheritGlobalUserAgent}
                    onChange={(e) => setInheritGlobalUserAgent(e.target.checked)}
                    className="h-4 w-4 rounded border-black/20"
                  />
                  <span className="text-[12px] text-text-main">继承进阶设置中的 User-Agent</span>
                </label>
                <button
                  onClick={() => setUserAgent(normalizeUserAgentInput(userAgent))}
                  disabled={inheritGlobalUserAgent}
                  className={cn(
                    "px-2 py-1 rounded border text-[12px] transition-colors",
                    inheritGlobalUserAgent
                      ? "border-black/10 text-text-muted/60 cursor-not-allowed"
                      : "border-[#e5a038]/40 text-[#e5a038] hover:bg-[#e5a038]/5 cursor-pointer"
                  )}
                >
                  规范 UA
                </button>
                {inheritGlobalUserAgent && resolvedGlobalUserAgent.matchedPattern ? (
                  <span className="text-[12px] text-primary">
                    当前命中规则：{resolvedGlobalUserAgent.matchedPattern}
                  </span>
                ) : null}
              </div>
              {(userAgentHasLineBreak || userAgentTooLong) && (
                <div className="pl-24 text-[12px] text-red-500">
                  {userAgentHasLineBreak ? 'User-Agent 含换行符，提交时会自动压缩为单行。' : ''}
                  {userAgentHasLineBreak && userAgentTooLong ? ' ' : ''}
                  {userAgentTooLong ? `User-Agent 过长（上限 ${USER_AGENT_MAX_LENGTH} 字符）。` : ''}
                </div>
              )}
              <div className="pt-2 border-t border-black/5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={enableBtOverride}
                    onChange={(e) => setEnableBtOverride(e.target.checked)}
                    className="h-4 w-4 rounded border-black/20"
                  />
                  <span className="text-[13px] text-text-main">覆盖全局 BT 参数（当前任务生效）</span>
                </label>
                {enableBtOverride && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="flex items-center gap-2 text-[13px] text-text-main">
                      <input
                        type="checkbox"
                        checked={taskAutoDownloadTorrent}
                        onChange={(e) => setTaskAutoDownloadTorrent(e.target.checked)}
                        className="h-4 w-4 rounded border-black/20"
                      />
                      自动下载种子关联文件
                    </label>
                    <label className="flex items-center gap-2 text-[13px] text-text-main">
                      <input
                        type="checkbox"
                        checked={taskForceEncrypt}
                        onChange={(e) => setTaskForceEncrypt(e.target.checked)}
                        className="h-4 w-4 rounded border-black/20"
                      />
                      强制加密
                    </label>
                    <label className="flex items-center gap-2 text-[13px] text-text-main">
                      <input
                        type="checkbox"
                        checked={taskKeepSeeding}
                        onChange={(e) => setTaskKeepSeeding(e.target.checked)}
                        className="h-4 w-4 rounded border-black/20"
                      />
                      持续做种
                    </label>
                    <label className="flex items-center gap-2 text-[13px] text-text-main">
                      分享率
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={taskSeedRatio}
                        onChange={(e) => setTaskSeedRatio(Math.max(0, Number(e.target.value) || 0))}
                        className="w-24 px-2 py-1.5 border border-black/10 rounded-md bg-white focus:outline-none text-[13px]"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-[13px] text-text-main">
                      做种时长(分钟)
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={taskSeedTimeMinutes}
                        onChange={(e) => setTaskSeedTimeMinutes(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                        className="w-28 px-2 py-1.5 border border-black/10 rounded-md bg-white focus:outline-none text-[13px]"
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-black/5 flex justify-end gap-3 bg-main rounded-b-lg">
          <button 
            onClick={onClose}
            className="px-6 py-1.5 rounded text-[13px] text-text-main border border-black/10 hover:bg-black/5 transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!canSubmit || submitting}
            className={cn(
              "px-6 py-1.5 rounded text-[13px] text-white transition-colors",
              canSubmit && !submitting ? "bg-primary hover:bg-primary-hover" : "bg-primary/50 cursor-not-allowed"
            )}
          >
            {submitting ? '提交中...' : '提交'}
          </button>
        </div>
      </div>
    </div>
  );
}

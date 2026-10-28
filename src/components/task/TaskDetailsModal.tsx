import { X, HardDrive, Activity, FileText, Users, Database, Zap, RefreshCw } from 'lucide-react';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../utils/cn';
import { formatBytes, formatDuration, formatRemainingTime, formatSpeed } from '../../utils/format';
import { useTaskStore } from '../../store/tasks';
import { useAdvancedSettingsStore } from '../../store/settings/advancedStore';
import { useBasicSettingsStore } from '../../store/settings/basicStore';
import { aria2GetTaskDetail } from '../../services/download/aria2RpcEngine';
import SpeedSparkline, { SPEED_SAMPLE_LIMIT } from './SpeedSparkline';
import type { DownloadTaskDetail } from '../../types/task';

interface TaskDetailsModalProps {
  taskId: string;
  onClose: () => void;
}

type TabType = 'overview' | 'activity' | 'situation' | 'files' | 'peers' | 'trackers';

const DETAIL_POLL_INTERVAL_MS = 4000;

function hexToBin(hex: string): string {
  let bin = '';
  for (let i = 0; i < hex.length; i++) {
    bin += parseInt(hex[i], 16).toString(2).padStart(4, '0');
  }
  return bin;
}

function formatDateTime(timestamp: number | null | undefined) {
  if (!timestamp || !Number.isFinite(timestamp)) return '—';
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function isSeedingTask(task: { sourceType: string; status: string; totalBytes: number; downloadedBytes: number }) {
  return task.sourceType === 'torrent' && task.status === 'seeding';
}

function getTaskStatusLabel(status: string, isSeeding = false) {
  if (isSeeding) {
    return '做种中';
  }
  switch (status) {
    case 'downloading':
      return '下载中';
    case 'paused':
      return '已暂停';
    case 'seeding':
      return '做种中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return '已停止';
  }
}

function getTaskStatusClass(status: string, isSeeding = false) {
  if (isSeeding) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-600';
  }
  if (status === 'failed') {
    return 'border-red-200 bg-red-50 text-red-500';
  }
  return 'border-[#d9cfb8] bg-white text-text-main';
}

function getTrackerStatusLabel(status: 'online' | 'offline' | 'unknown') {
  if (status === 'online') return '在线';
  if (status === 'offline') return '离线';
  return '未知';
}

function getTrackerStatusClass(status: 'online' | 'offline' | 'unknown') {
  if (status === 'online') {
    return 'border border-emerald-200 bg-emerald-50 text-emerald-600';
  }
  if (status === 'offline') {
    return 'border border-red-200 bg-red-50 text-red-500';
  }
  return 'border border-black/10 bg-white text-text-main';
}

export default function TaskDetailsModal({ taskId, onClose }: TaskDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [smoothedSpeed, setSmoothedSpeed] = useState(0);
  // 速度历史采样（近 SPEED_SAMPLE_LIMIT 秒），用于绘制速度曲线
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);
  // 重连标记：记录每次重连成功时的采样索引，用于在曲线上画橙色竖线
  const [reconnectMarkers, setReconnectMarkers] = useState<number[]>([]);
  const [isReconnecting, setIsReconnecting] = useState(false);
  // 刷新链接状态：仅鉴权链接任务显示按钮
  const [isRefreshingLink, setIsRefreshingLink] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [taskDetail, setTaskDetail] = useState<DownloadTaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [probingTrackers, setProbingTrackers] = useState(false);
  const task = useTaskStore(
    (state) => state.tasks.find((t) => t.id === taskId)
  );
  const reconnectTask = useTaskStore((state) => state.reconnectTask);
  const refreshTaskLink = useTaskStore((state) => state.refreshTaskLink);
  // 速度衰减阈值从用户设置读取，与曲线红线保持一致
  const reconnectSpeedThresholdKB = useBasicSettingsStore((state) => state.reconnectSpeedThresholdKB);
  const globalUserAgent = useAdvancedSettingsStore((state) => state.userAgent);
  const globalMaxConnectionsPerServer = useBasicSettingsStore((state) => state.maxConnectionsPerServer);
  const globalDefaultSplitCount = useBasicSettingsStore((state) => state.defaultSplitCount);
  const activityCanvasRef = useRef<HTMLCanvasElement>(null);
  const detailRequestIdRef = useRef(0);
  const isTorrentTask = task?.sourceType === 'torrent';
  const detailPieceCount = taskDetail?.torrent?.pieceCount ?? 0;
  const detailPieceLength = taskDetail?.torrent?.pieceLength ?? 0;

  const { blocks } = useMemo(() => {
    if (!task) return { totalPieces: 0, blocks: [] };

    let pieces = detailPieceCount;
    const effectivePieceLength = detailPieceLength || task.pieceLength;
    if (pieces <= 0 && task.totalBytes > 0 && effectivePieceLength > 0) {
      pieces = Math.ceil(task.totalBytes / effectivePieceLength);
    }

    let bin = '';
    if (task.bitfield) {
      bin = hexToBin(task.bitfield);
    } else if (pieces > 0 && task.downloadedBytes > 0) {
      const completedPieces = Math.floor((task.downloadedBytes / task.totalBytes) * pieces);
      bin = '1'.repeat(completedPieces) + '0'.repeat(pieces - completedPieces);
    }

    const blocksArray: boolean[] = [];
    const displayPieces = pieces || 100;

    for (let i = 0; i < displayPieces; i++) {
      blocksArray.push(bin[i] === '1');
    }

    return { totalPieces: pieces, blocks: blocksArray };
  }, [detailPieceCount, detailPieceLength, task?.bitfield, task?.downloadedBytes, task?.totalBytes, task?.pieceLength]);

  const fileRows = useMemo(() => {
    if (!task?.files) return [];
    return task.files.map((file, idx) => {
      const fullPath = file.path || '未知文件';
      const pathParts = fullPath.split(/[/\\]/).filter(Boolean);
      const fileName = pathParts[pathParts.length - 1] || fullPath;
      const dotIndex = fileName.lastIndexOf('.');
      const ext = dotIndex > 0 ? fileName.slice(dotIndex) : '-';
      const percent = file.length > 0 ? (file.completedLength / file.length) * 100 : 0;
      return {
        order: file.index || idx + 1,
        name: fileName,
        ext,
        percent,
        completedLength: file.completedLength,
        totalLength: file.length,
      };
    });
  }, [task?.files]);

  useEffect(() => {
    setSmoothedSpeed(0);
    setSpeedHistory([]);
    setReconnectMarkers([]);
  }, [taskId]);

  useEffect(() => {
    setActiveTab('overview');
    setTaskDetail(null);
    setDetailLoading(false);
    setDetailError('');
    setProbingTrackers(false);
    detailRequestIdRef.current += 1;
  }, [taskId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setIsVisible(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!task || task.status !== 'downloading') return;
    const nextSpeed = task.speedBytes;
    setSmoothedSpeed((prev) => (prev <= 0 ? nextSpeed : prev * 0.75 + nextSpeed * 0.25));
    // 追加速度历史采样，仅保留最近 SPEED_SAMPLE_LIMIT 个点（约 30 秒）
    setSpeedHistory((prev) => {
      const next = [...prev, nextSpeed];
      return next.length > SPEED_SAMPLE_LIMIT ? next.slice(next.length - SPEED_SAMPLE_LIMIT) : next;
    });
  }, [task?.id, task?.status, task?.speedBytes]);

  // 非下载状态清空采样，避免曲线残留旧数据
  useEffect(() => {
    if (!task || task.status !== 'downloading') {
      setSpeedHistory([]);
    }
  }, [task?.status]);

  const loadTaskDetail = useCallback(async (probeTrackers = false, showLoading = false) => {
    if (!taskId || !isTorrentTask) {
      setTaskDetail(null);
      setDetailError('');
      return;
    }
    const requestId = ++detailRequestIdRef.current;
    if (showLoading) {
      setDetailLoading(true);
    }
    try {
      const detail = await aria2GetTaskDetail(taskId, { probeTrackers });
      if (detailRequestIdRef.current !== requestId) return;
      setTaskDetail(detail);
      setDetailError('');
    } catch (error) {
      if (detailRequestIdRef.current !== requestId) return;
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      if (detailRequestIdRef.current === requestId) {
        setDetailLoading(false);
      }
    }
  }, [isTorrentTask, taskId]);

  useEffect(() => {
    if (!isTorrentTask) {
      setTaskDetail(null);
      setDetailError('');
      return;
    }
    void loadTaskDetail(false, true);
    const timer = window.setInterval(() => {
      void loadTaskDetail(false, false);
    }, DETAIL_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isTorrentTask, loadTaskDetail]);

  useEffect(() => {
    if (!isTorrentTask && (activeTab === 'peers' || activeTab === 'trackers')) {
      setActiveTab('overview');
    }
  }, [activeTab, isTorrentTask]);

  const displaySpeed = task && task.status === 'downloading'
    ? (smoothedSpeed > 0 ? smoothedSpeed : task.speedBytes)
    : task?.speedBytes ?? 0;
  const remainingSeconds =
    task && task.status === 'downloading' && displaySpeed > 0 && task.totalBytes > task.downloadedBytes
      ? (task.totalBytes - task.downloadedBytes) / displaySpeed
      : null;
  const progressPercent =
    task && task.totalBytes > 0 ? Math.min(100, Math.max(0, (task.downloadedBytes / task.totalBytes) * 100)) : 0;
  const failedReason = (task?.errorMessage ?? '').trim() || ((task?.errorCode ?? '').trim() ? `aria2 错误码 ${task?.errorCode ?? ''}` : '未返回错误详情');
  const taskUserAgent = (task?.advanced?.userAgent ?? '').trim();
  const effectiveUserAgent = taskUserAgent || globalUserAgent.trim() || 'aria2 默认';
  const userAgentSourceLabel = taskUserAgent ? '任务覆盖' : globalUserAgent.trim() ? '全局设置' : 'aria2 默认';
  const configuredConnections = task?.requestedMaxConnectionsPerServer ?? globalMaxConnectionsPerServer;
  const configuredSplitCount = task?.requestedSplitCount ?? globalDefaultSplitCount;
  const effectiveConnectionLimit = Math.min(configuredConnections, configuredSplitCount);
  const torrentDetail = taskDetail?.torrent ?? null;
  const activityUploadSpeed = torrentDetail?.uploadSpeedBytes ?? task?.uploadSpeedBytes ?? 0;
  const uploadedBytes = torrentDetail?.uploadedBytes ?? 0;
  const shareRatio = task && task.downloadedBytes > 0 ? uploadedBytes / task.downloadedBytes : 0;
  const pieceCount = torrentDetail?.pieceCount ?? 0;
  const pieceLength = torrentDetail?.pieceLength || task?.pieceLength || 0;
  const peerRows = torrentDetail?.peers ?? [];
  const trackerRows = torrentDetail?.trackers ?? [];
  const activeConnections = torrentDetail?.connections ?? task?.connections ?? 0;
  const taskIsSeeding = task ? isSeedingTask(task) : false;
  const seedingDurationSeconds = taskIsSeeding && task?.seedingStartedAt
    ? Math.max(0, (Date.now() - task.seedingStartedAt) / 1000)
    : 0;

  const handleProbeTrackers = useCallback(async () => {
    if (!isTorrentTask || probingTrackers) return;
    setProbingTrackers(true);
    try {
      await loadTaskDetail(true, true);
    } finally {
      setProbingTrackers(false);
    }
  }, [isTorrentTask, loadTaskDetail, probingTrackers]);

  const drawBlocks = (canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx || blocks.length === 0) return;

    const containerWidth = canvas.parentElement?.clientWidth || 600;
    const padding = 16;
    const availableWidth = containerWidth - padding * 2;
    
    const blockSize = 8;
    const gap = 2;
    const blockWithGap = blockSize + gap;
    
    const cols = Math.max(1, Math.floor(availableWidth / blockWithGap));
    const rows = Math.ceil(blocks.length / cols);
    
    const dpr = window.devicePixelRatio || 1;
    const width = cols * blockWithGap - gap;
    const height = rows * blockWithGap - gap;
    
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    blocks.forEach((isCompleted, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);

      const x = col * blockWithGap;
      const y = row * blockWithGap;

      ctx.fillStyle = isCompleted ? '#22c55e' : 'rgba(0, 0, 0, 0.05)';

      ctx.beginPath();
      ctx.roundRect(x, y, blockSize, blockSize, 2);
      ctx.fill();
    });
  };

  useEffect(() => {
    const shouldDrawBlocks = isTorrentTask ? activeTab === 'activity' : activeTab === 'situation';
    if (!shouldDrawBlocks || !activityCanvasRef.current) return;
    drawBlocks(activityCanvasRef.current);
  }, [blocks, activeTab, isTorrentTask]);

  if (!task || typeof document === 'undefined') return null;

  const commonOverviewRows = [
    { label: 'GID', value: task.id, breakAll: true },
    { label: '任务名称', value: task.name },
    { label: '存储路径', value: task.savePath, breakAll: true },
    { label: '任务状态', value: <span className={cn('inline-block px-2 py-0.5 rounded border', getTaskStatusClass(task.status, taskIsSeeding))}>{getTaskStatusLabel(task.status, taskIsSeeding)}</span> },
    { label: '实际 User-Agent', value: effectiveUserAgent, breakAll: true },
    { label: 'User-Agent 来源', value: userAgentSourceLabel },
  ];

  const torrentOverviewRows = [
    { label: 'Hash', value: torrentDetail?.infoHash?.trim() || '—', breakAll: true },
    { label: '分片大小', value: pieceLength > 0 ? formatBytes(pieceLength) : '—' },
    { label: '分片数量', value: pieceCount > 0 ? pieceCount.toLocaleString('zh-CN') : '—' },
    { label: '发布时间', value: formatDateTime(torrentDetail?.createdAt ?? null) },
    { label: '备注', value: torrentDetail?.comment?.trim() || '—', breakAll: true },
  ];

  if (torrentDetail?.mode?.trim()) {
    torrentOverviewRows.splice(4, 0, {
      label: '模式',
      value: torrentDetail.mode.trim(),
    });
  }

  if (task.status === 'failed') {
    commonOverviewRows.push({ label: '失败原因', value: failedReason, breakAll: true });
  }

  const tabs = isTorrentTask
    ? [
        { key: 'overview', label: '概要', icon: <HardDrive size={16} /> },
        { key: 'activity', label: '活动', icon: <Activity size={16} /> },
        { key: 'files', label: '文件', icon: <FileText size={16} /> },
        { key: 'peers', label: '节点', icon: <Users size={16} /> },
        { key: 'trackers', label: '追踪器', icon: <Database size={16} /> },
      ]
    : [
        { key: 'overview', label: '概要', icon: <HardDrive size={16} /> },
        { key: 'activity', label: '活动', icon: <Activity size={16} /> },
        { key: 'situation', label: '情况', icon: <Activity size={16} /> },
        { key: 'files', label: '文件', icon: <FileText size={16} /> },
      ];

  return createPortal(
    <div className={cn(
      "fixed inset-0 z-50 flex justify-end bg-black/40 transition-opacity duration-300",
      isVisible ? "opacity-100" : "opacity-0"
    )} onClick={onClose}>
      <div className={cn(
        "bg-main w-[640px] h-full shadow-2xl flex flex-col border-l border-black/10 transform transition-transform duration-300",
        isVisible ? "translate-x-0" : "translate-x-full"
      )} onClick={(event) => event.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <h2 className="text-lg font-medium text-text-main truncate pr-4">{task.name}</h2>
          <button 
            onClick={onClose}
            className="text-text-muted hover:text-text-main transition-colors shrink-0"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-4 border-b border-black/5 flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as TabType)}
              className={cn(
                "pb-3 text-[15px] font-medium transition-colors relative flex items-center gap-2",
                activeTab === tab.key ? "text-primary" : "text-text-muted hover:text-text-main"
              )}
            >
              {tab.icon}
              {tab.label}
              {activeTab === tab.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-[#ddd3bf] overflow-hidden bg-[#fcfaf3]">
                <div className="grid grid-cols-[110px_1fr] text-[13px]">
                  {commonOverviewRows.map((row, index) => {
                    const isLastRow = index === commonOverviewRows.length - 1;
                    return (
                      <>
                        <div
                          key={`${row.label}-label`}
                          className={cn(
                            'px-4 py-3 border-r border-[#ddd3bf] text-text-main font-medium',
                            !isLastRow ? 'border-b border-[#ddd3bf]' : ''
                          )}
                        >
                          {row.label}
                        </div>
                        <div
                          key={`${row.label}-value`}
                          className={cn(
                            'px-4 py-3 text-text-main',
                            row.breakAll ? 'break-all' : '',
                            !isLastRow ? 'border-b border-[#ddd3bf]' : ''
                          )}
                        >
                          {row.value}
                        </div>
                      </>
                    );
                  })}
                </div>
              </div>
              {isTorrentTask && (
                <div className="rounded-lg border border-[#ddd3bf] overflow-hidden bg-[#fcfaf3]">
                  <div className="px-4 py-3 border-b border-[#ddd3bf] text-[13px] font-semibold text-[#d69a1c]">
                    BitTorrent
                  </div>
                  <div className="grid grid-cols-[110px_1fr] text-[13px]">
                    {torrentOverviewRows.map((row, index) => {
                      const isLastRow = index === torrentOverviewRows.length - 1;
                      return (
                        <>
                          <div
                            key={`${row.label}-label`}
                            className={cn(
                              'px-4 py-3 border-r border-[#ddd3bf] text-text-main font-medium',
                              !isLastRow ? 'border-b border-[#ddd3bf]' : ''
                            )}
                          >
                            {row.label}
                          </div>
                          <div
                            key={`${row.label}-value`}
                            className={cn(
                              'px-4 py-3 text-text-main',
                              row.breakAll ? 'break-all' : '',
                              !isLastRow ? 'border-b border-[#ddd3bf]' : ''
                            )}
                          >
                            {detailLoading && !torrentDetail ? '正在读取种子详情...' : row.value}
                          </div>
                        </>
                      );
                    })}
                  </div>
                </div>
              )}
              {detailError ? (
                <div className="text-[12px] text-red-500">{detailError}</div>
              ) : null}
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="space-y-4">
              {isTorrentTask && (
                <div className="bg-black/5 p-4 rounded-lg border border-black/10 overflow-hidden min-h-[180px]">
                  {blocks.length > 0 ? (
                    <canvas
                      ref={activityCanvasRef}
                      className="w-full"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  ) : (
                    <div className="text-[13px] text-text-muted text-center py-4">
                      暂无块信息
                    </div>
                  )}
                </div>
              )}
              {/* 速度历史曲线（近 30 秒）：直观展示速度衰减形态 */}
              <div className="bg-black/5 p-4 rounded-lg border border-black/10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13px] text-text-main font-medium">速度曲线（近 {SPEED_SAMPLE_LIMIT} 秒）</span>
                  <span className="text-[11px] text-text-muted">
                    当前 {formatSpeed(displaySpeed)}
                  </span>
                </div>
                <SpeedSparkline
                  data={speedHistory}
                  markers={reconnectMarkers}
                  thresholdBytes={reconnectSpeedThresholdKB * 1024}
                />
              </div>
              <div className="grid grid-cols-2 gap-0 border border-black/10 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-r border-black/10 text-text-main font-medium">任务进度</div>
                <div className="px-4 py-3 border-b border-black/10 text-text-main">
                  <div className="flex items-center justify-between text-[13px]">
                    <span>{progressPercent.toFixed(1)}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full rounded-full bg-black/10 overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
                <div className="px-4 py-3 border-b border-r border-black/10 text-text-main font-medium">文件大小</div>
                <div className="px-4 py-3 border-b border-black/10 text-text-main">
                  <span>{formatBytes(task.downloadedBytes)} / {formatBytes(task.totalBytes)}</span>
                  {remainingSeconds !== null ? (
                    <span className="ml-3 text-text-muted">剩余 {formatRemainingTime(remainingSeconds)}</span>
                  ) : null}
                </div>
                <div className="px-4 py-3 border-b border-r border-black/10 text-text-main font-medium">下载速度</div>
                <div className="px-4 py-3 border-b border-black/10 text-text-main">{formatSpeed(displaySpeed)}</div>
                {isTorrentTask ? (
                  <>
                    <div className="px-4 py-3 border-b border-r border-black/10 text-text-main font-medium">上传速度</div>
                    <div className="px-4 py-3 border-b border-black/10 text-text-main">{formatSpeed(activityUploadSpeed)}</div>
                    <div className="px-4 py-3 border-b border-r border-black/10 text-text-main font-medium">上传总量</div>
                    <div className="px-4 py-3 border-b border-black/10 text-text-main">{formatBytes(uploadedBytes)}</div>
                    <div className="px-4 py-3 border-b border-r border-black/10 text-text-main font-medium">分享率</div>
                    <div className="px-4 py-3 border-b border-black/10 text-text-main">{shareRatio.toFixed(2)}</div>
                    <div className="px-4 py-3 border-b border-r border-black/10 text-text-main font-medium">做种时长</div>
                    <div className="px-4 py-3 border-b border-black/10 text-text-main">{taskIsSeeding ? formatDuration(seedingDurationSeconds) : '—'}</div>
                    <div className="px-4 py-3 border-b border-r border-black/10 text-text-main font-medium">种子数</div>
                    <div className="px-4 py-3 border-b border-black/10 text-text-main">{torrentDetail?.seeders ?? 0}</div>
                    <div className="px-4 py-3 border-r border-black/10 text-text-main font-medium">连接数</div>
                    <div className="px-4 py-3 text-text-main">{activeConnections}</div>
                  </>
                ) : (
                  <>
                    <div className="px-4 py-3 border-b border-r border-black/10 text-text-main font-medium">当前活动连接数（实时）</div>
                    <div className="px-4 py-3 border-b border-black/10 text-text-main">{activeConnections}</div>
                    <div className="px-4 py-3 border-r border-black/10 text-text-main font-medium">有效连接上限（任务设置）</div>
                    <div className="px-4 py-3 text-text-main">{effectiveConnectionLimit}</div>
                  </>
                )}
                <div className={cn('px-4 py-3 border-t border-r border-black/10 text-text-main font-medium', isTorrentTask ? '' : '')}>分片数（任务设置）</div>
                <div className="px-4 py-3 border-t border-black/10 text-text-main">{configuredSplitCount}</div>
                {!isTorrentTask && (
                  <>
                    <div className="px-4 py-3 border-t border-r border-black/10 text-text-main font-medium">单服务器连接上限（任务设置）</div>
                    <div className="px-4 py-3 border-t border-black/10 text-text-main">{configuredConnections}</div>
                  </>
                )}
              </div>
              {detailError ? (
                <div className="text-[12px] text-red-500">{detailError}</div>
              ) : null}
              {/* 重连按钮：仅 downloading 状态显示，软重启重建连接池 */}
              {task?.status === 'downloading' && (
                <div className="flex items-center justify-end gap-2 pt-2">
                  {/* 刷新链接按钮：仅鉴权链接任务显示，调用解析插件拿新 token 走 changeUri 替换 */}
                  {task.isAuthLink && (
                    <button
                      disabled={isRefreshingLink}
                      onClick={async () => {
                        if (!task) return;
                        setIsRefreshingLink(true);
                        try {
                          await refreshTaskLink(task.id);
                        } finally {
                          setIsRefreshingLink(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-500/10 hover:bg-blue-500/20 text-blue-600 text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      title="重新解析拿新链接，走 aria2.changeUri 替换（不丢进度）"
                    >
                      <RefreshCw size={14} />
                      {isRefreshingLink ? '刷新中…' : '刷新链接'}
                    </button>
                  )}
                  <button
                    disabled={isReconnecting}
                    onClick={async () => {
                      if (!task) return;
                      setIsReconnecting(true);
                      try {
                        const ok = await reconnectTask(task.id);
                        // 重连成功后在当前采样位置打标记，曲线上画橙色竖线
                        if (ok) {
                          setReconnectMarkers((prev) => [...prev, speedHistory.length]);
                        }
                      } finally {
                        setIsReconnecting(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    title="保留进度，重新建立连接（不改变连接数设置）"
                  >
                    <Zap size={14} />
                    {isReconnecting ? '重连中…' : '重连'}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'situation' && !isTorrentTask && (
            <div className="space-y-4">
              <div className="bg-black/5 p-4 rounded-lg border border-black/10 overflow-hidden min-h-[220px]">
                {blocks.length > 0 ? (
                  <canvas 
                    ref={activityCanvasRef} 
                    className="w-full"
                    style={{ imageRendering: 'pixelated' }}
                  />
                ) : (
                  <div className="text-[13px] text-text-muted text-center py-4">
                    暂无块信息
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'files' && (
            <>
              {fileRows.length > 0 ? (
                <div className="bg-black/5 rounded-lg border border-black/10 overflow-hidden">
                  <table className="w-full text-[13px] text-left">
                    <thead className="bg-black/5">
                      <tr className="text-text-muted border-b border-black/10">
                        <th className="py-2.5 px-3 font-medium whitespace-nowrap w-[52px]">#</th>
                        <th className="py-2.5 px-3 font-medium min-w-[240px]">文件名</th>
                        <th className="py-2.5 px-3 font-medium whitespace-nowrap w-[96px]">扩展名</th>
                        <th className="py-2.5 px-3 font-medium whitespace-nowrap w-[88px]">%</th>
                        <th className="py-2.5 px-3 font-medium whitespace-nowrap w-[140px]">√</th>
                        <th className="py-2.5 px-3 font-medium whitespace-nowrap w-[140px]">大小</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fileRows.map((row) => (
                        <tr key={`${row.order}-${row.name}`} className="border-b border-black/5 last:border-0">
                          <td className="py-2.5 px-3 text-text-main">{row.order}</td>
                          <td className="py-2.5 px-3 text-text-main truncate" title={row.name}>{row.name}</td>
                          <td className="py-2.5 px-3 text-text-main">{row.ext}</td>
                          <td className="py-2.5 px-3 text-text-main">{row.percent.toFixed(1)}</td>
                          <td className="py-2.5 px-3 text-text-main">{formatBytes(row.completedLength)}</td>
                          <td className="py-2.5 px-3 text-text-main">{formatBytes(row.totalLength)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-[13px] text-text-muted text-center py-8">
                  暂无文件信息
                </div>
              )}
            </>
          )}

          {activeTab === 'peers' && isTorrentTask && (
            <>
              {peerRows.length > 0 ? (
                <div className="bg-black/5 rounded-lg border border-black/10 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px] text-left min-w-[780px]">
                      <thead className="bg-black/5">
                        <tr className="text-text-muted border-b border-black/10">
                          <th className="py-2.5 px-3 font-medium min-w-[180px]">节点地址</th>
                          <th className="py-2.5 px-3 font-medium min-w-[120px]">客户端</th>
                          <th className="py-2.5 px-3 font-medium whitespace-nowrap w-[80px]">%</th>
                          <th className="py-2.5 px-3 font-medium whitespace-nowrap w-[110px]">↓</th>
                          <th className="py-2.5 px-3 font-medium whitespace-nowrap w-[110px]">↑</th>
                          <th className="py-2.5 px-3 font-medium whitespace-nowrap w-[90px]">标志</th>
                          <th className="py-2.5 px-3 font-medium whitespace-nowrap w-[70px]">S</th>
                        </tr>
                      </thead>
                      <tbody>
                        {peerRows.map((row, index) => (
                          <tr key={`${row.address}-${index}`} className="border-b border-black/5 last:border-0">
                            <td className="py-2.5 px-3 text-text-main break-all">{row.address}</td>
                            <td className="py-2.5 px-3 text-text-main">{row.client}</td>
                            <td className="py-2.5 px-3 text-text-main">{row.progress.toFixed(0)}%</td>
                            <td className="py-2.5 px-3 text-text-main">{formatSpeed(row.downloadSpeedBytes)}</td>
                            <td className="py-2.5 px-3 text-text-main">{formatSpeed(row.uploadSpeedBytes)}</td>
                            <td className="py-2.5 px-3 text-text-main">{row.flag}</td>
                            <td className="py-2.5 px-3 text-text-main">{row.isSeeder ? '√' : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-[13px] text-text-muted text-center py-8">
                  {detailLoading ? '正在读取节点信息...' : '暂无节点信息'}
                </div>
              )}
              {detailError ? (
                <div className="text-[12px] text-red-500">{detailError}</div>
              ) : null}
            </>
          )}

          {activeTab === 'trackers' && isTorrentTask && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => void handleProbeTrackers()}
                  disabled={probingTrackers}
                  className="px-4 py-1.5 rounded-md bg-[#d6a01c] text-white text-[13px] hover:bg-[#c28f17] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {probingTrackers ? '探测中...' : '探测'}
                </button>
                <span className="text-[12px] text-text-muted">
                  HTTP/HTTPS 追踪器会尝试连通性探测，UDP 追踪器保持未知状态。
                </span>
              </div>
              {trackerRows.length > 0 ? (
                <div className="bg-black/5 rounded-lg border border-black/10 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px] text-left min-w-[780px]">
                      <thead className="bg-black/5">
                        <tr className="text-text-muted border-b border-black/10">
                          <th className="py-2.5 px-3 font-medium whitespace-nowrap w-[64px]">序号</th>
                          <th className="py-2.5 px-3 font-medium min-w-[460px]">URL</th>
                          <th className="py-2.5 px-3 font-medium whitespace-nowrap w-[90px]">协议</th>
                          <th className="py-2.5 px-3 font-medium whitespace-nowrap w-[100px]">状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trackerRows.map((row) => (
                          <tr key={`${row.index}-${row.url}`} className="border-b border-black/5 last:border-0">
                            <td className="py-2.5 px-3 text-text-main">{row.index}</td>
                            <td className="py-2.5 px-3 text-text-main break-all">{row.url}</td>
                            <td className="py-2.5 px-3 text-text-main">{row.protocol}</td>
                            <td className="py-2.5 px-3 text-text-main">
                              <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[12px]', getTrackerStatusClass(row.status))}>
                                {getTrackerStatusLabel(row.status)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="text-[13px] text-text-muted text-center py-8">
                  {detailLoading ? '正在读取追踪器信息...' : '暂无追踪器信息'}
                </div>
              )}
              {detailError ? (
                <div className="text-[12px] text-red-500">{detailError}</div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

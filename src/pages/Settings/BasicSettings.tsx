import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, Cloud, RefreshCw, Gauge, X } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { Toggle } from '../../components/ui/Toggle';
import { Checkbox } from '../../components/ui/Checkbox';
import { Select } from '../../components/ui/Select';
import { Section, Row } from '../../components/ui/SettingLayout';
import UpdateModal from '../../components/UpdateModal';
import Aria2UpdateProgressModal, { type Aria2UpdateProgressStatus } from '../../components/Aria2UpdateProgressModal';
import { checkVersionUpdate } from '../../services/app/backendApi';
import { writeDeveloperLog } from '../../store/developerLogStore';
import { useBasicSettingsStore } from '../../store/settings/basicStore';
import { useBasicSettingsValues, useSettingsActions } from '../../store/settings/selectors';
import type { ProgressBarScope, StartupResumeMode, ThemeMode } from '../../store/settings/types';
import type { VersionCheckResult } from '../../services/app/backendApi';
import { appGetAutostartEnabled, appSetAutostartEnabled } from '../../services/app/appRuntime';
import { aria2GetEngineStatus, aria2GetTaskOptionConstraints, aria2RestartEngine, aria2SetGlobalBtOptions } from '../../services/download/aria2RpcEngine';

type RestartToastType = 'info' | 'warning' | 'success';
type BtApplyStatus = 'idle' | 'applying' | 'success' | 'failed';

interface RestartToastItem {
  id: number;
  type: RestartToastType;
  text: string;
}

interface EngineUpdateModalState {
  status: Aria2UpdateProgressStatus;
  title: string;
  detail: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatCheckTime(value: string) {
  if (!value) return '尚未检查';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function detectPlatformLabel() {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const source = `${nav.userAgentData?.platform ?? ''} ${navigator.platform ?? ''} ${navigator.userAgent}`.toLowerCase();
  if (source.includes('win')) return 'Windows';
  if (source.includes('mac')) return 'macOS';
  if (source.includes('linux')) return 'Linux';
  if (source.includes('android')) return 'Android';
  if (source.includes('iphone') || source.includes('ipad') || source.includes('ios')) return 'iOS';
  return '未知平台';
}

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function clamp(value: number, min: number, max?: number) {
  const bounded = max === undefined ? value : Math.min(value, max);
  return Math.max(min, bounded);
}

function normalizeSeedRatio(value: number, fallback: number) {
  const parsed = Number.isFinite(value) ? value : fallback;
  const clamped = clamp(parsed, 0, 999);
  return Number(clamped.toFixed(1));
}

function normalizeSeedTimeMinutes(value: number, fallback: number) {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.floor(clamp(parsed, 0, 60 * 24 * 365));
}

function normalizeMaxConcurrentDownloads(value: number, fallback: number) {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.floor(clamp(parsed, 1, 999));
}

function normalizeTaskConnections(value: number, fallback: number, min: number, max: number) {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.floor(clamp(parsed, min, max));
}

function normalizeDefaultSplitCount(value: number, fallback: number, min: number, max: number) {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.floor(clamp(parsed, min, max));
}

export default function BasicSettings() {
  const {
    language, autoUpdate, updateFreq, theme, showProgress, progressBarScope,
    minimizeToTray, startupMinimize, startupAutoRun, startupRestore, startupResume,
    startupResumeMode,
    autoDownloadTorrent, forceEncrypt, keepSeeding,
    resumeBreakpoint, jumpToDownload, notifyOnComplete, noConfirmOnDelete, deleteTorrentOnComplete, deleteRecordOnMissing,
    defaultDownloadDir,
    lastUpdateCheckAt,
    uploadLimitValue,
    uploadLimitUnit,
    downloadLimitValue,
    downloadLimitUnit,
    seedRatio,
    seedTimeMinutes,
    maxConcurrentDownloads,
    defaultSplitCount,
    maxConnectionsPerServer,
    reconnectCooldownSeconds,
    reconnectSpeedThresholdKB,
  } = useBasicSettingsValues();
  const resetBasicSettings = useBasicSettingsStore((state) => state.resetBasicSettings);
  const { updateSetting } = useSettingsActions();
  const [showRestartModal, setShowRestartModal] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [toastList, setToastList] = useState<RestartToastItem[]>([]);
  const [splitMin, setSplitMin] = useState(1);
  const [splitMax, setSplitMax] = useState(512);
  const [maxConnectionLimit, setMaxConnectionLimit] = useState(512);
  const [platformLabel, setPlatformLabel] = useState('检测中');
  const [autostartReady, setAutostartReady] = useState(false);
  const [btApplyStatus, setBtApplyStatus] = useState<BtApplyStatus>('idle');
  const [btApplyError, setBtApplyError] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [latestUpdateInfo, setLatestUpdateInfo] = useState<VersionCheckResult | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [engineUpdateModalVisible, setEngineUpdateModalVisible] = useState(false);
  const [engineUpdateModal, setEngineUpdateModal] = useState<EngineUpdateModalState>({
    status: 'running',
    title: '正在准备 aria2 引擎更新',
    detail: '请稍候，正在准备下载并重启本地 aria2 引擎。',
  });

  const pushToast = (type: RestartToastType, text: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToastList((prev) => [...prev, { id, type, text }]);
    setTimeout(() => {
      setToastList((prev) => prev.filter((item) => item.id !== id));
    }, 5000);
  };

  const dismissToast = (id: number) => {
    setToastList((prev) => prev.filter((item) => item.id !== id));
  };

  const handleCheckUpdateNow = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      const result = await checkVersionUpdate();
      updateSetting('lastUpdateCheckAt', new Date().toISOString());
      if (result.hasUpdate) {
        setLatestUpdateInfo(result);
        setIsUpdateModalOpen(true);
        pushToast('info', `发现新版本 ${result.latestVersion}`);
      } else {
        pushToast('success', '当前已是最新版本');
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      writeDeveloperLog({
        source: 'basic-settings',
        action: 'version_check_manual',
        level: 'warn',
        message: reason,
      });
      pushToast('warning', reason);
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    setPlatformLabel(detectPlatformLabel());
  }, []);

  useEffect(() => {
    let canceled = false;
    const syncTaskOptionConstraints = async () => {
      try {
        const constraints = await aria2GetTaskOptionConstraints();
        if (canceled) return;
        setSplitMin(constraints.minSplitCount);
        setSplitMax(constraints.maxSplitCount);
        setMaxConnectionLimit(constraints.maxConnectionPerServer);
        const nextMaxConnections = clamp(
          useBasicSettingsStore.getState().maxConnectionsPerServer,
          constraints.minSplitCount,
          constraints.maxConnectionPerServer
        );
        const nextDefaultSplitCount = clamp(
          useBasicSettingsStore.getState().defaultSplitCount,
          constraints.minSplitCount,
          constraints.maxSplitCount
        );
        updateSetting('maxConnectionsPerServer', nextMaxConnections);
        updateSetting('defaultSplitCount', nextDefaultSplitCount);
      } catch (error) {
        if (canceled) return;
        writeDeveloperLog({
          source: 'basic-settings',
          action: 'load_task_constraints',
          level: 'warn',
          message: String(error),
        });
      }
    };
    void syncTaskOptionConstraints();
    return () => {
      canceled = true;
    };
  }, [updateSetting]);

  useEffect(() => {
    let canceled = false;
    const loadAutostartState = async () => {
      try {
        const systemEnabled = await appGetAutostartEnabled();
        if (canceled) return;
        updateSetting('startupAutoRun', systemEnabled);
      } catch (error) {
        if (canceled) return;
        writeDeveloperLog({
          source: 'basic-settings',
          action: 'load_autostart_state',
          level: 'warn',
          message: String(error),
        });
      } finally {
        if (!canceled) {
          setAutostartReady(true);
        }
      }
    };
    void loadAutostartState();
    return () => {
      canceled = true;
    };
  }, [updateSetting]);

  useEffect(() => {
    let canceled = false;
    if (!autostartReady) return () => {
      canceled = true;
    };
    const syncAutostart = async () => {
      try {
        const systemEnabled = await appGetAutostartEnabled();
        if (canceled) return;
        if (systemEnabled !== startupAutoRun) {
          await appSetAutostartEnabled(startupAutoRun);
        }
      } catch (error) {
        if (canceled) return;
        writeDeveloperLog({
          source: 'basic-settings',
          action: 'sync_autostart',
          level: 'warn',
          message: String(error),
        });
        pushToast('warning', '系统自启动设置失败，请检查系统权限后重试');
      }
    };
    void syncAutostart();
    return () => {
      canceled = true;
    };
  }, [autostartReady, startupAutoRun]);

  useEffect(() => {
    if (!engineUpdateModalVisible || engineUpdateModal.status !== 'success') return;
    const timer = window.setTimeout(() => {
      setEngineUpdateModalVisible(false);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [engineUpdateModal.status, engineUpdateModalVisible]);

  const applyBtOptions = async (showSuccessToast: boolean) => {
    setBtApplyStatus('applying');
    setBtApplyError('');
    try {
      await aria2SetGlobalBtOptions({
        autoDownloadTorrent,
        forceEncrypt,
        keepSeeding,
        seedRatio,
        seedTimeMinutes,
      });
      setBtApplyStatus('success');
      if (showSuccessToast) {
        pushToast('success', 'BT 设置已应用');
      }
    } catch (error) {
      const message = String(error);
      setBtApplyStatus('failed');
      setBtApplyError(message);
      writeDeveloperLog({
        source: 'basic-settings',
        action: 'sync_bt_options',
        level: 'warn',
        message,
      });
      pushToast('warning', 'BT 设置应用失败，可点击重试');
    }
  };

  useEffect(() => {
    let canceled = false;
    const timer = window.setTimeout(() => {
      const syncBtOptions = async () => {
        try {
          setBtApplyStatus('applying');
          setBtApplyError('');
          await aria2SetGlobalBtOptions({
            autoDownloadTorrent,
            forceEncrypt,
            keepSeeding,
            seedRatio,
            seedTimeMinutes,
          });
          if (canceled) return;
          setBtApplyStatus('success');
        } catch (error) {
          if (canceled) return;
          const message = String(error);
          setBtApplyStatus('failed');
          setBtApplyError(message);
          writeDeveloperLog({
            source: 'basic-settings',
            action: 'sync_bt_options',
            level: 'warn',
            message,
          });
        }
      };
      void syncBtOptions();
    }, 250);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [autoDownloadTorrent, forceEncrypt, keepSeeding, seedRatio, seedTimeMinutes]);

  const handleApplyBtPreset = (preset: 'light' | 'balanced' | 'aggressive') => {
    if (preset === 'light') {
      updateSetting('autoDownloadTorrent', true);
      updateSetting('forceEncrypt', false);
      updateSetting('keepSeeding', false);
      updateSetting('seedRatio', 1.5);
      updateSetting('seedTimeMinutes', 720);
      pushToast('info', '已应用轻量 BT 预设');
      return;
    }
    if (preset === 'balanced') {
      updateSetting('autoDownloadTorrent', true);
      updateSetting('forceEncrypt', false);
      updateSetting('keepSeeding', false);
      updateSetting('seedRatio', 2);
      updateSetting('seedTimeMinutes', 1440);
      pushToast('info', '已应用均衡 BT 预设');
      return;
    }
    updateSetting('autoDownloadTorrent', true);
    updateSetting('forceEncrypt', true);
    updateSetting('keepSeeding', true);
    updateSetting('seedRatio', 0);
    updateSetting('seedTimeMinutes', 0);
    pushToast('info', '已应用激进 BT 预设');
  };

  const seedingPolicyText = keepSeeding
    ? '当前策略：持续做种直到手动停止'
    : `当前策略：达到分享率 ${seedRatio} 或做种 ${seedTimeMinutes} 分钟后停止`;
  const taskPolicyText = `当前策略：最多并发 ${maxConcurrentDownloads} 个任务，新任务默认分片 ${defaultSplitCount}，单服务器连接 ${maxConnectionsPerServer}，单任务实际有效连接上限取两者较小值`;
  const notifyConfirmPolicyText = `当前策略：${notifyOnComplete ? '下载完成通知开启' : '下载完成通知关闭'}，${jumpToDownload ? '新建任务后自动跳转下载页' : '新建任务后保持当前页'}，${noConfirmOnDelete ? '删除任务无需二次确认' : '删除任务需要二次确认'}`;
  const autoCleanPolicyText = `当前策略：${deleteTorrentOnComplete ? '完成后自动删除种子文件' : '完成后保留种子文件'}，${deleteRecordOnMissing ? '本地文件缺失时自动清理记录' : '本地文件缺失时保留记录'}`;

  const handleApplyNotifyPreset = (preset: 'quiet' | 'standard' | 'safe') => {
    if (preset === 'quiet') {
      updateSetting('jumpToDownload', false);
      updateSetting('notifyOnComplete', false);
      updateSetting('noConfirmOnDelete', true);
      pushToast('info', '已应用安静模式');
      return;
    }
    if (preset === 'standard') {
      updateSetting('jumpToDownload', true);
      updateSetting('notifyOnComplete', true);
      updateSetting('noConfirmOnDelete', false);
      pushToast('info', '已应用标准模式');
      return;
    }
    updateSetting('jumpToDownload', false);
    updateSetting('notifyOnComplete', true);
    updateSetting('noConfirmOnDelete', false);
    pushToast('info', '已应用严格确认模式');
  };

  const handleApplyAutoCleanPreset = (preset: 'safe' | 'balanced' | 'strict') => {
    if (preset === 'safe') {
      updateSetting('deleteTorrentOnComplete', false);
      updateSetting('deleteRecordOnMissing', false);
      pushToast('info', '已应用保留优先模式');
      return;
    }
    if (preset === 'balanced') {
      updateSetting('deleteTorrentOnComplete', true);
      updateSetting('deleteRecordOnMissing', false);
      pushToast('info', '已应用均衡清理模式');
      return;
    }
    updateSetting('deleteTorrentOnComplete', true);
    updateSetting('deleteRecordOnMissing', true);
    pushToast('info', '已应用严格清理模式');
  };

  const handleRestartEngine = async () => {
    if (restarting) return;
    setShowRestartModal(false);
    setRestarting(true);
    setEngineUpdateModal({
      status: 'running',
      title: '正在下载并更新 aria2 引擎',
      detail: '正在获取最新 aria2 版本并替换本地引擎文件，请保持窗口开启。',
    });
    setEngineUpdateModalVisible(true);
    pushToast('info', '正在下载并更新 aria2 引擎...');
    try {
      await aria2RestartEngine();
      setEngineUpdateModal({
        status: 'running',
        title: '正在重启 aria2 引擎',
        detail: '更新包已下载完成，正在重启 aria2 并重新检测引擎在线状态。',
      });
      await sleep(350);
      const status = await aria2GetEngineStatus(true);
      if (status.status === 'online') {
        setEngineUpdateModal({
          status: 'success',
          title: 'aria2 引擎已更新完成',
          detail: `当前引擎已重新联机，版本 ${status.version || '未知'}。`,
        });
        pushToast('success', 'aria2 引擎已更新并在线');
      } else if (status.status === 'auth_failed') {
        setEngineUpdateModal({
          status: 'error',
          title: 'aria2 引擎已重启，但鉴权失败',
          detail: '请检查 RPC 密钥配置是否与新启动的 aria2 引擎一致。',
        });
        pushToast('warning', 'aria2 引擎鉴权失败');
      } else {
        setEngineUpdateModal({
          status: 'error',
          title: 'aria2 引擎已更新，但仍未联机',
          detail: '请检查 aria2 可执行文件路径、RPC 端口和本机安全软件拦截情况。',
        });
        pushToast('warning', 'aria2 引擎仍离线，请检查端口与进程');
      }
    } catch (error) {
      const raw = String(error);
      const message = raw.toLowerCase();
      let detail = raw;
      if (message.includes('401') || message.includes('unauthorized') || message.includes('token') || message.includes('secret')) {
        detail = 'RPC 鉴权失败，请检查 RPC 密钥配置是否正确。';
        pushToast('warning', 'aria2 引擎鉴权失败');
      } else if (message.includes('启动 aria2c 失败')) {
        detail = '未检测到 aria2c，请先安装 aria2 或在进阶设置填写可执行文件路径。';
        pushToast('warning', '未检测到 aria2c，请先安装或在进阶设置填写可执行文件路径');
      } else {
        pushToast('warning', raw);
      }
      setEngineUpdateModal({
        status: 'error',
        title: 'aria2 引擎更新失败',
        detail,
      });
    } finally {
      setRestarting(false);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (selected && typeof selected === 'string') {
        updateSetting('defaultDownloadDir', selected);
      }
    } catch (error) {
      writeDeveloperLog({
        source: 'basic-settings',
        action: 'open_directory_picker',
        level: 'error',
        message: String(error),
      });
      pushToast('warning', '无法打开目录选择器，请检查系统权限后重试');
    }
  };

  const handleDiscard = () => {
    resetBasicSettings();
    pushToast('info', '已恢复基础设置默认值');
  };

  const handleApply = () => {
    pushToast('success', '基础设置已保存并应用');
  };

  return (
    <div className="flex flex-col h-full bg-main relative">
      {/* Header */}
      <div className="px-8 py-6 border-b border-black/5 shrink-0">
        <h1 className="text-xl font-medium text-text-main">基础设置</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar pb-32">
        <div className="max-w-3xl">
          <Section title="Language">
            <Row label="Select Language">
              <Select 
                value={language}
                onChange={(val) => updateSetting('language', val)}
                options={[
                  { label: "简体中文", value: "zh-CN" },
                  { label: "English", value: "en-US" }
                ]}
              />
            </Row>
          </Section>

          <Section title="自动更新">
            <Row label="自动检查更新">
              <Toggle checked={autoUpdate} onChange={(val) => updateSetting('autoUpdate', val)} />
            </Row>
            <Row label="检查频率">
              <Select 
                value={updateFreq}
                onChange={(val) => updateSetting('updateFreq', val)}
                options={[
                  { label: "每天", value: "daily" },
                  { label: "每周", value: "weekly" },
                  { label: "每月", value: "monthly" },
                  { label: "每半年", value: "half-year" },
                  { label: "每年", value: "yearly" }
                ]}
              />
            </Row>
            <Row label="上次检查时间">
              <button
                onClick={handleCheckUpdateNow}
                disabled={checkingUpdate}
                className="flex items-center gap-2 px-3 py-1.5 border border-black/10 rounded-md bg-white hover:bg-black/5 transition-colors text-[13px] text-text-main cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Cloud size={14} />
                {checkingUpdate ? '检查中...' : '立即检查'}
              </button>
              <span className="text-[13px] text-text-muted ml-2">{formatCheckTime(lastUpdateCheckAt)}</span>
            </Row>
          </Section>

          <Section title="外观">
            <Row label="检测到的平台">
              <span className="px-4 py-1 rounded-full bg-blue-50 text-blue-500 text-[13px] border border-blue-100">{platformLabel}</span>
            </Row>
            <Row label="外观">
              <Select 
                value={theme}
                onChange={(val) => updateSetting('theme', val as ThemeMode)}
                options={[
                  { label: "跟随系统", value: "system" },
                  { label: "浅色模式", value: "light" },
                  { label: "深色模式", value: "dark" }
                ]}
              />
            </Row>
            <Row label="显示下载进度条">
              <Toggle checked={showProgress} onChange={(val) => updateSetting('showProgress', val)} />
            </Row>
            <Row label="进度条显示范围">
              <Select
                value={progressBarScope}
                onChange={(val) => updateSetting('progressBarScope', val as ProgressBarScope)}
                options={[
                  { label: "下载中 + 已完成", value: "all" },
                  { label: "仅下载中", value: "downloading" }
                ]}
              />
            </Row>
          </Section>

          <Section title="窗口与托盘">
            <Row label="关闭时最小化到托盘">
              <Toggle checked={minimizeToTray} onChange={(val) => updateSetting('minimizeToTray', val)} />
            </Row>
          </Section>

          <Section title="启动">
            <div className="space-y-4">
              <Checkbox checked={startupAutoRun} onChange={(val) => updateSetting('startupAutoRun', val)} label="登录时自动启动" />
              <Checkbox checked={startupMinimize} onChange={(val) => updateSetting('startupMinimize', val)} label="开机自启时最小化到托盘" />
              <Checkbox checked={startupRestore} onChange={(val) => updateSetting('startupRestore', val)} label="启动时恢复上次窗口大小和位置" />
              <Checkbox checked={startupResume} onChange={(val) => updateSetting('startupResume', val)} label="自动恢复未完成的任务" />
              <div className="pl-7">
                <Select
                  value={startupResumeMode}
                  onChange={(val) => updateSetting('startupResumeMode', val as StartupResumeMode)}
                  options={[
                    { label: "恢复全部未完成任务", value: "all" },
                    { label: "仅恢复暂停任务", value: "paused" },
                    { label: "仅恢复失败任务", value: "failed" }
                  ]}
                />
              </div>
            </div>
          </Section>

          <Section title="下载路径与速度">
            <Row label="默认下载路径">
              <div className="flex w-96">
                <input 
                  type="text" 
                  value={defaultDownloadDir || ''}
                  onChange={(e) => updateSetting('defaultDownloadDir', e.target.value)}
                  className="flex-1 px-3 py-1.5 border border-black/10 border-r-0 rounded-l-md bg-white focus:outline-none text-[13px] text-text-main"
                />
                <button 
                  onClick={handleSelectFolder}
                  className="px-3 py-1.5 border border-black/10 rounded-r-md bg-white hover:bg-black/5 transition-colors cursor-pointer"
                >
                  <FolderOpen size={16} className="text-text-main" strokeWidth={1.5} />
                </button>
              </div>
            </Row>
            <Row label="上传限速">
              <div className="flex items-center border border-black/10 rounded-md bg-white overflow-hidden w-64">
                <input
                  type="number"
                  min={0}
                  value={uploadLimitValue}
                  onChange={(e) => updateSetting('uploadLimitValue', clamp(toNumber(e.target.value, 0), 0))}
                  className="w-20 px-3 py-1.5 text-[13px] focus:outline-none"
                />
                <div className="flex flex-col border-l border-black/10 shrink-0">
                  <button
                    onClick={() => updateSetting('uploadLimitValue', uploadLimitValue + 1)}
                    className="px-1.5 border-b border-black/10 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    +
                  </button>
                  <button
                    onClick={() => updateSetting('uploadLimitValue', clamp(uploadLimitValue - 1, 0))}
                    className="px-1.5 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    -
                  </button>
                </div>
                <select
                  value={uploadLimitUnit}
                  onChange={(e) => updateSetting('uploadLimitUnit', e.target.value as 'KB/s' | 'MB/s')}
                  className="flex-1 border-l border-black/10 px-2 py-1.5 text-[13px] focus:outline-none bg-transparent cursor-pointer"
                >
                  <option value="KB/s">KB/s</option>
                  <option value="MB/s">MB/s</option>
                </select>
              </div>
            </Row>
            <Row label="下载限速">
              <div className="flex items-center border border-black/10 rounded-md bg-white overflow-hidden w-64">
                <input
                  type="number"
                  min={0}
                  value={downloadLimitValue}
                  onChange={(e) => updateSetting('downloadLimitValue', clamp(toNumber(e.target.value, 0), 0))}
                  className="w-20 px-3 py-1.5 text-[13px] focus:outline-none"
                />
                <div className="flex flex-col border-l border-black/10 shrink-0">
                  <button
                    onClick={() => updateSetting('downloadLimitValue', downloadLimitValue + 1)}
                    className="px-1.5 border-b border-black/10 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    +
                  </button>
                  <button
                    onClick={() => updateSetting('downloadLimitValue', clamp(downloadLimitValue - 1, 0))}
                    className="px-1.5 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    -
                  </button>
                </div>
                <select
                  value={downloadLimitUnit}
                  onChange={(e) => updateSetting('downloadLimitUnit', e.target.value as 'KB/s' | 'MB/s')}
                  className="flex-1 border-l border-black/10 px-2 py-1.5 text-[13px] focus:outline-none bg-transparent cursor-pointer"
                >
                  <option value="KB/s">KB/s</option>
                  <option value="MB/s">MB/s</option>
                </select>
              </div>
            </Row>
          </Section>

          <Section title="BT 设置">
            <div className="space-y-4 mb-6">
              <Checkbox checked={autoDownloadTorrent} onChange={(val) => updateSetting('autoDownloadTorrent', val)} label="自动下载磁力链接和种子内容" />
              <Checkbox checked={forceEncrypt} onChange={(val) => updateSetting('forceEncrypt', val)} label="强制 BT 加密" />
            </div>
            <Row label="持续做种直到手动停止">
              <Toggle checked={keepSeeding} onChange={(val) => updateSetting('keepSeeding', val)} />
            </Row>
            <Row label="参数预设">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleApplyBtPreset('light')}
                  className="px-3 py-1.5 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  轻量
                </button>
                <button
                  onClick={() => handleApplyBtPreset('balanced')}
                  className="px-3 py-1.5 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  均衡
                </button>
                <button
                  onClick={() => handleApplyBtPreset('aggressive')}
                  className="px-3 py-1.5 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  激进
                </button>
              </div>
            </Row>
            <Row label="应用状态">
              <div className="flex items-center gap-3">
                <span
                  className={
                    btApplyStatus === 'success'
                      ? 'text-[12px] text-emerald-600'
                      : btApplyStatus === 'failed'
                        ? 'text-[12px] text-red-500'
                        : btApplyStatus === 'applying'
                          ? 'text-[12px] text-amber-600'
                          : 'text-[12px] text-text-muted'
                  }
                >
                  {btApplyStatus === 'success'
                    ? '已应用'
                    : btApplyStatus === 'failed'
                      ? '应用失败'
                      : btApplyStatus === 'applying'
                        ? '应用中'
                        : '待应用'}
                </span>
                <button
                  onClick={() => {
                    void applyBtOptions(true);
                  }}
                  disabled={btApplyStatus === 'applying'}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  重试应用
                </button>
                {btApplyError ? <span className="text-[12px] text-red-500 max-w-md truncate">{btApplyError}</span> : null}
              </div>
            </Row>
          </Section>

          <Section title="做种">
            <Row label="当前策略">
              <span className="text-[12px] text-text-muted">{seedingPolicyText}</span>
            </Row>
            <Row label="做种分享率">
              <div className="flex items-center border border-black/10 rounded-md bg-white overflow-hidden w-32">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={seedRatio}
                  onChange={(e) => updateSetting('seedRatio', normalizeSeedRatio(toNumber(e.target.value, seedRatio), seedRatio))}
                  disabled={keepSeeding}
                  className="flex-1 px-3 py-1.5 text-[13px] focus:outline-none disabled:bg-black/[0.03] disabled:text-text-muted"
                />
                <div className="flex flex-col border-l border-black/10 shrink-0">
                  <button
                    onClick={() => updateSetting('seedRatio', normalizeSeedRatio(seedRatio + 0.1, seedRatio))}
                    disabled={keepSeeding}
                    className="px-2 border-b border-black/10 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    +
                  </button>
                  <button
                    onClick={() => updateSetting('seedRatio', normalizeSeedRatio(seedRatio - 0.1, seedRatio))}
                    disabled={keepSeeding}
                    className="px-2 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    -
                  </button>
                </div>
              </div>
            </Row>
            <Row label="做种时间 (分钟)">
              <div className="flex items-center border border-black/10 rounded-md bg-white overflow-hidden w-32">
                <input
                  type="number"
                  min={0}
                  value={seedTimeMinutes}
                  onChange={(e) => updateSetting('seedTimeMinutes', normalizeSeedTimeMinutes(toNumber(e.target.value, seedTimeMinutes), seedTimeMinutes))}
                  disabled={keepSeeding}
                  className="flex-1 px-3 py-1.5 text-[13px] focus:outline-none disabled:bg-black/[0.03] disabled:text-text-muted"
                />
                <div className="flex flex-col border-l border-black/10 shrink-0">
                  <button
                    onClick={() => updateSetting('seedTimeMinutes', normalizeSeedTimeMinutes(seedTimeMinutes + 10, seedTimeMinutes))}
                    disabled={keepSeeding}
                    className="px-2 border-b border-black/10 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    +
                  </button>
                  <button
                    onClick={() => updateSetting('seedTimeMinutes', normalizeSeedTimeMinutes(seedTimeMinutes - 10, seedTimeMinutes))}
                    disabled={keepSeeding}
                    className="px-2 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    -
                  </button>
                </div>
              </div>
              <span className="text-[12px] text-text-muted ml-2">
                {keepSeeding ? '已启用持续做种，分享率与做种时间限制不生效' : '达到分享率或做种时间后自动停止做种'}
              </span>
            </Row>
            <Row label="快捷时长">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    updateSetting('keepSeeding', false);
                    updateSetting('seedTimeMinutes', 30);
                  }}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  30 分钟
                </button>
                <button
                  onClick={() => {
                    updateSetting('keepSeeding', false);
                    updateSetting('seedTimeMinutes', 120);
                  }}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  2 小时
                </button>
                <button
                  onClick={() => {
                    updateSetting('keepSeeding', false);
                    updateSetting('seedTimeMinutes', 1440);
                  }}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  1 天
                </button>
              </div>
            </Row>
          </Section>

          <Section title="任务管理">
            <Row label="当前策略">
              <span className="text-[12px] text-text-muted">{taskPolicyText}</span>
            </Row>
            <Row label="快捷预设">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    updateSetting('maxConcurrentDownloads', 3);
                    updateSetting('maxConnectionsPerServer', normalizeTaskConnections(8, maxConnectionsPerServer, splitMin, maxConnectionLimit));
                    updateSetting('defaultSplitCount', normalizeDefaultSplitCount(16, defaultSplitCount, splitMin, splitMax));
                  }}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  保守
                </button>
                <button
                  onClick={() => {
                    updateSetting('maxConcurrentDownloads', 5);
                    updateSetting('maxConnectionsPerServer', normalizeTaskConnections(32, maxConnectionsPerServer, splitMin, maxConnectionLimit));
                    updateSetting('defaultSplitCount', normalizeDefaultSplitCount(64, defaultSplitCount, splitMin, splitMax));
                  }}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  均衡
                </button>
                <button
                  onClick={() => {
                    updateSetting('maxConcurrentDownloads', 10);
                    updateSetting('maxConnectionsPerServer', normalizeTaskConnections(64, maxConnectionsPerServer, splitMin, maxConnectionLimit));
                    updateSetting('defaultSplitCount', normalizeDefaultSplitCount(128, defaultSplitCount, splitMin, splitMax));
                  }}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  高并发
                </button>
              </div>
            </Row>
            <Row label="最大同时下载数">
              <div className="flex items-center border border-black/10 rounded-md bg-white overflow-hidden w-32">
                <input
                  type="number"
                  min={1}
                  value={maxConcurrentDownloads}
                  onChange={(e) => updateSetting('maxConcurrentDownloads', normalizeMaxConcurrentDownloads(toNumber(e.target.value, maxConcurrentDownloads), maxConcurrentDownloads))}
                  className="flex-1 px-3 py-1.5 text-[13px] focus:outline-none"
                />
                <div className="flex flex-col border-l border-black/10 shrink-0">
                  <button
                    onClick={() => updateSetting('maxConcurrentDownloads', normalizeMaxConcurrentDownloads(maxConcurrentDownloads + 1, maxConcurrentDownloads))}
                    className="px-2 border-b border-black/10 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    +
                  </button>
                  <button
                    onClick={() => updateSetting('maxConcurrentDownloads', normalizeMaxConcurrentDownloads(maxConcurrentDownloads - 1, maxConcurrentDownloads))}
                    className="px-2 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    -
                  </button>
                </div>
              </div>
              <span className="text-[12px] text-text-muted ml-2">建议 3-10，过高可能导致磁盘与网络争抢</span>
            </Row>
            <Row label="单服务器最大连接数">
              <div className="flex items-center border border-black/10 rounded-md bg-white overflow-hidden w-32">
                <input
                  type="number"
                  min={splitMin}
                  max={maxConnectionLimit}
                  value={maxConnectionsPerServer}
                  onChange={(e) => updateSetting('maxConnectionsPerServer', normalizeTaskConnections(toNumber(e.target.value, maxConnectionsPerServer), maxConnectionsPerServer, splitMin, maxConnectionLimit))}
                  className="flex-1 px-3 py-1.5 text-[13px] focus:outline-none"
                />
                <div className="flex flex-col border-l border-black/10 shrink-0">
                  <button
                    onClick={() => updateSetting('maxConnectionsPerServer', normalizeTaskConnections(maxConnectionsPerServer + 1, maxConnectionsPerServer, splitMin, maxConnectionLimit))}
                    className="px-2 border-b border-black/10 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    +
                  </button>
                  <button
                    onClick={() => updateSetting('maxConnectionsPerServer', normalizeTaskConnections(maxConnectionsPerServer - 1, maxConnectionsPerServer, splitMin, maxConnectionLimit))}
                    className="px-2 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    -
                  </button>
                </div>
              </div>
              <span className="text-[12px] text-text-muted ml-2">aria2 可用范围：{splitMin}-{maxConnectionLimit}，单任务实际有效连接上限 = min(分片数, 单服务器最大连接数)</span>
            </Row>
            <Row label="新建任务默认分片数">
              <div className="flex items-center border border-black/10 rounded-md bg-white overflow-hidden w-32">
                <input
                  type="number"
                  min={splitMin}
                  max={splitMax}
                  value={defaultSplitCount}
                  onChange={(e) => updateSetting('defaultSplitCount', normalizeDefaultSplitCount(toNumber(e.target.value, defaultSplitCount), defaultSplitCount, splitMin, splitMax))}
                  className="flex-1 px-3 py-1.5 text-[13px] focus:outline-none"
                />
                <div className="flex flex-col border-l border-black/10 shrink-0">
                  <button
                    onClick={() => updateSetting('defaultSplitCount', normalizeDefaultSplitCount(defaultSplitCount + 1, defaultSplitCount, splitMin, splitMax))}
                    className="px-2 border-b border-black/10 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    +
                  </button>
                  <button
                    onClick={() => updateSetting('defaultSplitCount', normalizeDefaultSplitCount(defaultSplitCount - 1, defaultSplitCount, splitMin, splitMax))}
                    className="px-2 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    -
                  </button>
                </div>
              </div>
              <span className="text-[12px] text-text-muted ml-2">新建任务默认值，实际值会按引擎约束校正</span>
            </Row>
            {/* 重连配置：应对大文件下载中后期速度衰减 */}
            <Row label="重连冷却（秒）">
              <div className="flex items-center border border-black/10 rounded-md bg-white overflow-hidden w-32">
                <input
                  type="number"
                  min={10}
                  max={600}
                  value={reconnectCooldownSeconds}
                  onChange={(e) => {
                    const val = Math.min(600, Math.max(10, toNumber(e.target.value, reconnectCooldownSeconds)));
                    updateSetting('reconnectCooldownSeconds', val);
                  }}
                  className="flex-1 px-3 py-1.5 text-[13px] focus:outline-none"
                />
                <div className="flex flex-col border-l border-black/10 shrink-0">
                  <button
                    onClick={() => updateSetting('reconnectCooldownSeconds', Math.min(600, reconnectCooldownSeconds + 10))}
                    className="px-2 border-b border-black/10 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    +
                  </button>
                  <button
                    onClick={() => updateSetting('reconnectCooldownSeconds', Math.max(10, reconnectCooldownSeconds - 10))}
                    className="px-2 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    -
                  </button>
                </div>
              </div>
              <span className="text-[12px] text-text-muted ml-2">同一任务两次重连的最小间隔，避免频繁 pause→start 刺激源站</span>
            </Row>
            <Row label="速度衰减阈值（KB/s）">
              <div className="flex items-center border border-black/10 rounded-md bg-white overflow-hidden w-32">
                <input
                  type="number"
                  min={10}
                  max={1000}
                  value={reconnectSpeedThresholdKB}
                  onChange={(e) => {
                    const val = Math.min(1000, Math.max(10, toNumber(e.target.value, reconnectSpeedThresholdKB)));
                    updateSetting('reconnectSpeedThresholdKB', val);
                  }}
                  className="flex-1 px-3 py-1.5 text-[13px] focus:outline-none"
                />
                <div className="flex flex-col border-l border-black/10 shrink-0">
                  <button
                    onClick={() => updateSetting('reconnectSpeedThresholdKB', Math.min(1000, reconnectSpeedThresholdKB + 10))}
                    className="px-2 border-b border-black/10 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    +
                  </button>
                  <button
                    onClick={() => updateSetting('reconnectSpeedThresholdKB', Math.max(10, reconnectSpeedThresholdKB - 10))}
                    className="px-2 hover:bg-black/5 text-[10px] leading-none py-0.5 cursor-pointer"
                  >
                    -
                  </button>
                </div>
              </div>
              <span className="text-[12px] text-text-muted ml-2">速度持续低于此值时建议重连，对应任务详情页曲线红线位置</span>
            </Row>
            <div className="mt-6">
              <Checkbox checked={resumeBreakpoint} onChange={(val) => updateSetting('resumeBreakpoint', val)} label="断点续传" />
            </div>
          </Section>

          <Section title="通知与确认">
            <Row label="当前策略">
              <span className="text-[12px] text-text-muted">{notifyConfirmPolicyText}</span>
            </Row>
            <Row label="快捷预设">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleApplyNotifyPreset('quiet')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  安静
                </button>
                <button
                  onClick={() => handleApplyNotifyPreset('standard')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  标准
                </button>
                <button
                  onClick={() => handleApplyNotifyPreset('safe')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  严格确认
                </button>
              </div>
            </Row>
            <div className="space-y-4">
              <Checkbox checked={jumpToDownload} onChange={(val) => updateSetting('jumpToDownload', val)} label="新建任务后自动跳转到下载页" />
              <Checkbox checked={notifyOnComplete} onChange={(val) => updateSetting('notifyOnComplete', val)} label="下载完成后通知" />
              <Checkbox checked={noConfirmOnDelete} onChange={(val) => updateSetting('noConfirmOnDelete', val)} label="删除任务时不再确认" />
            </div>
          </Section>

          <Section title="自动清理">
            <Row label="当前策略">
              <span className="text-[12px] text-text-muted">{autoCleanPolicyText}</span>
            </Row>
            <Row label="快捷预设">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleApplyAutoCleanPreset('safe')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  保留优先
                </button>
                <button
                  onClick={() => handleApplyAutoCleanPreset('balanced')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  均衡清理
                </button>
                <button
                  onClick={() => handleApplyAutoCleanPreset('strict')}
                  className="px-3 py-1 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[12px] text-text-main transition-colors cursor-pointer"
                >
                  严格清理
                </button>
              </div>
            </Row>
            <div className="space-y-4">
              <Checkbox checked={deleteTorrentOnComplete} onChange={(val) => updateSetting('deleteTorrentOnComplete', val)} label="下载完成后删除种子文件" />
              <Checkbox checked={deleteRecordOnMissing} onChange={(val) => updateSetting('deleteRecordOnMissing', val)} label="本地文件丢失时自动删除记录" />
            </div>
          </Section>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-main via-main to-transparent flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <button
            onClick={handleApply}
            className="px-6 py-2 bg-[#e5a038] hover:bg-[#d49028] text-white rounded-md text-[13px] transition-colors shadow-sm cursor-pointer"
          >
            保存并应用
          </button>
          <button
            onClick={handleDiscard}
            className="px-6 py-2 bg-white border border-black/10 hover:bg-black/5 text-text-main rounded-md text-[13px] transition-colors shadow-sm cursor-pointer"
          >
            放弃
          </button>
          <button
            onClick={() => setShowRestartModal(true)}
            disabled={restarting}
            className="flex items-center gap-2 px-5 py-2 bg-transparent border border-[#d29035] text-[#d29035] hover:bg-[#d29035]/5 rounded-md text-[13px] transition-colors shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw size={14} className={restarting ? 'animate-spin' : ''} />
            {restarting ? '更新中...' : '更新并重启 aria2 引擎'}
          </button>
        </div>
        <div className="pointer-events-auto">
          <button
            onClick={handleCheckUpdateNow}
            className="w-10 h-10 flex items-center justify-center rounded-full border border-black/10 bg-white hover:bg-black/5 text-text-muted transition-colors shadow-sm cursor-pointer"
          >
            <Gauge size={18} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      {toastList.length > 0 &&
        createPortal(
          <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[70] flex flex-col gap-2">
            {toastList.map((item) => (
              <div key={item.id} className="min-w-[230px] h-[40px] px-4 rounded-[10px] bg-white border border-black/5 shadow-lg flex items-center justify-between">
                <div className="flex items-center gap-3 text-[13px] text-text-main">
                  {item.type === 'info' ? (
                    <div className="w-4 h-4 rounded-full bg-[#3b82f6] flex items-center justify-center shrink-0">
                      <span className="text-white text-[11px] font-bold leading-none italic">i</span>
                    </div>
                  ) : null}
                  {item.type === 'warning' ? (
                    <div className="w-4 h-4 rounded-full bg-[#f5a524] flex items-center justify-center shrink-0">
                      <span className="text-white text-[11px] font-bold leading-none">!</span>
                    </div>
                  ) : null}
                  {item.type === 'success' ? (
                    <div className="w-4 h-4 rounded-full bg-[#10b981] flex items-center justify-center shrink-0">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    </div>
                  ) : null}
                  <span>{item.text}</span>
                </div>
                <button
                  className="text-text-muted hover:text-text-main cursor-pointer"
                  onClick={() => dismissToast(item.id)}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>,
          document.body
        )}
      {showRestartModal &&
        createPortal(
          <div className="fixed inset-0 z-[65] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/35" onClick={() => (restarting ? null : setShowRestartModal(false))} />
            <div className="relative w-[400px] bg-[#f9f9f9] rounded-xl shadow-2xl border border-black/5 px-6 py-6">
              <button
                className="absolute top-4 right-4 text-text-muted hover:text-text-main transition-colors cursor-pointer"
                onClick={() => setShowRestartModal(false)}
              >
                <X size={18} />
              </button>
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-5 h-5 rounded-full bg-[#f5a524] flex items-center justify-center shrink-0">
                  <span className="text-white text-[14px] font-bold leading-none">!</span>
                </div>
                <h3 className="text-[16px] text-text-main">
                  更新并重启 <strong>aria2</strong> 引擎
                </h3>
              </div>
              <p className="text-[13px] text-text-main/80 mb-6 leading-relaxed">
                将尝试下载并更新最新 aria2，然后重启下载引擎。进行中的下载会短暂中断，随后自动恢复。
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowRestartModal(false)}
                  className="px-5 py-1.5 rounded-md border border-black/10 text-text-main bg-white hover:bg-black/5 text-[13px] transition-colors cursor-pointer shadow-sm"
                >
                  稍后
                </button>
                <button
                  onClick={() => void handleRestartEngine()}
                  disabled={restarting}
                  className="px-5 py-1.5 rounded-md bg-[#f5a524] hover:bg-[#e5981f] text-white text-[13px] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
                >
                  {restarting && <RefreshCw size={14} className="animate-spin" />}
                  立即更新并重启
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      <UpdateModal
        isOpen={isUpdateModalOpen}
        updateInfo={latestUpdateInfo}
        onClose={() => setIsUpdateModalOpen(false)}
      />
      <Aria2UpdateProgressModal
        isOpen={engineUpdateModalVisible}
        status={engineUpdateModal.status}
        title={engineUpdateModal.title}
        detail={engineUpdateModal.detail}
        onClose={() => setEngineUpdateModalVisible(false)}
      />
    </div>
  );
}

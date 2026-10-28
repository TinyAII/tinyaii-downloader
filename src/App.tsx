import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Navigate, useNavigate } from 'react-router-dom';
import { getCurrentWindow } from '@tauri-apps/api/window';
import Sidebar from './components/layout/Sidebar';
import TaskSidebar from './components/layout/TaskSidebar';
import TitleBar from './components/layout/TitleBar';
import { appExit, appIsAutostartLaunch } from './services/app/appRuntime';
import { checkVersionUpdate } from './services/app/backendApi';
import { appGetInstallDir, appHttpGetText, aria2SetGlobalSpeedLimit, aria2SetGlobalTrackerList, aria2StartTask } from './services/download/aria2RpcEngine';
import { captureWindowState, restoreWindowState } from './services/app/windowState';
import { useBasicSettingsStore } from './store/settings/basicStore';
import { useAdvancedSettingsStore } from './store/settings/advancedStore';
import { writeDeveloperLog } from './store/developerLogStore';
import { useTaskStore } from './store/tasks';
import type { CreateTaskPayload } from './types/task';
import {
  normalizeResumeBatchSize,
  pickTasksForStartupResume,
  splitTasksIntoBatches,
} from './utils/startupResume';
import {
  shouldMinimizeOnClose,
  shouldMinimizeOnLaunch,
  shouldRestoreWindowOnLaunch,
  shouldResumeTasksOnLaunch,
} from './utils/windowBehavior';
import { normalizeTrackerList, TRACKER_REMOTE_URLS } from './utils/trackerSources';

const SettingsSidebar = lazy(() => import('./pages/Settings/SettingsSidebar'));
const PluginsSidebar = lazy(() => import('./pages/Plugins/PluginsSidebar'));
const Downloading = lazy(() => import('./pages/Downloading'));
const Completed = lazy(() => import('./pages/Completed'));
const BasicSettings = lazy(() => import('./pages/Settings/BasicSettings'));
const AdvancedSettings = lazy(() => import('./pages/Settings/AdvancedSettings'));
const DeveloperLogs = lazy(() => import('./pages/Settings/DeveloperLogs'));
const InstalledPlugins = lazy(() => import('./pages/Plugins/InstalledPlugins'));
const DiscoverPlugins = lazy(() => import('./pages/Plugins/DiscoverPlugins'));
const ImportPlugins = lazy(() => import('./pages/Plugins/ImportPlugins'));
const PluginTutorial = lazy(() => import('./pages/Plugins/PluginTutorial'));
const PluginDetail = lazy(() => import('./pages/Plugins/PluginDetail'));
const PluginRuntimePage = lazy(() => import('./pages/Plugins/PluginRuntimePage'));
const NewTaskModal = lazy(() => import('./components/task/NewTaskModal'));
const AboutModal = lazy(() => import('./components/AboutModal'));
const UpdateModal = lazy(() => import('./components/UpdateModal'));

function toBytesPerSecond(value: number, unit: 'KB/s' | 'MB/s') {
  const normalizedValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (normalizedValue === 0) {
    return 0;
  }
  const multiplier = unit === 'MB/s' ? 1024 * 1024 : 1024;
  return Math.floor(normalizedValue * multiplier);
}

const suspenseFallback = (
  <div className="flex h-full items-center justify-center text-[13px] text-text-muted">
    正在加载...
  </div>
);

function InnerApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [latestUpdateInfo, setLatestUpdateInfo] = useState<Awaited<ReturnType<typeof checkVersionUpdate>> | null>(null);
  const jumpToDownload = useBasicSettingsStore((state) => state.jumpToDownload);
  const theme = useBasicSettingsStore((state) => state.theme);
  const defaultDownloadDir = useBasicSettingsStore((state) => state.defaultDownloadDir);
  const startupMinimize = useBasicSettingsStore((state) => state.startupMinimize);
  const startupAutoRun = useBasicSettingsStore((state) => state.startupAutoRun);
  const startupRestore = useBasicSettingsStore((state) => state.startupRestore);
  const startupResume = useBasicSettingsStore((state) => state.startupResume);
  const startupResumeMode = useBasicSettingsStore((state) => state.startupResumeMode);
  const maxConcurrentDownloads = useBasicSettingsStore((state) => state.maxConcurrentDownloads);
  const defaultSplitCount = useBasicSettingsStore((state) => state.defaultSplitCount);
  const maxConnectionsPerServer = useBasicSettingsStore((state) => state.maxConnectionsPerServer);
  const uploadLimitValue = useBasicSettingsStore((state) => state.uploadLimitValue);
  const uploadLimitUnit = useBasicSettingsStore((state) => state.uploadLimitUnit);
  const downloadLimitValue = useBasicSettingsStore((state) => state.downloadLimitValue);
  const downloadLimitUnit = useBasicSettingsStore((state) => state.downloadLimitUnit);
  const updateBasicSetting = useBasicSettingsStore((state) => state.updateBasicSetting);
  const showDeveloperLogsEntry = useAdvancedSettingsStore((state) => state.showDeveloperLogsEntry);
  const trackerList = useAdvancedSettingsStore((state) => state.trackerList);
  const trackerSource = useAdvancedSettingsStore((state) => state.trackerSource);
  const autoUpdateTracker = useAdvancedSettingsStore((state) => state.autoUpdateTracker);
  const createTasks = useTaskStore((state) => state.createTasks);
  const bootRuntime = useTaskStore((state) => state.bootRuntime);
  const refreshTasks = useTaskStore((state) => state.refreshTasks);
  
  const isSettings = location.pathname.startsWith('/settings');
  const isPlugins = location.pathname.startsWith('/plugins');

  useEffect(() => {
    bootRuntime();
  }, [bootRuntime]);

  useEffect(() => {
    if (defaultDownloadDir.trim()) {
      return;
    }
    let canceled = false;
    const syncDefaultDownloadDir = async () => {
      try {
        const installDir = await appGetInstallDir();
        if (canceled || !installDir.trim()) {
          return;
        }
        if (!useBasicSettingsStore.getState().defaultDownloadDir.trim()) {
          updateBasicSetting('defaultDownloadDir', installDir);
        }
      } catch (error) {
        if (canceled) return;
        writeDeveloperLog({
          source: 'app',
          action: 'sync_default_download_dir',
          level: 'warn',
          message: String(error),
        });
      }
    };
    void syncDefaultDownloadDir();
    return () => {
      canceled = true;
    };
  }, [defaultDownloadDir, updateBasicSetting]);

  useEffect(() => {
    let canceled = false;
    const runUpdateCheck = async () => {
      try {
        const result = await checkVersionUpdate();
        if (canceled) return;
        useBasicSettingsStore.getState().updateBasicSetting('lastUpdateCheckAt', new Date().toISOString());
        if (result.hasUpdate) {
          setLatestUpdateInfo(result);
          setIsUpdateModalOpen(true);
          writeDeveloperLog({
            source: 'app',
            action: 'version_check',
            level: 'info',
            message: `检测到新版本 ${result.latestVersion}`,
          });
        }
      } catch (error) {
        if (canceled) return;
        writeDeveloperLog({
          source: 'app',
          action: 'version_check',
          level: 'warn',
          message: String(error),
        });
      }
    };
    void runUpdateCheck();
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolvedTheme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      root.setAttribute('data-theme', resolvedTheme);
    };
    applyTheme();
    if (theme !== 'system') {
      return;
    }
    const handleMediaChange = () => applyTheme();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleMediaChange);
      return () => media.removeEventListener('change', handleMediaChange);
    }
    media.addListener(handleMediaChange);
    return () => media.removeListener(handleMediaChange);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('theme-animating');
    const timer = window.setTimeout(() => {
      root.classList.remove('theme-animating');
    }, 220);
    return () => {
      window.clearTimeout(timer);
      root.classList.remove('theme-animating');
    };
  }, [theme]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    const registerCloseHandler = async () => {
      unlisten = await appWindow.onCloseRequested((event) => {
        event.preventDefault();
        const shouldMinimize = shouldMinimizeOnClose(useBasicSettingsStore.getState().minimizeToTray);
        if (shouldMinimize) {
          void appWindow.minimize();
          return;
        }
        void appExit();
      });
    };
    void registerCloseHandler();
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    const shouldRestore = shouldRestoreWindowOnLaunch(startupRestore);
    if (!shouldRestore) return;
    const appWindow = getCurrentWindow();
    void restoreWindowState(appWindow);
  }, [startupRestore]);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlistenMoved: (() => void) | undefined;
    let unlistenResized: (() => void) | undefined;
    const registerWindowTracking = async () => {
      unlistenMoved = await appWindow.onMoved(() => {
        void captureWindowState(appWindow);
      });
      unlistenResized = await appWindow.onResized(() => {
        void captureWindowState(appWindow);
      });
    };
    void registerWindowTracking();
    return () => {
      if (unlistenMoved) {
        unlistenMoved();
      }
      if (unlistenResized) {
        unlistenResized();
      }
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    const appWindow = getCurrentWindow();
    const applyStartupBehavior = async () => {
      const isAutostartLaunch = await appIsAutostartLaunch();
      if (canceled) return;
      const shouldMinimize = shouldMinimizeOnLaunch({
        startupMinimize,
        startupAutoRun,
        isAutostartLaunch,
      });
      if (!shouldMinimize) return;
      void appWindow.minimize();
    };
    void applyStartupBehavior();
    return () => {
      canceled = true;
    };
  }, [startupMinimize, startupAutoRun]);

  useEffect(() => {
    const shouldResume = shouldResumeTasksOnLaunch(startupResume);
    if (!shouldResume) return;
    let canceled = false;
    const resumeTasks = async () => {
      await refreshTasks();
      if (canceled) return;
      const tasks = useTaskStore.getState().tasks;
      const targetTasks = pickTasksForStartupResume(tasks, startupResumeMode);
      const batchSize = normalizeResumeBatchSize(maxConcurrentDownloads);
      const batches = splitTasksIntoBatches(targetTasks, batchSize);
      for (const batch of batches) {
        if (canceled) return;
        await Promise.all(
          batch.map((task) =>
            aria2StartTask(task.id, {
              splitCount: task.requestedSplitCount ?? defaultSplitCount,
              maxConnectionPerServer: task.requestedMaxConnectionsPerServer ?? maxConnectionsPerServer,
            })
          )
        );
      }
      await refreshTasks();
    };
    void resumeTasks();
    return () => {
      canceled = true;
    };
  }, [defaultSplitCount, maxConcurrentDownloads, maxConnectionsPerServer, refreshTasks, startupResume, startupResumeMode]);

  useEffect(() => {
    let canceled = false;
    const timer = window.setTimeout(() => {
      const syncSpeedLimit = async () => {
        try {
          await aria2SetGlobalSpeedLimit({
            uploadLimitBytes: toBytesPerSecond(uploadLimitValue, uploadLimitUnit),
            downloadLimitBytes: toBytesPerSecond(downloadLimitValue, downloadLimitUnit),
          });
        } catch (error) {
          if (canceled) return;
          writeDeveloperLog({
            source: 'app',
            action: 'sync_speed_limit',
            level: 'warn',
            message: String(error),
          });
        }
      };
      void syncSpeedLimit();
    }, 250);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [downloadLimitUnit, downloadLimitValue, uploadLimitUnit, uploadLimitValue]);

  useEffect(() => {
    let canceled = false;
    const timer = window.setTimeout(() => {
      const syncTrackerList = async () => {
        try {
          await aria2SetGlobalTrackerList(trackerList);
        } catch (error) {
          if (canceled) return;
          writeDeveloperLog({
            source: 'app',
            action: 'sync_tracker_list',
            level: 'warn',
            message: String(error),
          });
        }
      };
      void syncTrackerList();
    }, 250);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [trackerList]);

  useEffect(() => {
    const remoteUrls = TRACKER_REMOTE_URLS[trackerSource] ?? [];
    if (!autoUpdateTracker || remoteUrls.length === 0) {
      return;
    }
    let canceled = false;
    let timer: number | undefined;
    const syncRemoteTrackerList = async () => {
      for (const url of remoteUrls) {
        try {
          const text = await appHttpGetText(url);
          if (canceled) return;
          const normalized = normalizeTrackerList(text);
          useAdvancedSettingsStore.getState().updateAdvancedSetting('trackerList', normalized);
          writeDeveloperLog({
            source: 'app',
            action: 'auto_sync_tracker_list',
            level: 'info',
            message: `Tracker 已同步：${trackerSource}`,
          });
          return;
        } catch (error) {
          if (canceled) return;
          writeDeveloperLog({
            source: 'app',
            action: 'auto_sync_tracker_list',
            level: 'warn',
            message: `${url} -> ${String(error)}`,
          });
        }
      }
    };
    void syncRemoteTrackerList();
    timer = window.setInterval(() => {
      void syncRemoteTrackerList();
    }, 12 * 60 * 60 * 1000);
    return () => {
      canceled = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
    };
  }, [autoUpdateTracker, trackerSource]);

  const handleCreateTasks = async (payload: CreateTaskPayload) => {
    const createdCount = await createTasks(payload);
    if (createdCount > 0) {
      setIsNewTaskModalOpen(false);
      if (jumpToDownload) {
        navigate('/');
      }
    }
    return createdCount;
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-main">
      {/* 最左侧工具栏 */}
      <Sidebar 
        onNewTask={() => setIsNewTaskModalOpen(true)} 
        onOpenAbout={() => setIsAboutModalOpen(true)}
      />
      
      {/* 任务列表侧边栏 或 设置侧边栏 或 扩展侧边栏 */}
      {isSettings ? (
        <Suspense fallback={suspenseFallback}>
          <SettingsSidebar />
        </Suspense>
      ) : isPlugins ? (
        <Suspense fallback={suspenseFallback}>
          <PluginsSidebar />
        </Suspense>
      ) : (
        <TaskSidebar />
      )}
      
      {/* 主内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        <TitleBar />
        
        <main className="flex-1 overflow-hidden relative">
          <Suspense fallback={suspenseFallback}>
            <Routes>
              <Route path="/" element={<Downloading onNewTask={() => setIsNewTaskModalOpen(true)} />} />
              <Route path="/completed" element={<Completed onNewTask={() => setIsNewTaskModalOpen(true)} />} />
              <Route path="/settings" element={<Navigate to="/settings/basic" replace />} />
              <Route path="/settings/basic" element={<BasicSettings />} />
              <Route path="/settings/advanced" element={<AdvancedSettings />} />
              <Route
                path="/settings/developer-logs"
                element={showDeveloperLogsEntry ? <DeveloperLogs /> : <Navigate to="/settings/advanced" replace />}
              />
              <Route path="/plugins" element={<Navigate to="/plugins/installed" replace />} />
              <Route path="/plugins/installed" element={<InstalledPlugins />} />
              <Route path="/plugins/discover" element={<DiscoverPlugins />} />
              <Route path="/plugins/import" element={<ImportPlugins />} />
              <Route path="/plugins/tutorial" element={<PluginTutorial />} />
              <Route path="/plugins/detail/:pluginId" element={<PluginDetail />} />
              <Route path="/plugins/runtime/:entryKey" element={<PluginRuntimePage />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      
      {/* 全局弹窗 */}
      <Suspense fallback={null}>
        <NewTaskModal 
          isOpen={isNewTaskModalOpen} 
          onClose={() => setIsNewTaskModalOpen(false)}
          onCreateTasks={handleCreateTasks}
        />
        
        <AboutModal
          isOpen={isAboutModalOpen}
          onClose={() => setIsAboutModalOpen(false)}
        />
        <UpdateModal
          isOpen={isUpdateModalOpen}
          updateInfo={latestUpdateInfo}
          onClose={() => setIsUpdateModalOpen(false)}
        />
      </Suspense>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <InnerApp />
    </BrowserRouter>
  );
}

export default App;

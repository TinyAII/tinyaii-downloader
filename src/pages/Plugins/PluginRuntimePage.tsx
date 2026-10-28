import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { openPath } from '@tauri-apps/plugin-opener';
import { ExternalLink, Package } from 'lucide-react';
import { usePluginStore } from '../../store/plugins';
import { useTaskStore } from '../../store/tasks';
import { useBasicSettingsStore } from '../../store/settings/basicStore';
import { useAdvancedSettingsStore } from '../../store/settings/advancedStore';
import {
  appCollectWebviewCookies,
  appHttpGetJson,
  appHttpRequestJson,
  appOpenPluginWebview,
  pluginReadRuntimeScript,
} from '../../services/plugin/pluginRpcEngine';
import { formatBytes } from '../../utils/format';
import type { CreateTaskPayload } from '../../types/task';

type RuntimeCapability =
  | 'openPath'
  | 'openWebview'
  | 'collectCookies'
  | 'httpGetJson'
  | 'httpRequestJson'
  | 'createDownloadTask';

type PluginDownloadTaskRequest = {
  url: string;
  filename?: string;
  savePath?: string;
  splitCount?: number;
  maxConnectionsPerServer?: number;
  userAgent?: string;
  referer?: string;
  cookie?: string;
  authorization?: string;
  proxy?: string;
};

type PluginApi = {
  pluginId: string;
  pluginName: string;
  apiVersion: string;
  supportedCapabilities: RuntimeCapability[];
  isCapabilityGranted: (capability: RuntimeCapability) => boolean;
  requestCapability: (capability: RuntimeCapability) => Promise<boolean>;
  openPath: (path: string) => Promise<void>;
  openWebview: (windowLabel: string, url: string, title?: string) => Promise<void>;
  collectCookies: (windowLabel: string, domainKeyword?: string) => Promise<Array<{ name: string; value: string }>>;
  httpGetJson: (url: string, headers?: Record<string, string>) => Promise<Record<string, unknown>>;
  httpRequestJson: (
    method: string,
    url: string,
    headers?: Record<string, string>,
    body?: Record<string, unknown>
  ) => Promise<Record<string, unknown>>;
  createDownloadTask: (request: PluginDownloadTaskRequest) => Promise<number>;
};

type PluginMount = (root: HTMLElement, api: PluginApi) => void | (() => void) | Promise<void | (() => void)>;

const RUNTIME_API_VERSION = '1.2.0';
const RUNTIME_CAPABILITIES: RuntimeCapability[] = [
  'openPath',
  'openWebview',
  'collectCookies',
  'httpGetJson',
  'httpRequestJson',
  'createDownloadTask',
];

function normalizePath(value: string) {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  return `/${trimmed}`;
}

export default function PluginRuntimePage() {
  const location = useLocation();
  const installed = usePluginStore((state) => state.installed);
  const mountContainerRef = useRef<HTMLDivElement | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const currentPath = normalizePath(location.pathname);
  const plugin = useMemo(
    () =>
      installed.find(
        (item) =>
          item.enabled &&
          item.menuEnabled &&
          !!item.menuRoutePath &&
          normalizePath(item.menuRoutePath) === currentPath
      ),
    [currentPath, installed]
  );

  useEffect(() => {
    if (!plugin) return;
    let disposed = false;
    let cleanup: void | (() => void);
    const ensureCapability = async (capability: RuntimeCapability) => RUNTIME_CAPABILITIES.includes(capability);
    const mountPlugin = async () => {
      const container = mountContainerRef.current;
      if (!container) return;
      setRuntimeError('');
      setRuntimeLoading(true);
      container.innerHTML = '';
      try {
        if (!plugin.packagePath?.trim()) {
          throw new Error('插件包路径为空，无法挂载运行时');
        }
        const scriptText = await pluginReadRuntimeScript(plugin.packagePath);
        if (!scriptText.trim()) {
          throw new Error('插件脚本为空');
        }
        const bridge: { mount?: PluginMount } = {};
        const registerMount = (mount: PluginMount) => {
          bridge.mount = mount;
        };
        const runtimeApi: PluginApi = {
          pluginId: plugin.id,
          pluginName: plugin.name,
          apiVersion: RUNTIME_API_VERSION,
          supportedCapabilities: RUNTIME_CAPABILITIES,
          isCapabilityGranted: (capability) => RUNTIME_CAPABILITIES.includes(capability),
          requestCapability: ensureCapability,
          openPath: async (path) => openPath(path),
          openWebview: async (windowLabel, url, title) => appOpenPluginWebview(windowLabel, url, title),
          collectCookies: async (windowLabel, domainKeyword) => {
            const cookies = await appCollectWebviewCookies(windowLabel, domainKeyword);
            return cookies.map((item) => ({ name: item.name, value: item.value }));
          },
          httpGetJson: async (url, headers) => appHttpGetJson(url, headers),
          httpRequestJson: async (method, url, headers, body) => appHttpRequestJson(method, url, headers, body),
          createDownloadTask: async (request) => {
            const link = request.url?.trim();
            if (!link) {
              throw new Error('创建下载任务失败：url 不能为空');
            }
            const basic = useBasicSettingsStore.getState();
            const advanced = useAdvancedSettingsStore.getState();
            const payload: CreateTaskPayload = {
              type: 'link',
              links: [link],
              rename: request.filename?.trim() || '',
              splitCount: request.splitCount ?? basic.defaultSplitCount,
              maxConnectionsPerServer: request.maxConnectionsPerServer ?? basic.maxConnectionsPerServer,
              savePath: request.savePath?.trim() || basic.defaultDownloadDir,
              advanced: {
                userAgent: request.userAgent?.trim() || advanced.userAgent,
                authorization: request.authorization?.trim() || '',
                referer: request.referer?.trim() || '',
                cookie: request.cookie?.trim() || '',
                proxy: request.proxy?.trim() || '',
              },
            };
            return useTaskStore.getState().createTasks(payload);
          },
        };
        const runner = new Function('registerMount', 'api', scriptText);
        runner(registerMount, runtimeApi);
        if (!bridge.mount) {
          throw new Error('插件脚本未注册 mount 方法');
        }
        const result = await bridge.mount(container, runtimeApi);
        cleanup = result || undefined;
      } catch (error) {
        if (disposed) return;
        setRuntimeError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!disposed) {
          setRuntimeLoading(false);
        }
      }
    };
    void mountPlugin();
    return () => {
      disposed = true;
      if (cleanup) {
        cleanup();
      }
    };
  }, [plugin]);

  if (!plugin) {
    return (
      <div className="flex-1 flex items-center justify-center bg-main">
        <div className="text-sm text-text-muted">插件入口不存在或未启用</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-main overflow-hidden">
      <div className="px-8 py-4 border-b border-black/5 flex items-center justify-between">
        <h1 className="text-xl font-medium text-text-main">{plugin.menuTitle || plugin.name}</h1>
        <div className="text-[12px] text-text-muted">
          {plugin.author} · v{plugin.version}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="bg-white border border-black/5 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-lg bg-black/5 flex items-center justify-center text-text-muted shrink-0">
                <Package size={20} />
              </div>
              <div>
                <div className="text-base font-medium text-text-main">{plugin.name}</div>
                <div className="text-sm text-text-muted mt-1">{plugin.description}</div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-black/5 rounded-xl p-5">
            <div ref={mountContainerRef} className="min-h-[280px]" />
            {runtimeLoading ? <div className="text-[12px] text-text-muted mt-3">插件运行时加载中...</div> : null}
            {runtimeError ? (
              <div className="text-[12px] text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 mt-3">
                插件运行失败：{runtimeError}
              </div>
            ) : null}
            <div className="mt-4 flex items-center gap-2">
              {plugin.homepage ? (
                <button
                  onClick={() => void openPath(plugin.homepage ?? '')}
                  className="h-8 px-3 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <ExternalLink size={14} />
                  插件主页
                </button>
              ) : null}
            </div>
            <div className="mt-4 text-[12px] text-text-muted">
              插件包大小：{formatBytes(plugin.packageSizeBytes ?? 0)} · 路由：{plugin.menuRoutePath || '未配置'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

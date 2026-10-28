import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { openPath } from '@tauri-apps/plugin-opener';
import { ExternalLink, FolderOpen, Package, ArrowLeft } from 'lucide-react';
import { formatBytes } from '../../utils/format';
import { usePluginStore } from '../../store/plugins';

function formatTime(timestamp: number | null | undefined) {
  if (!timestamp) return '未知';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function buildMetaRows(plugin: ReturnType<typeof usePluginStore.getState>['installed'][number]) {
  return [
    { label: '插件名称', value: plugin.name },
    { label: '插件标识', value: plugin.id },
    { label: '作者', value: plugin.author },
    { label: '版本', value: plugin.version },
    { label: '来源', value: (plugin.sourceType ?? 'market') === 'local' ? '本地导入' : '扩展市场' },
    { label: '授权协议', value: plugin.license || '未声明' },
    { label: '安装时间', value: formatTime(plugin.installedAt) },
    { label: '包体大小', value: formatBytes(plugin.packageSizeBytes ?? 0) },
    { label: '菜单注入', value: plugin.menuEnabled ? `已启用（${plugin.menuTitle ?? plugin.name}）` : '未启用' },
    { label: '菜单路由', value: plugin.menuRoutePath || '未配置' },
  ];
}

export default function PluginDetail() {
  const { pluginId } = useParams();
  const installed = usePluginStore((state) => state.installed);
  const refreshInstalled = usePluginStore((state) => state.refreshInstalled);
  const decodedId = decodeURIComponent(pluginId ?? '');
  const plugin = useMemo(() => installed.find((item) => item.id === decodedId), [decodedId, installed]);

  useEffect(() => {
    if (!plugin) {
      void refreshInstalled();
    }
  }, [plugin, refreshInstalled]);

  if (!plugin) {
    return (
      <div className="flex-1 flex items-center justify-center bg-main">
        <div className="text-sm text-text-muted">插件不存在或已被卸载</div>
      </div>
    );
  }

  const metaRows = buildMetaRows(plugin);

  return (
    <div className="flex-1 flex flex-col h-full bg-main overflow-hidden">
      <div className="flex items-center justify-between px-8 py-4 border-b border-black/5">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to="/plugins/installed"
            className="h-8 px-3 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <ArrowLeft size={14} />
            返回
          </Link>
          <h1 className="text-xl font-medium text-text-main truncate">扩展详情</h1>
        </div>
        <div className="flex items-center gap-2">
          {plugin.homepage ? (
            <button
              onClick={() => void openPath(plugin.homepage ?? '')}
              className="h-8 px-3 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <ExternalLink size={14} />
              打开主页
            </button>
          ) : null}
          {plugin.packagePath ? (
            <button
              onClick={() => void openPath(plugin.packagePath ?? '')}
              className="h-8 px-3 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <FolderOpen size={14} />
              打开插件文件
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="bg-white border border-black/5 rounded-xl p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-black/5 flex items-center justify-center text-text-muted shrink-0">
                <Package size={22} />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-medium text-text-main">{plugin.name}</div>
                <div className="text-sm text-text-muted mt-1">{plugin.description}</div>
              </div>
            </div>
          </div>

          <div className="bg-white border border-black/5 rounded-xl p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {metaRows.map((item) => (
              <div key={item.label} className="rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2">
                <div className="text-[12px] text-text-muted">{item.label}</div>
                <div className="text-[13px] text-text-main mt-1 break-all">{item.value}</div>
              </div>
            ))}
            {plugin.repository ? (
              <div className="rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 md:col-span-2">
                <div className="text-[12px] text-text-muted">仓库地址</div>
                <div className="text-[13px] text-text-main mt-1 break-all">{plugin.repository}</div>
              </div>
            ) : null}
            <div className="rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 md:col-span-2">
              <div className="text-[12px] text-text-muted">清单文件</div>
              <div className="text-[13px] text-text-main mt-1 break-all">{plugin.manifestPath || '未记录'}</div>
            </div>
            <div className="rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 md:col-span-2">
              <div className="text-[12px] text-text-muted">插件包文件</div>
              <div className="text-[13px] text-text-main mt-1 break-all">{plugin.packagePath || '未记录'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

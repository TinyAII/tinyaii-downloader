import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Puzzle, Trash2, Power, CircleEllipsis } from 'lucide-react';
import { cn } from '../../utils/cn';
import { usePluginStore } from '../../store/plugins';

export default function InstalledPlugins() {
  const installed = usePluginStore((state) => state.installed);
  const loading = usePluginStore((state) => state.loading);
  const refreshInstalled = usePluginStore((state) => state.refreshInstalled);
  const togglePluginEnabled = usePluginStore((state) => state.togglePluginEnabled);
  const uninstallPlugin = usePluginStore((state) => state.uninstallPlugin);

  useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  return (
    <div className="flex-1 flex flex-col h-full bg-main overflow-hidden">
      <div className="flex items-center justify-between px-8 py-4 border-b border-black/5">
        <h1 className="text-xl font-medium text-text-main">已安装扩展</h1>
        <div className="flex items-center gap-3">
          <div className="text-sm text-text-muted">
            {loading ? '加载中...' : `共 ${installed.length} 个扩展`}
          </div>
          <Link
            to="/plugins/import"
            className="px-3 py-1.5 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer"
          >
            导入本地扩展
          </Link>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-8">
        {installed.length === 0 ? (
          <div className="max-w-4xl mx-auto py-16 text-center text-text-muted text-sm">
            暂无已安装扩展
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-4">
            {installed.map((plugin) => (
            <div 
              key={plugin.id} 
              className={cn(
                "bg-white border border-black/5 rounded-xl p-5 flex items-start gap-4 transition-all",
                !plugin.enabled && "opacity-60"
              )}
            >
              <div className="w-12 h-12 rounded-lg bg-black/5 flex items-center justify-center flex-shrink-0 text-text-muted">
                <Puzzle size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-base font-medium text-text-main truncate">{plugin.name}</h3>
                  <span className="text-[12px] text-text-muted bg-black/5 px-2 py-0.5 rounded-full">
                    v{plugin.version}
                  </span>
                  <span className="text-[12px] text-text-muted bg-black/5 px-2 py-0.5 rounded-full">
                    {(plugin.sourceType ?? 'market') === 'local' ? '本地' : '市场'}
                  </span>
                  {plugin.menuEnabled ? (
                    <span className="text-[12px] text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                      菜单入口
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-text-muted mb-2 line-clamp-2">
                  {plugin.description}
                </p>
                <div className="text-[12px] text-text-muted">
                  由 {plugin.author} 提供
                </div>
              </div>
              
              <div className="flex items-center gap-2 ml-4">
                <Link
                  to={`/plugins/detail/${encodeURIComponent(plugin.id)}`}
                  className="p-2 rounded-lg text-text-muted hover:bg-black/5 transition-colors cursor-pointer"
                  title="查看详情"
                >
                  <CircleEllipsis size={18} />
                </Link>
                <button 
                  className={cn(
                    "p-2 rounded-lg transition-colors cursor-pointer",
                    plugin.enabled 
                      ? "text-primary hover:bg-primary/10" 
                      : "text-text-muted hover:bg-black/5"
                  )}
                  title={plugin.enabled ? "禁用" : "启用"}
                  onClick={() => void togglePluginEnabled(plugin.id)}
                >
                  <Power size={18} />
                </button>
                <button
                  className="p-2 rounded-lg text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                  onClick={() => void uninstallPlugin(plugin.id)}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Puzzle } from 'lucide-react';
import { usePluginStore } from '../../store/plugins';
import { cn } from '../../utils/cn';

function normalizePath(value: string | null | undefined) {
  if (!value) return '';
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  return `/${trimmed}`;
}

export default function PluginRuntimeSidebar() {
  const location = useLocation();
  const installed = usePluginStore((state) => state.installed);
  const pluginMenus = useMemo(
    () =>
      installed.filter(
        (item) => item.enabled && item.menuEnabled && !!item.menuRoutePath && !!(item.menuTitle || item.name)
      ),
    [installed]
  );

  return (
    <div className="w-56 h-screen bg-task-sidebar border-r border-black/5 flex flex-col select-none pt-8">
      <div className="px-6 mb-8 text-lg font-medium text-text-main">插件菜单</div>
      <nav className="flex-1 px-4 space-y-1">
        {pluginMenus.length === 0 ? (
          <div className="px-3 py-2 text-[13px] text-text-muted">暂无可用插件入口</div>
        ) : (
          pluginMenus.map((item) => {
            const path = normalizePath(item.menuRoutePath);
            const isActive = normalizePath(location.pathname) === path;
            return (
              <Link
                key={item.id}
                to={path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[15px] transition-colors cursor-pointer",
                  isActive ? "bg-black/5 text-primary font-medium" : "text-text-main hover:bg-black/5 hover:text-text-main"
                )}
              >
                <Puzzle size={16} className={isActive ? "text-primary" : "text-text-muted"} strokeWidth={2} />
                <span className="truncate">{item.menuTitle || item.name}</span>
              </Link>
            );
          })
        )}
      </nav>
    </div>
  );
}

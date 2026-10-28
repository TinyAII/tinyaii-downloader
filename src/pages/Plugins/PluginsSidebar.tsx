import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Blocks,
  BookOpen,
  Compass,
  FileUp,
  Puzzle,
  Globe,
  Cloud,
  Database,
  Film,
  Music,
  Shield,
  Link2,
  Search,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import type { LucideIcon } from 'lucide-react';
import { usePluginStore } from '../../store/plugins';

const PLUGIN_ICON_WHITELIST: Record<string, LucideIcon> = {
  puzzle: Puzzle,
  globe: Globe,
  cloud: Cloud,
  database: Database,
  film: Film,
  music: Music,
  shield: Shield,
  link: Link2,
};

const DEFAULT_PLUGIN_GROUP = '未分组';

function normalizePath(value: string | null | undefined) {
  if (!value) return '';
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  return `/${trimmed}`;
}

export default function PluginsSidebar() {
  const location = useLocation();
  const installed = usePluginStore((state) => state.installed);
  const refreshInstalled = usePluginStore((state) => state.refreshInstalled);
  const [searchText, setSearchText] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const navItems = [
    { path: '/plugins/installed', label: '已安装', icon: Blocks },
    { path: '/plugins/discover', label: '发现扩展', icon: Compass },
    { path: '/plugins/import', label: '导入扩展', icon: FileUp },
    { path: '/plugins/tutorial', label: '插件教程', icon: BookOpen },
  ];

  const groupedPluginMenus = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    const menus = installed.filter(
      (item) => item.enabled && item.menuEnabled && !!item.menuRoutePath && !!(item.menuTitle || item.name)
    );
    const groups = new Map<string, typeof menus>();
    menus.forEach((item) => {
      const groupName = (item.menuGroup || '').trim() || DEFAULT_PLUGIN_GROUP;
      const current = groups.get(groupName) || [];
      current.push(item);
      groups.set(groupName, current);
    });
    return Array.from(groups.entries())
      .map(([groupName, items]) => ({
        groupName,
        items: items
          .sort((a, b) => (a.menuTitle || a.name).localeCompare(b.menuTitle || b.name, 'zh-CN'))
          .filter((item) => {
            if (!keyword) return true;
            const label = (item.menuTitle || item.name).toLowerCase();
            return label.includes(keyword) || groupName.toLowerCase().includes(keyword);
          }),
      }))
      .filter((group) => group.items.length > 0);
  }, [installed, searchText]);

  useEffect(() => {
    void refreshInstalled();
  }, [refreshInstalled]);

  return (
    <div className="w-56 h-screen bg-task-sidebar border-r border-black/5 flex flex-col select-none pt-8">
      <div className="px-6 mb-8 text-lg font-medium text-text-main">
        扩展中心
      </div>
      
      <nav className="flex-1 px-4 overflow-y-auto custom-scrollbar">
        {navItems.map((item) => {
          const isActive = normalizePath(location.pathname) === normalizePath(item.path);
          const Icon = item.icon;
          
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[15px] transition-colors cursor-pointer",
                isActive 
                  ? "bg-black/5 text-primary font-medium" 
                  : "text-text-main hover:bg-black/5 hover:text-text-main"
              )}
            >
              <Icon size={16} className={isActive ? "text-primary" : "text-text-muted"} strokeWidth={2} />
              {item.label}
            </Link>
          );
        })}
        <div className="my-3 border-t border-black/10" />
        <div className="mb-2 px-1">
          <div className="h-8 px-2 rounded-md border border-black/10 bg-white flex items-center gap-1.5">
            <Search size={14} className="text-text-muted" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              className="w-full bg-transparent text-[12px] text-text-main outline-none"
              placeholder="搜索插件菜单"
            />
          </div>
        </div>
        {groupedPluginMenus.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-text-muted">暂无插件菜单</div>
        ) : (
          groupedPluginMenus.map((group) => (
            <div key={group.groupName} className="mb-2">
              <button
                onClick={() =>
                  setCollapsedGroups((state) => ({
                    ...state,
                    [group.groupName]: !state[group.groupName],
                  }))
                }
                className="w-full px-2 py-1 rounded-md hover:bg-black/5 flex items-center justify-between cursor-pointer"
              >
                <div className="text-[11px] text-text-muted">{group.groupName}</div>
                {collapsedGroups[group.groupName] ? (
                  <ChevronRight size={12} className="text-text-muted" />
                ) : (
                  <ChevronDown size={12} className="text-text-muted" />
                )}
              </button>
              {collapsedGroups[group.groupName]
                ? null
                : group.items.map((plugin) => {
                const path = normalizePath(plugin.menuRoutePath);
                const isActive = normalizePath(location.pathname) === path;
                const iconKey = (plugin.menuIcon || '').trim().toLowerCase();
                const Icon = PLUGIN_ICON_WHITELIST[iconKey] || Puzzle;
                const label = plugin.menuTitle || plugin.name;
                const tip = `${label} · ${plugin.name} · v${plugin.version}`;
                return (
                  <Link
                    key={plugin.id}
                    to={path}
                    title={tip}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] transition-colors cursor-pointer",
                      isActive
                        ? "bg-black/5 text-primary font-medium"
                        : "text-text-main hover:bg-black/5 hover:text-text-main"
                    )}
                  >
                    <Icon size={16} className={isActive ? "text-primary" : "text-text-muted"} strokeWidth={2} />
                    <span className="truncate">{label}</span>
                  </Link>
                );
              })}
            </div>
          ))
        )}
      </nav>
    </div>
  );
}

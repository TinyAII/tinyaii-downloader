import { Link, useLocation } from 'react-router-dom';
import { Settings as SettingsIcon, Wrench, FileText } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useAdvancedSettingsStore } from '../../store/settings/advancedStore';

export default function SettingsSidebar() {
  const location = useLocation();
  const showDeveloperLogsEntry = useAdvancedSettingsStore((state) => state.showDeveloperLogsEntry);

  const navItems = [
    { path: '/settings/basic', label: '基础设置', icon: SettingsIcon },
    { path: '/settings/advanced', label: '进阶设置', icon: Wrench },
    ...(showDeveloperLogsEntry ? [{ path: '/settings/developer-logs', label: '开发者日志', icon: FileText }] : []),
  ];

  return (
    <div className="w-56 h-screen bg-task-sidebar border-r border-black/5 flex flex-col select-none pt-8">
      <div className="px-6 mb-8 text-lg font-medium text-text-main">
        偏好设置
      </div>
      
      <nav className="flex-1 px-4 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
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
      </nav>
    </div>
  );
}

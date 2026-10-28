import { Play, Check } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { useTaskStore } from '../../store/tasks';

export default function TaskSidebar() {
  const location = useLocation();
  const tasks = useTaskStore((state) => state.tasks);
  const downloadingCount = tasks.filter((task) => task.status !== 'completed').length;
  const completedCount = tasks.filter((task) => task.status === 'completed').length;

  const menuItems = [
    {
      path: '/',
      name: '下载中',
      icon: Play,
      count: downloadingCount,
    },
    {
      path: '/completed',
      name: '已完成',
      icon: Check,
      count: completedCount,
    }
  ];

  return (
    <div className="w-56 h-screen bg-task-sidebar border-r border-black/5 flex flex-col select-none pt-8">
      {/* Header */}
      <div className="px-6 mb-8 text-lg font-medium text-text-main">
        任务列表
      </div>

      {/* Menu List */}
      <div className="flex-1 px-4 space-y-1">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
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
              <item.icon 
                size={16} 
                className={cn(isActive ? "text-primary" : "text-text-muted")} 
                strokeWidth={2}
              />
              <span className="flex-1">{item.name}</span>
              <span className="text-[12px] text-text-muted bg-black/5 rounded-full min-w-6 h-6 px-2 flex items-center justify-center">
                {item.count}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

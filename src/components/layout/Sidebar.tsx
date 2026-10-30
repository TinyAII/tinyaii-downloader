import { List, Plus, HelpCircle, Settings, Blocks, Braces } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Link, useLocation } from 'react-router-dom';

interface SidebarProps {
  onNewTask: () => void;
  onOpenAbout: () => void;
}

export default function Sidebar({ onNewTask, onOpenAbout }: SidebarProps) {
  const location = useLocation();

  return (
    <div className="w-16 h-screen flex flex-col items-center py-6 bg-sidebar border-r border-black/5 select-none">
      {/* Logo */}
      <img src="/app-logo.png" alt="TinyAii" className="w-9 h-9 rounded-lg mb-8" />

      {/* Top Actions */}
      <div className="flex flex-col gap-4 flex-1">
        <Link
          to="/"
          className={cn(
            "p-2 rounded-lg transition-colors cursor-pointer",
            (location.pathname === '/' || location.pathname === '/completed') 
              ? "text-primary" 
              : "text-text-muted hover:text-text-main hover:bg-black/5"
          )}
        >
          <List size={22} strokeWidth={2} />
        </Link>
        <Link
          to="/plugins/installed"
          className={cn(
            "p-2 rounded-lg transition-colors cursor-pointer",
            location.pathname.startsWith('/plugins')
              ? "text-primary" 
              : "text-text-muted hover:text-text-main hover:bg-black/5"
          )}
        >
          <Blocks size={22} strokeWidth={2} />
        </Link>
        <Link
          to="/api"
          className={cn(
            "p-2 rounded-lg transition-colors cursor-pointer",
            location.pathname.startsWith('/api')
              ? "text-primary" 
              : "text-text-muted hover:text-text-main hover:bg-black/5"
          )}
        >
          <Braces size={22} strokeWidth={2} />
        </Link>
        <button 
          onClick={onNewTask}
          className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-black/5 transition-colors cursor-pointer"
        >
          <Plus size={22} strokeWidth={2} />
        </button>
      </div>

      {/* Bottom Actions */}
      <div className="flex flex-col gap-4">
        <button 
          onClick={onOpenAbout}
          className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-black/5 transition-colors cursor-pointer"
        >
          <HelpCircle size={20} strokeWidth={2} />
        </button>
        <Link 
          to="/settings/basic"
          className={cn(
            "p-2 rounded-lg transition-colors cursor-pointer",
            location.pathname.startsWith('/settings')
              ? "text-primary" 
              : "text-text-muted hover:text-text-main hover:bg-black/5"
          )}
        >
          <Settings size={20} strokeWidth={2} />
        </Link>
      </div>
    </div>
  );
}

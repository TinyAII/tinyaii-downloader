import { useEffect, useMemo, useState } from 'react';
import { Download, Search, Star } from 'lucide-react';
import { usePluginStore } from '../../store/plugins';

export default function DiscoverPlugins() {
  const [keyword, setKeyword] = useState('');
  const discover = usePluginStore((state) => state.discover);
  const installed = usePluginStore((state) => state.installed);
  const refreshDiscover = usePluginStore((state) => state.refreshDiscover);
  const refreshInstalled = usePluginStore((state) => state.refreshInstalled);
  const installPlugin = usePluginStore((state) => state.installPlugin);

  useEffect(() => {
    void Promise.all([refreshDiscover(), refreshInstalled()]);
  }, [refreshDiscover, refreshInstalled]);

  const filtered = useMemo(() => {
    const key = keyword.trim().toLowerCase();
    if (!key) return discover;
    return discover.filter((plugin) => {
      const text = `${plugin.name} ${plugin.description} ${plugin.author}`.toLowerCase();
      return text.includes(key);
    });
  }, [discover, keyword]);

  return (
    <div className="flex-1 flex flex-col h-full bg-main overflow-hidden">
      <div className="flex items-center justify-between px-8 py-4 border-b border-black/5">
        <h1 className="text-xl font-medium text-text-main">发现扩展</h1>
        
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input 
            type="text" 
            placeholder="搜索扩展..." 
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className="w-64 pl-9 pr-4 py-1.5 bg-black/5 hover:bg-black/10 focus:bg-white focus:ring-2 focus:ring-primary/20 border border-transparent rounded-lg text-sm transition-all outline-none"
          />
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-8">
        {filtered.length === 0 ? (
          <div className="max-w-5xl mx-auto py-16 text-center text-text-muted text-sm">
            {keyword.trim() ? '没有匹配的扩展' : '扩展市场暂未开放，请先通过本地导入安装扩展'}
          </div>
        ) : (
          <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((plugin) => {
              const isInstalled = installed.some((item) => item.id === plugin.id);
              return (
            <div 
              key={plugin.id} 
              className="bg-white border border-black/5 hover:border-primary/30 rounded-xl p-5 flex flex-col transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-medium text-text-main truncate">{plugin.name}</h3>
                  <div className="text-[12px] text-text-muted mt-1">
                    由 {plugin.author} 提供
                  </div>
                </div>
                <button
                  className="bg-primary/10 hover:bg-primary text-primary hover:text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isInstalled}
                  onClick={() => void installPlugin(plugin.id)}
                >
                  {isInstalled ? '已安装' : '获取'}
                </button>
              </div>
              
              <p className="text-sm text-text-muted mb-4 line-clamp-2 flex-1">
                {plugin.description}
              </p>
              
              <div className="flex items-center gap-4 text-[12px] text-text-muted pt-4 border-t border-black/5">
                <div className="flex items-center gap-1">
                  <Download size={14} />
                  <span>{plugin.downloads}</span>
                </div>
                <div className="flex items-center gap-1 text-yellow-500">
                  <Star size={14} fill="currentColor" />
                  <span className="text-text-muted">{plugin.rating}</span>
                </div>
              </div>
            </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

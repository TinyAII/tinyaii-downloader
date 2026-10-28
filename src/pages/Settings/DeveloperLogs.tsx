import { useMemo, useState } from 'react';
import { Copy, Trash2, Search, FileWarning } from 'lucide-react';
import { safeJson, useDeveloperLogStore } from '../../store/developerLogStore';
import { useAdvancedSettingsValues, useSettingsActions } from '../../store/settings/selectors';
import { Toggle } from '../../components/ui/Toggle';
import { Select } from '../../components/ui/Select';

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export default function DeveloperLogs() {
  const { enableDeveloperLogs, showDeveloperLogsEntry, developerLogLevel, developerLogMaxEntries } = useAdvancedSettingsValues();
  const { updateSetting } = useSettingsActions();
  const logs = useDeveloperLogStore((state) => state.logs);
  const clearLogs = useDeveloperLogStore((state) => state.clearLogs);
  const [keyword, setKeyword] = useState('');
  const [copiedLabel, setCopiedLabel] = useState('');

  const filteredLogs = useMemo(() => {
    const text = keyword.trim().toLowerCase();
    if (!text) return logs;
    return logs.filter((item) => {
      return (
        item.message.toLowerCase().includes(text) ||
        item.action.toLowerCase().includes(text) ||
        item.source.toLowerCase().includes(text) ||
        (item.details ?? '').toLowerCase().includes(text)
      );
    });
  }, [logs, keyword]);

  const copyText = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedLabel(label);
    setTimeout(() => setCopiedLabel(''), 1500);
  };

  const copyAll = async () => {
    const payload = filteredLogs.map((item) => ({
      timestamp: item.timestamp,
      source: item.source,
      action: item.action,
      level: item.level,
      message: item.message,
      details: item.details ?? '',
    }));
    await copyText(safeJson(payload), '全部日志已复制');
  };

  const levelClassName = (level: string) => {
    if (level === 'error') return 'text-red-500 font-medium';
    if (level === 'warn') return 'text-[#c7892f] font-medium';
    if (level === 'info') return 'text-[#2f7ed8] font-medium';
    return 'text-text-muted font-medium';
  };

  return (
    <div className="flex flex-col h-full bg-main">
      <div className="px-8 py-6 border-b border-black/5 shrink-0 flex items-center justify-between">
        <h1 className="text-xl font-medium text-text-main">开发者日志</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void copyAll()}
            className="px-3 py-1.5 text-[13px] border border-black/10 rounded-md bg-white hover:bg-black/5 text-text-main flex items-center gap-1.5 cursor-pointer"
          >
            <Copy size={14} />
            复制日志
          </button>
          <button
            onClick={clearLogs}
            className="px-3 py-1.5 text-[13px] border border-black/10 rounded-md bg-white hover:bg-black/5 text-text-main flex items-center gap-1.5 cursor-pointer"
          >
            <Trash2 size={14} />
            清空
          </button>
        </div>
      </div>
      <div className="px-8 py-4 border-b border-black/5 shrink-0">
        <div className="mb-4 p-4 border border-black/10 rounded-lg bg-white">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-text-main">启用开发者日志</span>
              <Toggle checked={enableDeveloperLogs} onChange={(v) => updateSetting('enableDeveloperLogs', v)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-text-main">显示日志入口</span>
              <Toggle checked={showDeveloperLogsEntry} onChange={(v) => updateSetting('showDeveloperLogsEntry', v)} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-text-main">记录级别</span>
              <Select
                value={developerLogLevel}
                onChange={(v) => updateSetting('developerLogLevel', v as 'debug' | 'info' | 'warn' | 'error')}
                options={[
                  { label: 'debug', value: 'debug' },
                  { label: 'info', value: 'info' },
                  { label: 'warn', value: 'warn' },
                  { label: 'error', value: 'error' },
                ]}
                className="w-28"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-text-main">保留条数</span>
              <input
                type="number"
                min={100}
                max={5000}
                value={developerLogMaxEntries}
                onChange={(event) => updateSetting('developerLogMaxEntries', Number(event.target.value || 100))}
                className="w-28 h-8 px-2 text-[13px] border border-black/10 rounded-md bg-white focus:outline-none"
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 w-[28rem] h-9 px-3 border border-black/10 rounded-md bg-white">
          <Search size={14} className="text-text-muted" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="筛选关键字：timeout / token / rpc ..."
            className="flex-1 text-[13px] text-text-main bg-transparent focus:outline-none"
          />
        </div>
        <div className="mt-2 text-[12px] text-text-muted">
          共 {filteredLogs.length} 条日志{copiedLabel ? `，${copiedLabel}` : ''}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-8 py-4 custom-scrollbar">
        {!enableDeveloperLogs ? (
          <div className="mb-3 text-[12px] text-[#c7892f]">当前已关闭开发者日志采集，问题复现期间建议开启。</div>
        ) : null}
        {filteredLogs.length === 0 ? (
          <div className="h-full min-h-[220px] border border-dashed border-black/10 rounded-lg flex items-center justify-center text-text-muted text-[13px]">
            <div className="flex items-center gap-2">
              <FileWarning size={15} />
              暂无日志
            </div>
          </div>
        ) : (
          <div className="space-y-3 pb-6">
            {filteredLogs.map((item) => (
              <div key={item.id} className="border border-black/10 rounded-lg bg-white">
                <div className="px-4 py-3 border-b border-black/5 flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[12px]">
                    <span className={levelClassName(item.level)}>
                      {item.level.toUpperCase()}
                    </span>
                    <span className="text-text-main">{item.source}</span>
                    <span className="text-text-muted">{item.action}</span>
                    <span className="text-text-muted">{formatTimestamp(item.timestamp)}</span>
                  </div>
                  <button
                    onClick={() => void copyText(safeJson(item), '单条日志已复制')}
                    className="text-[12px] text-[#e5a038] hover:text-[#c7892f] flex items-center gap-1 cursor-pointer"
                  >
                    <Copy size={12} />
                    复制
                  </button>
                </div>
                <div className="px-4 py-3">
                  <div className="text-[13px] text-text-main break-all">{item.message}</div>
                  {item.details ? (
                    <pre className="mt-2 p-3 bg-black/5 border border-black/10 rounded-md text-[12px] text-text-main whitespace-pre-wrap break-all leading-5">
                      {item.details}
                    </pre>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

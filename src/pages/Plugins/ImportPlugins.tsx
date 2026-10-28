import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { AlertTriangle, Check, CircleEllipsis, FileUp, FolderOpen, Package, Power, RefreshCw, Trash2, X } from 'lucide-react';
import { appGetFileMeta } from '../../services/download/aria2RpcEngine';
import { pluginPrecheckLocal } from '../../services/plugin/pluginRpcEngine';
import { usePluginStore } from '../../store/plugins';
import { cn } from '../../utils/cn';
import { formatBytes } from '../../utils/format';
import type { PluginImportPrecheckResult, PluginImportVersionPolicy } from '../../types/plugin';

type SelectedFileMeta = {
  sizeBytes: number;
  modifiedAt: number | null;
};

function formatTime(timestamp: number | null) {
  if (!timestamp) return '未知';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export default function ImportPlugins() {
  const installed = usePluginStore((state) => state.installed);
  const importing = usePluginStore((state) => state.importing);
  const errorMessage = usePluginStore((state) => state.errorMessage);
  const clearError = usePluginStore((state) => state.clearError);
  const importLocalPlugin = usePluginStore((state) => state.importLocalPlugin);
  const refreshInstalled = usePluginStore((state) => state.refreshInstalled);
  const togglePluginEnabled = usePluginStore((state) => state.togglePluginEnabled);
  const uninstallPlugin = usePluginStore((state) => state.uninstallPlugin);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [selectedFileMeta, setSelectedFileMeta] = useState<SelectedFileMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [precheck, setPrecheck] = useState<PluginImportPrecheckResult | null>(null);
  const [loadingPrecheck, setLoadingPrecheck] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [versionPolicy, setVersionPolicy] = useState<PluginImportVersionPolicy>('allowOverwrite');
  const [menuTitleDraft, setMenuTitleDraft] = useState('');
  const [menuRouteDraft, setMenuRouteDraft] = useState('');

  const localPlugins = useMemo(
    () => installed.filter((item) => (item.sourceType ?? 'market') === 'local'),
    [installed]
  );

  const handlePickFile = async () => {
    clearError();
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: '插件包', extensions: ['zip', 'tar', 'tgz', 'gz', '7z', 'js', 'mjs', 'cjs', 'tinyplugin'] },
      ],
    });
    if (!selected || Array.isArray(selected)) return;
    setSelectedFilePath(selected);
    setShowConfirmModal(false);
    setPrecheck(null);
    setLoadingMeta(true);
    setLoadingPrecheck(true);
    try {
      const meta = await appGetFileMeta(selected);
      setSelectedFileMeta({
        sizeBytes: meta.sizeBytes,
        modifiedAt: meta.modifiedAt,
      });
      const checked = await pluginPrecheckLocal(selected);
      setPrecheck(checked);
      setVersionPolicy('allowOverwrite');
      setMenuTitleDraft((checked.suggestedMenuTitle || checked.menuTitle || '').trim());
      setMenuRouteDraft((checked.suggestedMenuRoutePath || checked.menuRoutePath || '').trim());
    } catch {
      setSelectedFileMeta(null);
      setPrecheck(null);
    } finally {
      setLoadingMeta(false);
      setLoadingPrecheck(false);
    }
  };

  const handleImport = async () => {
    if (!selectedFilePath.trim() || !precheck) return;
    const installedPlugin = await importLocalPlugin(selectedFilePath, {
      versionPolicy,
      menuTitleOverride: precheck.menuEnabled ? (menuTitleDraft.trim() || null) : null,
      menuRoutePathOverride: precheck.menuEnabled ? (menuRouteDraft.trim() || null) : null,
    });
    if (!installedPlugin) return;
    setSelectedFilePath('');
    setSelectedFileMeta(null);
    setPrecheck(null);
    setShowConfirmModal(false);
    setMenuTitleDraft('');
    setMenuRouteDraft('');
    setVersionPolicy('allowOverwrite');
  };

  const handleRefresh = async () => {
    clearError();
    await refreshInstalled();
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-main overflow-hidden">
      <div className="flex items-center justify-between px-8 py-4 border-b border-black/5">
        <h1 className="text-xl font-medium text-text-main">导入扩展</h1>
        <button
          onClick={() => void handleRefresh()}
          className="h-8 px-3 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer flex items-center gap-1.5"
        >
          <RefreshCw size={14} />
          刷新
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto space-y-5">
          <div className="bg-white border border-black/5 rounded-xl p-5">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <div className="text-base font-medium text-text-main">本地插件导入</div>
                <div className="text-[12px] text-text-muted mt-1">
                  支持 .zip / .tar / .tgz / .gz / .7z / .js / .mjs / .cjs / .tinyplugin
                </div>
                <div className="text-[12px] text-text-muted mt-1">
                  普通插件需在同目录提供 plugin.json 或 同名 .plugin.json；.tinyplugin 已内嵌清单
                </div>
              </div>
              <button
                onClick={() => void handlePickFile()}
                className="h-9 px-4 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-white text-[13px] transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <FileUp size={14} />
                选择插件文件
              </button>
            </div>

            <div className="rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2">
              <div className="text-[12px] text-text-muted">当前文件</div>
              <div className="text-[13px] text-text-main mt-1 break-all">
                {selectedFilePath || '尚未选择文件'}
              </div>
              {loadingMeta ? (
                <div className="text-[12px] text-text-muted mt-2">读取文件信息中...</div>
              ) : selectedFileMeta ? (
                <div className="text-[12px] text-text-muted mt-2">
                  大小 {formatBytes(selectedFileMeta.sizeBytes)} · 修改时间 {formatTime(selectedFileMeta.modifiedAt)}
                </div>
              ) : null}
            </div>

            {selectedFilePath ? (
              <div className="mt-3 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-3">
                <div className="text-[12px] text-text-muted mb-2">导入前校验</div>
                {loadingPrecheck ? (
                  <div className="text-[12px] text-text-muted">校验中...</div>
                ) : precheck ? (
                  <div className="space-y-2">
                    <div className="text-[12px] text-text-main break-all">
                      ID：{precheck.pluginId} · 版本：{precheck.pluginVersion} · 作者：{precheck.pluginAuthor}
                    </div>
                    <div className="text-[12px] text-text-main break-all">
                      清单：{precheck.manifestPath}
                    </div>
                    {precheck.menuEnabled ? (
                      <div className="text-[12px] text-text-main break-all">
                        菜单：{precheck.menuTitle || '未命名'} · 路由：{precheck.menuRoutePath || '未配置'} · 图标：
                        {precheck.menuIcon || '默认'} · 分组：{precheck.menuGroup || '未分组'}
                      </div>
                    ) : (
                      <div className="text-[12px] text-text-muted">该插件未启用菜单注入</div>
                    )}
                    {precheck.upgradeFromVersion ? (
                      <div
                        className={cn(
                          "text-[12px] rounded-md px-2 py-1 border",
                          precheck.isUpgrade
                            ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                            : "text-amber-700 bg-amber-50 border-amber-200"
                        )}
                      >
                        检测到同 ID 插件：当前已安装 v{precheck.upgradeFromVersion}，导入版本 v{precheck.pluginVersion}
                        {precheck.isUpgrade ? '（将执行升级覆盖）' : '（将执行覆盖安装）'}
                      </div>
                    ) : null}
                    {precheck.routeConflictWith || precheck.titleConflictWith ? (
                      <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                        {precheck.titleConflictWith
                          ? `菜单名称与 ${precheck.titleConflictWith} 冲突，建议改为：${precheck.suggestedMenuTitle || '自动生成'}`
                          : null}
                        {precheck.routeConflictWith
                          ? ` ${precheck.titleConflictWith ? '；' : ''}菜单路由与 ${precheck.routeConflictWith} 冲突，建议改为：${precheck.suggestedMenuRoutePath || '自动生成'}`
                          : null}
                      </div>
                    ) : null}
                    {precheck.warnings.length > 0 ? (
                      <div className="space-y-1">
                        {precheck.warnings.map((warning, index) => (
                          <div key={`${warning}-${index}`} className="text-[12px] text-amber-700 flex items-start gap-1.5">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                            <span>{warning}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[12px] text-emerald-700">校验通过，可安全导入</div>
                    )}
                  </div>
                ) : (
                  <div className="text-[12px] text-rose-600">无法读取插件清单，请检查插件文件或外置 plugin.json 后重试</div>
                )}
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-end">
              <button
                onClick={() => setShowConfirmModal(true)}
                disabled={!selectedFilePath.trim() || importing || loadingPrecheck || !precheck}
                className={cn(
                  "h-9 px-4 rounded-lg text-[13px] transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed",
                  "bg-[#e5a038] hover:bg-[#d49028] text-white"
                )}
              >
                <Package size={14} />
                导入配置并确认
              </button>
            </div>
            {errorMessage ? (
              <div className="mt-3 text-[12px] text-rose-600 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                {errorMessage}
              </div>
            ) : null}
          </div>

          <div className="bg-white border border-black/5 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-base font-medium text-text-main">已导入本地扩展</div>
              <div className="text-[12px] text-text-muted">共 {localPlugins.length} 个</div>
            </div>

            {localPlugins.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-text-muted">暂无本地扩展</div>
            ) : (
              <div className="space-y-3">
                {localPlugins.map((plugin) => (
                  <div
                    key={plugin.id}
                    className={cn(
                      "rounded-lg border border-black/10 p-4 flex items-center gap-3",
                      !plugin.enabled && "opacity-60"
                    )}
                  >
                    <div className="w-10 h-10 rounded-lg bg-black/5 flex items-center justify-center text-text-muted shrink-0">
                      <Package size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-medium text-text-main truncate">{plugin.name}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full border border-black/10 text-text-muted">
                          v{plugin.version}
                        </span>
                      </div>
                      <div className="text-[12px] text-text-muted mt-1 truncate">{plugin.description}</div>
                      <div className="text-[12px] text-text-muted mt-1">
                        大小 {formatBytes(plugin.packageSizeBytes ?? 0)} · 导入时间 {formatTime(plugin.installedAt)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/plugins/detail/${encodeURIComponent(plugin.id)}`}
                        className="p-2 rounded-md text-text-muted hover:bg-black/5 transition-colors cursor-pointer"
                        title="查看详情"
                      >
                        <CircleEllipsis size={16} />
                      </Link>
                      {plugin.packagePath ? (
                        <button
                          onClick={() => void openPath(plugin.packagePath ?? '')}
                          className="p-2 rounded-md text-text-muted hover:bg-black/5 transition-colors cursor-pointer"
                          title="打开插件文件"
                        >
                          <FolderOpen size={16} />
                        </button>
                      ) : null}
                      <button
                        onClick={() => void togglePluginEnabled(plugin.id)}
                        className={cn(
                          "p-2 rounded-md transition-colors cursor-pointer",
                          plugin.enabled ? "text-primary hover:bg-primary/10" : "text-text-muted hover:bg-black/5"
                        )}
                        title={plugin.enabled ? '禁用' : '启用'}
                      >
                        <Power size={16} />
                      </button>
                      <button
                        onClick={() => void uninstallPlugin(plugin.id)}
                        className="p-2 rounded-md text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                        title="卸载"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {showConfirmModal && precheck ? (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center px-4 z-20">
          <div className="w-full max-w-2xl bg-white rounded-xl border border-black/10 shadow-xl">
            <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
              <div>
                <div className="text-[16px] font-medium text-text-main">确认导入</div>
                <div className="text-[12px] text-text-muted mt-1">可在导入前微调菜单名称、路由与版本策略</div>
              </div>
              <button
                onClick={() => setShowConfirmModal(false)}
                className="p-1.5 rounded-md text-text-muted hover:bg-black/5 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="text-[12px] text-text-main">
                插件：{precheck.pluginName} · ID：{precheck.pluginId} · 版本：v{precheck.pluginVersion}
              </div>
              <div>
                <div className="text-[12px] text-text-muted mb-1.5">版本策略</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setVersionPolicy('allowOverwrite')}
                    className={cn(
                      "h-9 rounded-md border text-[12px] transition-colors cursor-pointer",
                      versionPolicy === 'allowOverwrite'
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-black/10 text-text-main hover:bg-black/[0.02]"
                    )}
                  >
                    允许覆盖安装
                  </button>
                  <button
                    onClick={() => setVersionPolicy('upgradeOnly')}
                    className={cn(
                      "h-9 rounded-md border text-[12px] transition-colors cursor-pointer",
                      versionPolicy === 'upgradeOnly'
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-black/10 text-text-main hover:bg-black/[0.02]"
                    )}
                  >
                    仅允许升级
                  </button>
                </div>
              </div>
              {precheck.menuEnabled ? (
                <>
                  <div>
                    <div className="text-[12px] text-text-muted mb-1.5">菜单名称</div>
                    <input
                      value={menuTitleDraft}
                      onChange={(event) => setMenuTitleDraft(event.target.value)}
                      className="w-full h-9 px-3 rounded-md border border-black/10 bg-white text-[13px] text-text-main outline-none focus:border-primary"
                      placeholder="留空则自动生成"
                    />
                  </div>
                  <div>
                    <div className="text-[12px] text-text-muted mb-1.5">菜单路由</div>
                    <input
                      value={menuRouteDraft}
                      onChange={(event) => setMenuRouteDraft(event.target.value)}
                      className="w-full h-9 px-3 rounded-md border border-black/10 bg-white text-[13px] text-text-main outline-none focus:border-primary"
                      placeholder="留空则自动生成"
                    />
                  </div>
                </>
              ) : null}
              {precheck.routeConflictWith || precheck.titleConflictWith ? (
                <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  {precheck.titleConflictWith ? `菜单名与 ${precheck.titleConflictWith} 冲突；` : ''}
                  {precheck.routeConflictWith ? `路由与 ${precheck.routeConflictWith} 冲突。` : ''}
                  已支持自动重命名，也可手动调整后导入。
                </div>
              ) : (
                <div className="text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 flex items-center gap-1.5">
                  <Check size={13} />
                  当前配置可直接导入
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-black/5 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="h-9 px-4 rounded-md border border-black/10 text-[13px] text-text-main hover:bg-black/[0.02] transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={() => void handleImport()}
                disabled={importing}
                className="h-9 px-4 rounded-md bg-[#e5a038] hover:bg-[#d49028] text-white text-[13px] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {importing ? <RefreshCw size={14} className="animate-spin" /> : <Package size={14} />}
                {importing ? '导入中...' : '确认导入'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

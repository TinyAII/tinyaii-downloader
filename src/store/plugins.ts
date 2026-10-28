import { create } from 'zustand';
import {
  pluginImportLocal,
  pluginInstall,
  pluginListDiscover,
  pluginListInstalled,
  pluginToggleEnabled,
  pluginUninstall,
} from '../services/plugin/pluginRpcEngine';
import type { DiscoverPlugin, InstalledPlugin, PluginImportOptions } from '../types/plugin';

interface PluginState {
  installed: InstalledPlugin[];
  discover: DiscoverPlugin[];
  loading: boolean;
  importing: boolean;
  errorMessage: string | null;
  bootRuntime: () => Promise<void>;
  refreshInstalled: () => Promise<void>;
  refreshDiscover: () => Promise<void>;
  clearError: () => void;
  installPlugin: (pluginId: string) => Promise<void>;
  importLocalPlugin: (filePath: string, options?: PluginImportOptions) => Promise<InstalledPlugin | null>;
  uninstallPlugin: (pluginId: string) => Promise<void>;
  togglePluginEnabled: (pluginId: string) => Promise<void>;
}

export const usePluginStore = create<PluginState>((set, get) => ({
  installed: [],
  discover: [],
  loading: false,
  importing: false,
  errorMessage: null,
  bootRuntime: async () => {
    await Promise.all([get().refreshInstalled(), get().refreshDiscover()]);
  },
  refreshInstalled: async () => {
    set(() => ({ loading: true }));
    try {
      const installed = await pluginListInstalled();
      set(() => ({ installed, errorMessage: null }));
    } catch (error) {
      console.error('加载已安装插件失败', error);
      set(() => ({ errorMessage: '加载已安装扩展失败，请稍后重试' }));
    } finally {
      set(() => ({ loading: false }));
    }
  },
  refreshDiscover: async () => {
    try {
      const discover = await pluginListDiscover();
      set(() => ({ discover, errorMessage: null }));
    } catch (error) {
      console.error('加载扩展市场失败', error);
      set(() => ({ errorMessage: '加载扩展市场失败，请检查网络后重试' }));
    }
  },
  clearError: () => {
    set(() => ({ errorMessage: null }));
  },
  installPlugin: async (pluginId) => {
    try {
      const installed = await pluginInstall(pluginId);
      set((state) => {
        const exists = state.installed.some((item) => item.id === installed.id);
        if (exists) {
          return {
            installed: state.installed.map((item) => (item.id === installed.id ? installed : item)),
            errorMessage: null,
          };
        }
        return { installed: [installed, ...state.installed], errorMessage: null };
      });
    } catch (error) {
      console.error('安装插件失败', error);
      set(() => ({ errorMessage: '安装扩展失败，请稍后重试' }));
    }
  },
  importLocalPlugin: async (filePath, options) => {
    set(() => ({ importing: true }));
    try {
      const installed = await pluginImportLocal(filePath, options);
      set((state) => {
        const exists = state.installed.some((item) => item.id === installed.id);
        if (exists) {
          return {
            installed: state.installed.map((item) => (item.id === installed.id ? installed : item)),
            importing: false,
            errorMessage: null,
          };
        }
        return { installed: [installed, ...state.installed], importing: false, errorMessage: null };
      });
      return installed;
    } catch (error) {
      console.error('导入本地插件失败', error);
      const message = error instanceof Error ? error.message : String(error);
      set(() => ({ importing: false, errorMessage: message || '导入失败，请检查插件文件后重试' }));
      return null;
    } finally {
      set((state) => (state.importing ? { importing: false } : state));
    }
  },
  uninstallPlugin: async (pluginId) => {
    try {
      await pluginUninstall(pluginId);
      set((state) => ({ installed: state.installed.filter((item) => item.id !== pluginId), errorMessage: null }));
    } catch (error) {
      console.error('卸载插件失败', error);
      set(() => ({ errorMessage: '卸载扩展失败，请稍后重试' }));
    }
  },
  togglePluginEnabled: async (pluginId) => {
    try {
      const updated = await pluginToggleEnabled(pluginId);
      set((state) => ({
        installed: state.installed.map((item) => (item.id === updated.id ? updated : item)),
        errorMessage: null,
      }));
    } catch (error) {
      console.error('更新插件状态失败', error);
      set(() => ({ errorMessage: '更新扩展状态失败，请稍后重试' }));
    }
  },
}));

import type {
  DiscoverPlugin,
  InstalledPlugin,
  PluginImportOptions,
  PluginImportPrecheckResult,
} from '../../types/plugin';

async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function pluginListInstalled() {
  return invokeCommand<InstalledPlugin[]>('plugin_list_installed');
}

export async function pluginListDiscover() {
  return invokeCommand<DiscoverPlugin[]>('plugin_list_discover');
}

export async function pluginInstall(pluginId: string) {
  return invokeCommand<InstalledPlugin>('plugin_install', { pluginId });
}

export async function pluginReadRuntimeScript(filePath: string) {
  return invokeCommand<string>('plugin_read_runtime_script', { filePath });
}

export async function pluginImportLocal(filePath: string, options?: PluginImportOptions) {
  return invokeCommand<InstalledPlugin>('plugin_import_local', { filePath, options });
}

export async function pluginPrecheckLocal(filePath: string) {
  return invokeCommand<PluginImportPrecheckResult>('plugin_precheck_local', { filePath });
}

export async function pluginUninstall(pluginId: string) {
  await invokeCommand<void>('plugin_uninstall', { pluginId });
}

export async function pluginToggleEnabled(pluginId: string) {
  return invokeCommand<InstalledPlugin>('plugin_toggle_enabled', { pluginId });
}

export type PluginWebviewCookie = {
  name: string;
  value: string;
  domain?: string | null;
  path?: string | null;
};

export async function appOpenPluginWebview(windowLabel: string, url: string, title?: string) {
  return invokeCommand<void>('app_open_plugin_webview', { windowLabel, url, title });
}

export async function appCollectWebviewCookies(windowLabel: string, domainKeyword?: string) {
  return invokeCommand<PluginWebviewCookie[]>('app_collect_webview_cookies', {
    windowLabel,
    domainKeyword,
  });
}

export async function appHttpGetJson(url: string, headers?: Record<string, string>) {
  return invokeCommand<Record<string, unknown>>('app_http_get_json', {
    request: {
      url,
      headers: headers || {},
    },
  });
}

export async function appHttpRequestJson(
  method: string,
  url: string,
  headers?: Record<string, string>,
  body?: Record<string, unknown>
) {
  return invokeCommand<Record<string, unknown>>('app_http_request_json', {
    request: {
      method,
      url,
      headers: headers || {},
      body: body || null,
    },
  });
}

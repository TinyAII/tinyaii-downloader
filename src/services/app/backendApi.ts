import { invoke } from '@tauri-apps/api/core';

const API_BASE_URL = 'https://bump.tinyaii.cn/api/v1';
const APP_KEY = 'app_fe8c4d54ad3215425d3bab9d';

export interface VersionCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  releaseNotes: string;
  forceUpdate: boolean;
}

interface BumpCheckResponse {
  has_update?: boolean;
  latest_version?: string;
  release_notes?: string;
  force_update?: boolean;
  publish_time?: string;
  platform?: string;
  download_url?: string;
  error?: string;
  message?: string;
}

async function resolveVersion() {
  try {
    const appApi = await import('@tauri-apps/api/app');
    const version = await appApi.getVersion();
    if (typeof version === 'string' && version.trim()) {
      return version.trim();
    }
  } catch (_error) {
    // 读不到就让调用方跳过检查
  }
  // 不能用固定版本兜底：曾经写死 1.0.0，读失败时客户端会把自己当旧版本，
  // 于是每次启动都提示更新，装完仍然提示
  return '';
}

// 走 Rust 侧请求：BumpAPI 没有返回 CORS 头，webview 里的 fetch 会被浏览器拦掉
async function fetchCheck(currentVersion: string) {
  const requestUrl =
    `${API_BASE_URL}/check?app_key=${encodeURIComponent(APP_KEY)}` +
    `&current_version=${encodeURIComponent(currentVersion)}`;

  let payload: unknown;
  try {
    payload = await invoke('app_http_get_json', {
      request: { url: requestUrl, headers: { Accept: 'application/json' } },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`请求失败：无法连接更新服务（可能是证书或网络问题）[${reason}]`);
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('请求失败：更新服务返回内容无法解析');
  }
  const data = payload as BumpCheckResponse;
  if (typeof data.has_update !== 'boolean') {
    throw new Error(`请求失败：${data.message ?? data.error ?? '更新服务返回异常'}`);
  }
  return data;
}

export async function checkVersionUpdate() {
  const currentVersion = await resolveVersion();
  if (!currentVersion) {
    throw new Error('无法读取当前版本号，已跳过更新检查');
  }
  const data = await fetchCheck(currentVersion);
  return {
    hasUpdate: Boolean(data.has_update),
    currentVersion,
    latestVersion: data.latest_version ?? currentVersion,
    downloadUrl: data.download_url ?? '',
    releaseNotes: data.release_notes ?? '',
    forceUpdate: Boolean(data.force_update),
  } satisfies VersionCheckResult;
}

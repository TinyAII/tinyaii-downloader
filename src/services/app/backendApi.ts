const API_BASE_URL = 'https://apie.tinyaii.top/api/v1';
const APP_KEY = '4399221304e1e057';

export interface VersionCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  releaseNotes: string;
  forceUpdate: boolean;
}

interface ApiResponse<T> {
  code: number;
  message?: string;
  data?: T;
}

function resolvePlatform() {
  const source = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`.toLowerCase();
  if (source.includes('win')) return 'windows';
  if (source.includes('mac')) return 'macos';
  if (source.includes('linux')) return 'linux';
  return 'unknown';
}

async function resolveVersion() {
  try {
    const appApi = await import('@tauri-apps/api/app');
    const version = await appApi.getVersion();
    if (typeof version === 'string' && version.trim()) {
      return version.trim();
    }
  } catch (_error) {
  }
  return '1.0.0';
}

async function postJson<T>(path: string, body: Record<string, unknown>) {
  const requestUrl = `${API_BASE_URL}${path}`;
  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`请求失败：无法连接更新服务（可能是证书或网络问题）[${reason}]`);
  }
  if (!response.ok) {
    const rawText = await response.text();
    const detail = rawText.trim().slice(0, 200);
    throw new Error(`请求失败(${response.status}) ${detail}`);
  }
  return response.json() as Promise<ApiResponse<T>>;
}

export async function checkVersionUpdate() {
  const [currentVersion, platform] = await Promise.all([resolveVersion(), resolvePlatform()]);
  const payload = {
    app_key: APP_KEY,
    current_version: currentVersion,
    platform,
  };
  const response = await postJson<{
    has_update?: boolean;
    current_version?: string;
    latest_version?: string;
    download_url?: string;
    release_notes?: string;
    force_update?: boolean;
  }>('/version/check', payload);
  const data = response.data ?? {};
  return {
    hasUpdate: Boolean(data.has_update),
    currentVersion: data.current_version ?? currentVersion,
    latestVersion: data.latest_version ?? currentVersion,
    downloadUrl: data.download_url ?? '',
    releaseNotes: data.release_notes ?? '',
    forceUpdate: Boolean(data.force_update),
  } satisfies VersionCheckResult;
}

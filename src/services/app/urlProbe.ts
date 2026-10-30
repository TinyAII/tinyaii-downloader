import { invoke } from '@tauri-apps/api/core';

export interface UrlProbeResult {
  status: number;
  elapsedMs: number;
  ok: boolean;
}

export async function probeUrl(url: string) {
  return invoke<UrlProbeResult>('app_probe_url', { request: { url } });
}

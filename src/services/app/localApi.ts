import { invoke } from '@tauri-apps/api/core';

export interface LocalApiInfo {
  port: number;
  enabled: boolean;
  running: boolean;
  token: string;
}

export interface LocalApiAria2Config {
  rpcPort: number;
  rpcSecret: string;
  aria2ExecutablePath: string;
}

export async function apiGetInfo() {
  return invoke<LocalApiInfo>('api_get_info');
}

export interface LocalApiMirror {
  id: string;
  label: string;
  prefix: string;
}

export async function apiUpdateMirrors(mirrors: LocalApiMirror[], activeId: string) {
  return invoke<void>('api_update_mirrors', { mirrors, activeId });
}

export async function apiSetEnabled(enabled: boolean) {
  return invoke<LocalApiInfo>('api_set_enabled', { enabled });
}

export async function apiUpdateConfig(config: LocalApiAria2Config) {
  return invoke<void>('api_update_config', { config });
}

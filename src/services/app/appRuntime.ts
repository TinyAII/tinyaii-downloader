async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function appIsAutostartLaunch() {
  return invokeCommand<boolean>('app_is_autostart_launch');
}

export async function appExit() {
  return invokeCommand<void>('app_exit');
}

async function loadAutostartModule() {
  return import('@tauri-apps/plugin-autostart');
}

export async function appGetAutostartEnabled() {
  const autostart = await loadAutostartModule();
  return autostart.isEnabled();
}

export async function appSetAutostartEnabled(enabled: boolean) {
  const autostart = await loadAutostartModule();
  if (enabled) {
    await autostart.enable();
    return;
  }
  await autostart.disable();
}

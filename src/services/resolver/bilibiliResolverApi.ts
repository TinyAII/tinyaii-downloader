async function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function resolveBilibiliLinks(
  link: string,
  options?: {
    cookie?: string;
    userAgent?: string;
  }
) {
  return invokeCommand<string[]>('app_resolve_bilibili_links', {
    url: link,
    cookie: options?.cookie || '',
    userAgent: options?.userAgent || '',
  });
}

import type { GithubMirrorEntry } from '../store/settings/types';

// 只对这些域名的链接做镜像改写，避免误伤其它站点
const MIRRORABLE_HOSTS = new Set([
  'github.com',
  'www.github.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

export const DIRECT_MIRROR: GithubMirrorEntry = {
  id: 'direct',
  label: '直连 GitHub',
  prefix: '',
};

export function isGithubHostedUrl(url: string): boolean {
  try {
    return MIRRORABLE_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch (_error) {
    return false;
  }
}

export function applyGithubMirror(url: string, prefix: string): string {
  const trimmed = prefix.trim();
  if (!trimmed || !isGithubHostedUrl(url)) {
    return url;
  }
  const base = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  return `${base}${url}`;
}

export function stripProtocol(prefix: string): string {
  return prefix.replace(/^https?:\/\//i, '');
}

export function resolveMirror(
  list: GithubMirrorEntry[] | undefined,
  id: string
): GithubMirrorEntry {
  if (!list || list.length === 0) {
    return DIRECT_MIRROR;
  }
  return list.find((item) => item.id === id) ?? list[0];
}

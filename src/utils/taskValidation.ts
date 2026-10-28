import type { CreateTaskPayload } from '../types/task';
import { normalizeTrackerList } from './trackerSources';

export interface TaskValidationConstraints {
  minSplitCount: number;
  maxSplitCount: number;
  maxConnectionPerServer: number;
  defaultSplitCount: number;
  defaultMaxConnectionsPerServer: number;
}

const SUPPORTED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'sftp:']);
export const USER_AGENT_MAX_LENGTH = 512;

export interface UserAgentRule {
  hostPattern: string;
  userAgent: string;
}

export function normalizeSplitCount(splitCount: number, constraints: TaskValidationConstraints) {
  const fallback = Number.isFinite(constraints.defaultSplitCount)
    ? constraints.defaultSplitCount
    : constraints.minSplitCount;
  const source = Number.isFinite(splitCount) ? splitCount : fallback;
  return Math.min(Math.max(source, constraints.minSplitCount), constraints.maxSplitCount);
}

export function normalizeMaxConnectionsPerServer(maxConnectionsPerServer: number, constraints: TaskValidationConstraints) {
  const fallback = Number.isFinite(constraints.defaultMaxConnectionsPerServer)
    ? constraints.defaultMaxConnectionsPerServer
    : constraints.minSplitCount;
  const source = Number.isFinite(maxConnectionsPerServer) ? maxConnectionsPerServer : fallback;
  return Math.min(Math.max(source, constraints.minSplitCount), constraints.maxConnectionPerServer);
}

function sanitizeLinkInput(source: string) {
  let current = source.trim();
  while (current.length >= 2) {
    const first = current[0];
    const last = current[current.length - 1];
    const hasPair = (first === '`' && last === '`')
      || (first === '"' && last === '"')
      || (first === '\'' && last === '\'');
    if (!hasPair) {
      break;
    }
    current = current.slice(1, -1).trim();
  }
  return current;
}

function isSupportedLink(link: string) {
  if (link.startsWith('magnet:?')) {
    return true;
  }
  try {
    const parsed = new URL(link);
    return SUPPORTED_LINK_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function normalizeUserAgentInput(source: string) {
  return source
    .replace(/\r/g, '\n')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeHostPattern(source: string) {
  return source
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
}

function isMatchingHost(host: string, hostPattern: string) {
  const normalizedHost = host.trim().toLowerCase();
  const pattern = normalizeHostPattern(hostPattern);
  if (!pattern) return false;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2);
    if (!suffix) return false;
    return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
  }
  return normalizedHost === pattern || normalizedHost.endsWith(`.${pattern}`);
}

function pickLinkHost(link: string) {
  if (link.startsWith('magnet:?')) return '';
  try {
    return new URL(link).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function parseUserAgentRules(source: string): UserAgentRule[] {
  return source
    .split(/\r?\n/)
    .map((rawLine) => rawLine.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const parts = line.includes('=>') ? line.split('=>') : line.split('=');
      if (parts.length < 2) return null;
      const hostPattern = normalizeHostPattern(parts[0] ?? '');
      const userAgent = normalizeUserAgentInput(parts.slice(1).join('=').trim());
      if (!hostPattern || !userAgent) return null;
      return {
        hostPattern,
        userAgent,
      };
    })
    .filter((item): item is UserAgentRule => item !== null);
}

export function resolveUserAgentForLinks(
  links: string[],
  rulesSource: string,
  fallbackUserAgent: string
) {
  const rules = parseUserAgentRules(rulesSource);
  const fallback = normalizeUserAgentInput(fallbackUserAgent);
  for (const link of links) {
    const host = pickLinkHost(link);
    if (!host) continue;
    for (const rule of rules) {
      if (isMatchingHost(host, rule.hostPattern)) {
        return {
          userAgent: rule.userAgent,
          matchedPattern: rule.hostPattern,
        };
      }
    }
  }
  return {
    userAgent: fallback,
    matchedPattern: '',
  };
}

export function mapTaskCreationError(message: string) {
  const lower = message.toLowerCase();
  if (message.includes('哔哩保存失败')) {
    return `添加任务失败：${message}`;
  }
  if (message.includes('哔哩解析失败')) {
    return `添加任务失败：${message}`;
  }
  if (message.includes('检测到夸克链接')) {
    return `添加任务失败：${message}`;
  }
  if (message.includes('夸克登录态缺少 __puus')) {
    return `添加任务失败：${message}`;
  }
  if (message.includes('插件执行失败') || message.includes('resolver')) {
    return `添加任务失败：${message}`;
  }
  if (message.includes('并发参数未完全生效')) {
    return `添加任务失败：${message}`;
  }
  if (message.includes('max-connection-per-server')) {
    return '添加任务失败：单服务器最大连接数超出 aria2 可用范围，请调整后重试';
  }
  if (message.includes("option '--split'") || message.includes('分片数')) {
    return '添加任务失败：分片数超出 aria2 可用范围，请调整后重试';
  }
  if (message.includes('The Link Has Expired') || message.includes('Link Has Expired') || lower.includes('link has expired')) {
    return '添加任务失败：下载链接已过期，请更换有效链接后重试';
  }
  if (message.includes('429') || lower.includes('too many requests')) {
    return '添加任务失败：源站触发限流（429），请降低并发连接或稍后重试';
  }
  if (message.includes('403') && message.includes('Forbidden')) {
    return '添加任务失败：下载链接访问被拒绝，请检查鉴权或更换链接';
  }
  if (
    message.includes('401')
    || lower.includes('unauthorized')
    || lower.includes('token')
    || lower.includes('secret')
  ) {
    return '添加任务失败：aria2 鉴权失败，请检查 RPC 密钥配置';
  }
  if (message.includes('创建存储目录失败') || message.includes('存储路径不能为空')) {
    return `添加任务失败：${message}`;
  }
  if (message.includes('aria2 RPC 错误') || message.includes('aria2 RPC HTTP 错误')) {
    return `添加任务失败：${message}`;
  }
  return `添加任务失败：${message}`;
}

export function validateAndNormalizeTaskPayload(
  payload: CreateTaskPayload,
  constraints: TaskValidationConstraints
): CreateTaskPayload {
  const links = payload.links
    .map((item) => sanitizeLinkInput(item))
    .filter((item) => item.length > 0 && !item.startsWith('torrent://'));
  const torrentFiles = (payload.torrentFiles ?? [])
    .map((item) => ({
      name: item.name.trim(),
      contentBase64: item.contentBase64.trim(),
      sizeBytes: typeof item.sizeBytes === 'number' && Number.isFinite(item.sizeBytes) ? Math.max(0, item.sizeBytes) : undefined,
    }))
    .filter((item) => item.name && item.contentBase64);
  if (payload.type === 'torrent') {
    if (!torrentFiles.length) {
      throw new Error('请先选择至少一个种子文件');
    }
  } else {
    if (!links.length) {
      throw new Error('请至少输入一个下载链接');
    }
    const invalidLinkIndex = links.findIndex((item) => !isSupportedLink(item));
    if (invalidLinkIndex >= 0) {
      throw new Error(`第 ${invalidLinkIndex + 1} 行链接格式无效，请输入 http/https/ftp/sftp 或 magnet 链接`);
    }
  }
  const savePath = payload.savePath.trim();
  if (!savePath) {
    throw new Error('存储路径不能为空');
  }
  const splitCount = normalizeSplitCount(payload.splitCount, constraints);
  const maxConnectionsPerServer = normalizeMaxConnectionsPerServer(payload.maxConnectionsPerServer, constraints);
  const btOptions = payload.btOptions ? {
    autoDownloadTorrent: !!payload.btOptions.autoDownloadTorrent,
    forceEncrypt: !!payload.btOptions.forceEncrypt,
    keepSeeding: !!payload.btOptions.keepSeeding,
    seedRatio: Math.max(0, Number(payload.btOptions.seedRatio) || 0),
    seedTimeMinutes: Math.max(0, Math.floor(Number(payload.btOptions.seedTimeMinutes) || 0)),
    trackerList: normalizeTrackerList(payload.btOptions.trackerList ?? ''),
  } : undefined;
  const normalizedUserAgent = normalizeUserAgentInput(payload.advanced.userAgent);
  if (normalizedUserAgent.length > USER_AGENT_MAX_LENGTH) {
    throw new Error(`User-Agent 不能超过 ${USER_AGENT_MAX_LENGTH} 个字符`);
  }
  return {
    ...payload,
    links,
    torrentFiles,
    rename: payload.rename.trim(),
    savePath,
    splitCount,
    maxConnectionsPerServer,
    advanced: {
      ...payload.advanced,
      userAgent: normalizedUserAgent,
    },
    btOptions,
  };
}

import type { LinkResolverPlugin, ResolverResult } from '../../../types/resolver';

const QUARK_HOSTS = new Set(['pan.quark.cn', 'drive.quark.cn']);

function parseHost(link: string) {
  try {
    return new URL(link).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function mergeCookie(existingCookie: string, resolverCookie: string) {
  const existingItems = existingCookie
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
  const resolverItems = resolverCookie
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
  const bucket = new Map<string, string>();
  [...existingItems, ...resolverItems].forEach((item) => {
    const [key, ...rest] = item.split('=');
    const normalizedKey = (key || '').trim();
    if (!normalizedKey) return;
    bucket.set(normalizedKey, rest.join('=').trim());
  });
  return Array.from(bucket.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

async function resolveQuarkLinks(cookie: string, links: string[]): Promise<ResolverResult> {
  return {
    links: links.map((item) => item.trim()).filter(Boolean),
    advancedPatch: {
      cookie,
    },
  };
}

// 检测链接是否为鉴权链接（含 token/verify/expires/sign 等会过期的参数）
// 夸克直链通常带 verify 参数，会过期
function detectQuarkAuthLink(link: string): boolean {
  try {
    const url = new URL(link);
    const authParams = ['token', 'verify', 'expires', 'sign', 'signature', 'expiry', 'e'];
    return authParams.some((param) => url.searchParams.has(param));
  } catch {
    return false;
  }
}

export const quarkResolverPlugin: LinkResolverPlugin = {
  id: 'quark-link-resolver',
  name: '夸克网盘解析',
  priority: 10,
  match: (link) => QUARK_HOSTS.has(parseHost(link)),
  resolve: async ({ payload, matchedLinks, sessions }) => {
    const session = sessions.quark;
    if (!session || !session.cookie.trim()) {
      throw new Error('检测到夸克链接，但未配置夸克登录态。请先在扩展中心完成登录态配置。');
    }
    if (!session.cookie.includes('__puus')) {
      throw new Error('夸克登录态缺少 __puus，当前会话无效。请重新登录后再试。');
    }
    const result = await resolveQuarkLinks(session.cookie, matchedLinks);
    return {
      ...result,
      advancedPatch: {
        cookie: mergeCookie(payload.advanced.cookie, result.advancedPatch?.cookie || ''),
        userAgent: payload.advanced.userAgent.trim() || session.userAgent.trim(),
      },
    };
  },
  // 检测夸克直链是否为鉴权链接
  detectAuthLink: detectQuarkAuthLink,
  // 刷新鉴权链接：重新调用 resolve 拿新链接
  refresh: async (context) => {
    return quarkResolverPlugin.resolve(context);
  },
};

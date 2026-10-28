import type { LinkResolverPlugin } from '../../../types/resolver';
import { resolveBilibiliLinks } from '../bilibiliResolverApi';

const BILIBILI_HOSTS = new Set([
  'www.bilibili.com',
  'bilibili.com',
  'm.bilibili.com',
  'b23.tv',
  'www.b23.tv',
]);

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

function pickSessionUserAgent(sessionUserAgent: string, payloadUserAgent: string) {
  const payloadUA = payloadUserAgent.trim();
  if (payloadUA) return payloadUA;
  return sessionUserAgent.trim() || 'Mozilla/5.0 TinyAiiResolver';
}

// 检测链接是否为鉴权链接（含 token/verify/expires/sign 等会过期的参数）
// 用于任务运行中判断是否需要刷新链接
function detectBilibiliAuthLink(link: string): boolean {
  try {
    const url = new URL(link);
    const authParams = ['token', 'verify', 'expires', 'sign', 'signature', 'expiry', 'wts'];
    return authParams.some((param) => url.searchParams.has(param));
  } catch {
    return false;
  }
}

export const bilibiliResolverPlugin: LinkResolverPlugin = {
  id: 'bilibili-link-resolver',
  name: '哔哩视频解析',
  priority: 20,
  match: (link) => BILIBILI_HOSTS.has(parseHost(link)),
  resolve: async ({ payload, matchedLinks, sessions }) => {
    const session = sessions.bilibili;
    const resolverCookie = session?.cookie.trim() || '';
    const resolverUA = pickSessionUserAgent(session?.userAgent || '', payload.advanced.userAgent);
    const resolvedGroups = await Promise.all(
      matchedLinks.map((link) =>
        resolveBilibiliLinks(link, {
          cookie: resolverCookie,
          userAgent: resolverUA,
        })
      )
    );
    const links = resolvedGroups.flat().map((item) => item.trim()).filter(Boolean);
    if (!links.length) {
      throw new Error('哔哩解析失败：未获取到可下载直链，请检查视频是否可访问。');
    }
    return {
      links,
      advancedPatch: {
        referer: payload.advanced.referer.trim() || 'https://www.bilibili.com',
        cookie: mergeCookie(payload.advanced.cookie, resolverCookie),
        userAgent: resolverUA,
      },
    };
  },
  // 检测哔哩直链是否为鉴权链接（含 token 等会过期的参数）
  detectAuthLink: detectBilibiliAuthLink,
  // 刷新鉴权链接：重新调用 resolve 拿新直链
  refresh: async (context) => {
    // 复用 resolve 逻辑，传入原始分享链接重新解析
    return bilibiliResolverPlugin.resolve(context);
  },
};

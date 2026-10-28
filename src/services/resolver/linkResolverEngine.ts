import type { CreateTaskPayload, TaskAdvancedOptions } from '../../types/task';
import type { ResolverAuthSession } from '../../types/resolver';
import { resolverPlugins } from './registry';

function mergeAdvanced(
  current: TaskAdvancedOptions,
  patch: Partial<TaskAdvancedOptions> | undefined
): TaskAdvancedOptions {
  if (!patch) return current;
  return {
    userAgent: typeof patch.userAgent === 'string' ? patch.userAgent : current.userAgent,
    authorization: typeof patch.authorization === 'string' ? patch.authorization : current.authorization,
    referer: typeof patch.referer === 'string' ? patch.referer : current.referer,
    cookie: typeof patch.cookie === 'string' ? patch.cookie : current.cookie,
    proxy: typeof patch.proxy === 'string' ? patch.proxy : current.proxy,
  };
}

export async function resolveTaskPayloadByPlugins(
  payload: CreateTaskPayload,
  sessions: Record<string, ResolverAuthSession>
) {
  if (!payload.links.length) {
    return {
      payload,
      appliedPlugins: [] as string[],
    };
  }
  const appliedPlugins: string[] = [];
  let nextPayload: CreateTaskPayload = {
    ...payload,
    links: [...payload.links],
    advanced: { ...payload.advanced },
  };
  for (const plugin of resolverPlugins) {
    const matchedLinks = nextPayload.links.filter((link) => plugin.match(link));
    if (!matchedLinks.length) continue;
    let result;
    try {
      result = await plugin.resolve({
        payload: nextPayload,
        matchedLinks,
        sessions,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`插件执行失败（${plugin.name}）：${message}`);
    }
    appliedPlugins.push(plugin.id);
    if (result.links?.length) {
      const matchedSet = new Set(matchedLinks);
      const untouched = nextPayload.links.filter((link) => !matchedSet.has(link));
      nextPayload = {
        ...nextPayload,
        links: [...untouched, ...result.links],
      };
    }
    nextPayload = {
      ...nextPayload,
      advanced: mergeAdvanced(nextPayload.advanced, result.advancedPatch),
    };
  }
  return {
    payload: nextPayload,
    appliedPlugins,
  };
}

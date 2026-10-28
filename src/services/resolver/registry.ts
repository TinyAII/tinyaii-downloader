import type { LinkResolverPlugin } from '../../types/resolver';
import { bilibiliResolverPlugin } from './plugins/bilibiliResolverPlugin';
import { quarkResolverPlugin } from './plugins/quarkResolverPlugin';

export const resolverPlugins: LinkResolverPlugin[] = [quarkResolverPlugin, bilibiliResolverPlugin].sort(
  (a, b) => a.priority - b.priority
);

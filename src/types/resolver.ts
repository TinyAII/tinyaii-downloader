import type { CreateTaskPayload, TaskAdvancedOptions } from './task';

export interface ResolverAuthSession {
  site: string;
  cookie: string;
  userAgent: string;
  updatedAt: number;
}

export interface ResolverContext {
  payload: CreateTaskPayload;
  matchedLinks: string[];
  sessions: Record<string, ResolverAuthSession>;
}

export interface ResolverResult {
  links?: string[];
  advancedPatch?: Partial<TaskAdvancedOptions>;
}

export interface LinkResolverPlugin {
  id: string;
  name: string;
  priority: number;
  match: (link: string) => boolean;
  resolve: (context: ResolverContext) => Promise<ResolverResult>;
  // 静态检测链接是否为鉴权链接（含 token/verify/expires 等会过期的参数）
  // 用于任务运行中判断是否需要刷新链接，无需异步
  detectAuthLink?: (link: string) => boolean;
  // 刷新鉴权链接：传入原直链与上下文，返回新直链
  // 用于任务运行中 token 过期时拿新链接走 aria2.changeUri 替换
  refresh?: (context: ResolverContext) => Promise<ResolverResult>;
}

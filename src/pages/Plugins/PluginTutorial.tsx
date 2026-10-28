import { useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { BookOpen, Download, FileJson, Package, Rocket, Send, ShieldCheck } from 'lucide-react';
import { appWriteTextFile } from '../../services/download/aria2RpcEngine';

type TutorialCodeExample = {
  title: string;
  code: string;
  language: string;
};

type TutorialSection = {
  id: string;
  title: string;
  description: string;
  bullets: string[];
  examples?: TutorialCodeExample[];
};

const TUTORIAL_EXPORT = {
  version: 1,
  updatedAt: '2026-04-06',
  title: 'TinyAii 插件制作教程',
  summary: '覆盖清单字段、运行时 API、下载任务推送、调试、打包与发布建议的统一教程。',
  quickStart: [
    '准备一个插件脚本文件和一个 plugin.json 或同名 .plugin.json 清单文件。',
    '在脚本中通过 registerMount(root, api) 挂载界面并实现交互。',
    '使用 api.httpGetJson / api.httpRequestJson 调第三方接口。',
    '使用 api.createDownloadTask 把解析结果推送到 TinyAii 下载队列。',
    '本地验证通过后打包为 .tinyplugin 或普通源码包导入。'
  ],
  capabilities: [
    'openWebview',
    'collectCookies',
    'httpGetJson',
    'httpRequestJson',
    'createDownloadTask'
  ],
  manifestFields: {
    id: '插件唯一标识，建议全局唯一',
    name: '插件名称',
    version: '语义化版本号',
    description: '插件简介',
    author: '作者名',
    script: '主脚本文件名',
    menuEnabled: '是否注入扩展中心菜单',
    menuTitle: '菜单标题',
    menuRoutePath: '菜单路由',
    menuGroup: '菜单分组',
    menuIcon: '菜单图标关键字'
  },
  createDownloadTask: {
    required: ['url'],
    optional: [
      'filename',
      'userAgent',
      'authorization',
      'referer',
      'cookie',
      'proxy',
      'splitCount',
      'maxConnectionsPerServer',
      'savePath'
    ]
  },
  releaseFlow: [
    '先在“导入扩展”中用源码包或脚本包做本地验证。',
    '确认菜单、路由、请求头和下载任务都正常。',
    '如需加密发布，生成 .tinyplugin 包。',
    '当前市场未开放，正式分发建议使用本地导入、群文件或私有发布渠道。'
  ]
};

const SECTIONS: TutorialSection[] = [
  {
    id: 'manifest',
    title: '1. 清单文件',
    description: '插件最少需要脚本和清单，清单决定菜单注入、显示名称和路由行为。',
    bullets: [
      '普通源码包需要 `plugin.json` 或与脚本同名的 `.plugin.json`。',
      '若启用扩展中心菜单，必须提供 `menuEnabled`、`menuTitle`、`menuRoutePath` 等字段。',
      '路由建议使用 `/plugins/runtime/xxx` 或自定义唯一前缀，避免与已有插件冲突。',
      '菜单图标当前建议使用 `puzzle`、`cloud`、`database`、`film`、`music`、`shield`、`link`。'
    ],
    examples: [
      {
        title: '示例 plugin.json',
        language: 'json',
        code: `{
  "id": "tinyaii-demo-plugin",
  "name": "Demo 网盘插件",
  "version": "1.0.0",
  "description": "演示如何把解析结果推送到下载器",
  "author": "TinyAii",
  "script": "tinyaii-demo-plugin.js",
  "menuEnabled": true,
  "menuTitle": "Demo 解析",
  "menuRoutePath": "/plugins/runtime/demo-parser",
  "menuGroup": "网盘工具",
  "menuIcon": "cloud"
}`
      }
    ]
  },
  {
    id: 'runtime',
    title: '2. 运行时挂载',
    description: '插件入口统一使用 `registerMount(root, api)`，界面渲染和按钮事件都在这里完成。',
    bullets: [
      '`root` 是挂载容器，可直接写 HTML 和事件绑定。',
      '`api.supportedCapabilities` 可用于校验运行时能力。',
      '建议先实现 `ensureRuntime()`，在需要网络、Cookie 或下载前做能力检测。',
      '登录态类插件优先复用 `openWebview + collectCookies`。'
    ],
    examples: [
      {
        title: '最小挂载示例',
        language: 'js',
        code: `registerMount((root, api) => {
  const ensureRuntime = () => {
    const supported = Array.isArray(api.supportedCapabilities) ? api.supportedCapabilities : [];
    const required = ['httpGetJson', 'httpRequestJson', 'createDownloadTask'];
    const missing = required.filter((cap) => !supported.includes(cap));
    if (missing.length) {
      throw new Error('运行时能力不足: ' + missing.join(', '));
    }
  };

  const render = () => {
    root.innerHTML = '<div style="padding:16px;">插件已加载</div>';
  };

  ensureRuntime();
  render();
});`
      }
    ]
  },
  {
    id: 'request',
    title: '3. 请求与鉴权',
    description: '大多数下载类插件都要处理 Cookie、Token、User-Agent、Referer 和 API 返回码。',
    bullets: [
      '建议把请求头封装成 `buildHeaders()`，不要把 UA、Cookie 散落在每个请求里。',
      '登录后拿到的 Cookie / Token 应写入 `localStorage` 做短期缓存。',
      '接口层统一做返回码判断，把“登录过期”“提取码错误”“分享失效”翻译成可读错误。',
      '对直链类插件，申请直链时的头和真正下载时的头尽量保持一致。'
    ],
    examples: [
      {
        title: '统一请求封装',
        language: 'js',
        code: `const buildHeaders = () => ({
  Cookie: cookie,
  'User-Agent': defaultUserAgent,
  Referer: referer,
  Origin: origin,
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json;charset=UTF-8'
});

const requestApi = async (url, method = 'GET', body) => {
  const raw = await api.httpRequestJson(method, url, buildHeaders(), body);
  if (!raw || typeof raw !== 'object') {
    throw new Error('接口返回为空');
  }
  if (Number(raw.code) !== 0) {
    throw new Error(raw.message || raw.msg || String(raw.code));
  }
  return raw.data;
};`
      }
    ]
  },
  {
    id: 'download',
    title: '4. 推送下载任务',
    description: '插件真正接入 TinyAii 的关键动作，是把直链和下载头推送到下载队列。',
    bullets: [
      '最少需要 `url`，其余如 `filename`、`userAgent`、`referer`、`cookie`、`authorization` 都建议按源站要求显式传入。',
      '如果源站对平台有校验，申请直链和下载阶段要尽量使用同一套 UA 与头。',
      '如果是短时效直链，建议“申请完就立即推送”，不要在插件内长时间缓存。',
      '分片数和连接数可按源站特性单独下发，避免默认高并发触发 403。'
    ],
    examples: [
      {
        title: '推送任务示例',
        language: 'js',
        code: `const pushDownloadTask = async (item) => {
  return api.createDownloadTask({
    url: item.url,
    filename: item.name,
    userAgent: item.userAgent || defaultUserAgent,
    authorization: item.authorization || '',
    referer: item.referer || 'https://example.com/',
    cookie: item.cookie || '',
    splitCount: 1,
    maxConnectionsPerServer: 1
  });
};`
      }
    ]
  },
  {
    id: 'flow',
    title: '5. 常见插件流程',
    description: '下载型插件通常可以抽象成相同流程，方便后续统一维护。',
    bullets: [
      '步骤一：解析分享链接，提取分享 ID、提取码、目录 ID 等参数。',
      '步骤二：申请分享 token 或登录态信息。',
      '步骤三：递归读取目录，整理文件元数据。',
      '步骤四：申请直链，必要时先转存、再轮询任务状态。',
      '步骤五：把下载 URL 和所需请求头传给 `createDownloadTask()`。'
    ]
  },
  {
    id: 'debug',
    title: '6. 调试与发布',
    description: '插件开发最容易踩坑的是头不一致、路由冲突、菜单冲突和打包格式不规范。',
    bullets: [
      '先用源码包本地导入验证，再做混淆或加密打包。',
      '如果插件有菜单，导入前最好确认 `menuTitle` 和 `menuRoutePath` 唯一。',
      '遇到 403 时优先检查：直链是否过期、下载头是否缺失、UA 是否和申请阶段一致。',
      '当前扩展市场未开放，正式分发建议用 `.tinyplugin` 或源码包通过本地导入。'
    ]
  }
];

async function exportTutorialJson() {
  const filePath = await save({
    title: '导出插件教程 JSON',
    defaultPath: `tinyaii-plugin-tutorial-${Date.now()}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!filePath) return null;
  const content = JSON.stringify(TUTORIAL_EXPORT, null, 2);
  await appWriteTextFile(filePath, content);
  return filePath;
}

function CodeCard({ example }: { example: TutorialCodeExample }) {
  return (
    <div className="rounded-xl border border-black/10 bg-black/[0.02] overflow-hidden">
      <div className="px-4 py-3 border-b border-black/5 text-[13px] font-medium text-text-main">
        {example.title}
      </div>
      <pre className="p-4 overflow-x-auto text-[12px] leading-5 text-text-main whitespace-pre-wrap break-all">
        <code>{example.code}</code>
      </pre>
    </div>
  );
}

export default function PluginTutorial() {
  const [exportMessage, setExportMessage] = useState('');

  const handleExportJson = async () => {
    try {
      const filePath = await exportTutorialJson();
      if (!filePath) {
        setExportMessage('已取消导出');
        return;
      }
      setExportMessage(`JSON 教程已导出到：${filePath}`);
    } catch (error) {
      setExportMessage(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-main overflow-hidden">
      <div className="flex items-center justify-between px-8 py-4 border-b border-black/5">
        <div>
          <h1 className="text-xl font-medium text-text-main">插件制作教程</h1>
          <div className="text-[12px] text-text-muted mt-1">
            汇总清单结构、运行时 API、下载任务推送、打包与发布建议
          </div>
        </div>
        <button
          onClick={() => void handleExportJson()}
          className="h-9 px-4 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-white text-[13px] transition-colors cursor-pointer flex items-center gap-1.5"
        >
          <FileJson size={15} />
          导出 JSON 教程
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="bg-white border border-black/5 rounded-xl p-5">
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
                <BookOpen size={18} />
              </div>
              <div className="text-[15px] font-medium text-text-main">清单与菜单</div>
              <div className="text-[12px] text-text-muted mt-1">
                包含 `id`、`script`、`menuTitle`、`menuRoutePath` 等核心字段。
              </div>
            </div>
            <div className="bg-white border border-black/5 rounded-xl p-5">
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
                <ShieldCheck size={18} />
              </div>
              <div className="text-[15px] font-medium text-text-main">请求与鉴权</div>
              <div className="text-[12px] text-text-muted mt-1">
                统一管理 Cookie、Token、User-Agent、Referer，避免头不一致。
              </div>
            </div>
            <div className="bg-white border border-black/5 rounded-xl p-5">
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
                <Send size={18} />
              </div>
              <div className="text-[15px] font-medium text-text-main">下载任务推送</div>
              <div className="text-[12px] text-text-muted mt-1">
                重点说明 `createDownloadTask()` 的字段和推送时机。
              </div>
            </div>
            <div className="bg-white border border-black/5 rounded-xl p-5">
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
                <Package size={18} />
              </div>
              <div className="text-[15px] font-medium text-text-main">打包与分发</div>
              <div className="text-[12px] text-text-muted mt-1">
                先本地导入验证，再输出 `.tinyplugin` 或源码包做正式分发。
              </div>
            </div>
          </div>

          <div className="bg-white border border-black/5 rounded-xl p-6">
            <div className="flex items-center gap-2 text-text-main mb-3">
              <Rocket size={16} className="text-primary" />
              <span className="text-[15px] font-medium">快速开始</span>
            </div>
            {exportMessage ? (
              <div className="mb-4 rounded-lg border border-black/10 bg-black/[0.02] px-4 py-3 text-[12px] text-text-main break-all">
                {exportMessage}
              </div>
            ) : null}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {TUTORIAL_EXPORT.quickStart.map((item, index) => (
                <div key={item} className="rounded-lg border border-black/10 bg-black/[0.02] px-4 py-3">
                  <div className="text-[12px] text-text-muted">步骤 {index + 1}</div>
                  <div className="text-[13px] text-text-main mt-1">{item}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-black/5 rounded-xl p-6">
            <div className="flex items-center gap-2 text-text-main mb-4">
              <Download size={16} className="text-primary" />
              <span className="text-[15px] font-medium">运行时能力</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {TUTORIAL_EXPORT.capabilities.map((capability) => (
                <span
                  key={capability}
                  className="px-3 py-1.5 rounded-full bg-black/[0.04] border border-black/10 text-[12px] text-text-main"
                >
                  {capability}
                </span>
              ))}
            </div>
            <div className="text-[12px] text-text-muted mt-3">
              插件在调用下载、登录或 HTTP 请求前，建议先检查这些能力是否存在。
            </div>
          </div>

          {SECTIONS.map((section) => (
            <section key={section.id} className="bg-white border border-black/5 rounded-xl p-6">
              <div className="text-[18px] font-medium text-text-main">{section.title}</div>
              <div className="text-[13px] text-text-muted mt-2">{section.description}</div>
              <div className="mt-4 space-y-2">
                {section.bullets.map((bullet) => (
                  <div key={bullet} className="text-[13px] text-text-main flex gap-2">
                    <span className="text-primary">•</span>
                    <span>{bullet}</span>
                  </div>
                ))}
              </div>
              {section.examples?.length ? (
                <div className="mt-5 space-y-4">
                  {section.examples.map((example) => (
                    <CodeCard key={`${section.id}-${example.title}`} example={example} />
                  ))}
                </div>
              ) : null}
            </section>
          ))}

          <div className="bg-white border border-amber-200 rounded-xl p-6">
            <div className="text-[15px] font-medium text-amber-800">发布提醒</div>
            <div className="text-[13px] text-amber-800/90 mt-2 space-y-2">
              <div>1. 先验证“申请下载地址时的请求头”和“真正下载时的请求头”是否一致。</div>
              <div>2. 直链类插件优先给出低并发默认值，避免用户首次使用就触发 403。</div>
              <div>3. 当前扩展市场还未开放，教程里的“发布”默认指本地导入、群分发或私有渠道分发。</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

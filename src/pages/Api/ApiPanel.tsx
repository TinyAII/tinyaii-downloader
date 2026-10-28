import { useEffect, useState } from 'react';
import { Check, Copy, Eye, EyeOff, Plug } from 'lucide-react';
import { apiGetInfo, type LocalApiInfo } from '../../services/app/localApi';
import { cn } from '../../utils/cn';

const ENDPOINTS = [
  { method: 'GET', path: '/api/v1/ping', desc: '服务信息与引擎在线状态' },
  { method: 'GET', path: '/api/v1/tasks', desc: '任务列表' },
  { method: 'GET', path: '/api/v1/tasks/{gid}', desc: '单个任务详情' },
  { method: 'POST', path: '/api/v1/tasks', desc: '新建任务（直链，支持 savePath / 限速 / checksum）' },
  { method: 'POST', path: '/api/v1/tasks/{gid}/pause', desc: '暂停' },
  { method: 'POST', path: '/api/v1/tasks/{gid}/resume', desc: '继续' },
  { method: 'POST', path: '/api/v1/tasks/{gid}/remove', desc: '删除任务记录（不删磁盘文件）' },
  { method: 'GET', path: '/api/v1/config', desc: '引擎配置快照（只读）' },
  { method: 'POST', path: '/api/v1/config/speed', desc: '设置全局限速' },
];

export default function ApiPanel() {
  const [info, setInfo] = useState<LocalApiInfo | null>(null);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<'token' | 'curl' | null>(null);

  useEffect(() => {
    let canceled = false;
    apiGetInfo()
      .then((value) => {
        if (!canceled) setInfo(value);
      })
      .catch((cause) => {
        if (!canceled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      canceled = true;
    };
  }, []);

  const port = info?.port ?? 17890;
  const token = info?.token ?? '';
  const maskedToken = token ? `${token.slice(0, 6)}${'•'.repeat(12)}${token.slice(-4)}` : '未生成';
  const curlExample = `curl -H "X-Api-Token: ${token}" \\\n  http://127.0.0.1:${port}/api/v1/tasks`;

  const copy = async (kind: 'token' | 'curl', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1600);
    } catch (_error) {
      setCopied(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-main relative">
      <div className="flex items-center justify-between px-8 py-4 border-b border-black/5">
        <h1 className="text-xl font-medium text-text-main">本地 API</h1>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              info?.running ? 'bg-emerald-500' : 'bg-black/20'
            )}
          />
          <span className="text-[13px] text-text-muted">
            {error ? '读取失败' : info?.running ? `运行中 · 127.0.0.1:${port}` : '检测中'}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-6">
        <div className="max-w-3xl space-y-6">
          <section className="rounded-xl border border-black/10 bg-white p-5">
            <div className="flex items-center gap-2 mb-4">
              <Plug size={15} className="text-primary" strokeWidth={2} />
              <span className="text-[14px] font-medium text-text-main">连接信息</span>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="w-24 text-[13px] text-text-muted shrink-0">服务地址</span>
                <code className="text-[13px] text-text-main font-mono">http://127.0.0.1:{port}</code>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-24 text-[13px] text-text-muted shrink-0">访问令牌</span>
                <code className="text-[13px] text-text-main font-mono break-all">
                  {revealed ? token || '未生成' : maskedToken}
                </code>
                <button
                  onClick={() => setRevealed((value) => !value)}
                  className="text-text-muted hover:text-text-main transition-colors cursor-pointer"
                  title={revealed ? '隐藏' : '显示'}
                >
                  {revealed ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
                </button>
                <button
                  onClick={() => void copy('token', token)}
                  className="text-text-muted hover:text-text-main transition-colors cursor-pointer"
                  title="复制令牌"
                >
                  {copied === 'token' ? (
                    <Check size={14} strokeWidth={2.5} className="text-emerald-600" />
                  ) : (
                    <Copy size={14} strokeWidth={2} />
                  )}
                </button>
              </div>
              <div className="text-[12px] text-text-muted leading-relaxed pl-[108px]">
                请求需带 <code className="font-mono">X-Api-Token</code> 头；服务只监听本机，重启后令牌不变。
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-black/10 bg-white p-5">
            <div className="text-[14px] font-medium text-text-main mb-4">接口</div>
            <div className="space-y-2">
              {ENDPOINTS.map((endpoint) => (
                <div key={`${endpoint.method}-${endpoint.path}`} className="flex items-center gap-3">
                  <span
                    className={cn(
                      'w-14 shrink-0 text-[11px] font-medium px-2 py-0.5 rounded text-center',
                      endpoint.method === 'GET'
                        ? 'bg-black/5 text-text-muted'
                        : 'bg-primary/10 text-primary'
                    )}
                  >
                    {endpoint.method}
                  </span>
                  <code className="text-[13px] font-mono text-text-main w-[19rem] shrink-0">
                    {endpoint.path}
                  </code>
                  <span className="text-[12px] text-text-muted">{endpoint.desc}</span>
                </div>
              ))}
            </div>
            <div className="text-[12px] text-text-muted mt-4 leading-relaxed">
              状态值：downloading / seeding / paused / completed / failed / stopped。
              createdAt 与 completedAt 是运行时记录，重启后会重新计时，别拿它做精确统计。
            </div>
          </section>

          <section className="rounded-xl border border-black/10 bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[14px] font-medium text-text-main">快速验证</span>
              <button
                onClick={() => void copy('curl', curlExample)}
                className="flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-main transition-colors cursor-pointer"
              >
                {copied === 'curl' ? (
                  <Check size={13} strokeWidth={2.5} className="text-emerald-600" />
                ) : (
                  <Copy size={13} strokeWidth={2} />
                )}
                复制
              </button>
            </div>
            <pre className="text-[12px] leading-6 font-mono text-text-main bg-black/[0.03] border border-black/5 rounded-lg px-4 py-3 overflow-x-auto whitespace-pre">
              {curlExample}
            </pre>
            <div className="text-[12px] text-text-muted mt-3 leading-relaxed">
              令牌明文只在本机显示；如果外泄，删掉应用数据目录下的 api-token 文件再重启即可换新。
            </div>
          </section>

          <section className="rounded-xl border border-black/10 bg-white p-5">
            <div className="text-[14px] font-medium text-text-main mb-4">MCP 接入</div>
            <div className="space-y-4">
              <div>
                <pre className="text-[12px] leading-6 font-mono text-text-main bg-black/[0.03] border border-black/5 rounded-lg px-4 py-3 overflow-x-auto whitespace-pre">
                  {`{
  "mcpServers": {
    "tinyaii": {
      "type": "http",
      "url": "http://127.0.0.1:${port}/mcp",
      "headers": { "X-Api-Token": "<上方复制的令牌>" }
    }
  }
}`}
                </pre>
                <div className="text-[12px] text-text-muted mt-2">
                  支持 HTTP 传输的客户端（Claude Code、Cursor 等）可直接连，无需额外进程。
                </div>
              </div>
            </div>
          </section>

          {error ? <div className="text-[12px] text-red-600">接口不可用：{error}</div> : null}
        </div>
      </div>
    </div>
  );
}

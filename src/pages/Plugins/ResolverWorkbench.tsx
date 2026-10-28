import { useEffect, useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ExternalLink, Link2, Trash2 } from 'lucide-react';
import { useResolverAuthStore } from '../../store/resolverAuth';

export default function ResolverWorkbench() {
  const quarkSession = useResolverAuthStore((state) => state.sessions.quark);
  const bilibiliSession = useResolverAuthStore((state) => state.sessions.bilibili);
  const upsertSession = useResolverAuthStore((state) => state.upsertSession);
  const removeSession = useResolverAuthStore((state) => state.removeSession);
  const [quarkCookieDraft, setQuarkCookieDraft] = useState(() => quarkSession?.cookie || '');
  const [quarkUserAgentDraft, setQuarkUserAgentDraft] = useState(() => quarkSession?.userAgent || '');
  const [bilibiliCookieDraft, setBilibiliCookieDraft] = useState(() => bilibiliSession?.cookie || '');
  const [bilibiliUserAgentDraft, setBilibiliUserAgentDraft] = useState(() => bilibiliSession?.userAgent || '');
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    setQuarkCookieDraft(quarkSession?.cookie || '');
    setQuarkUserAgentDraft(quarkSession?.userAgent || '');
  }, [quarkSession?.cookie, quarkSession?.userAgent]);

  useEffect(() => {
    setBilibiliCookieDraft(bilibiliSession?.cookie || '');
    setBilibiliUserAgentDraft(bilibiliSession?.userAgent || '');
  }, [bilibiliSession?.cookie, bilibiliSession?.userAgent]);

  const quarkUpdatedText = useMemo(() => {
    if (!quarkSession?.updatedAt) return '未配置';
    return new Date(quarkSession.updatedAt).toLocaleString('zh-CN');
  }, [quarkSession?.updatedAt]);

  const bilibiliUpdatedText = useMemo(() => {
    if (!bilibiliSession?.updatedAt) return '未配置';
    return new Date(bilibiliSession.updatedAt).toLocaleString('zh-CN');
  }, [bilibiliSession?.updatedAt]);

  const handleSaveQuark = () => {
    const normalized = quarkCookieDraft.trim();
    if (!normalized) {
      setFeedback('夸克保存失败：请先填写 Cookie');
      return;
    }
    if (!normalized.includes('__puus')) {
      setFeedback('夸克保存失败：Cookie 缺少 __puus，请检查后再保存');
      return;
    }
    upsertSession('quark', {
      cookie: normalized,
      userAgent: quarkUserAgentDraft.trim(),
    });
    setFeedback('已保存夸克登录态');
  };

  const handleClearQuark = () => {
    removeSession('quark');
    setQuarkCookieDraft('');
    setQuarkUserAgentDraft('');
    setFeedback('已清除夸克登录态');
  };

  const handleSaveBilibili = () => {
    const normalized = bilibiliCookieDraft.trim();
    if (!normalized) {
      setFeedback('哔哩保存失败：请先填写 Cookie');
      return;
    }
    if (!normalized.toLowerCase().includes('sessdata=')) {
      setFeedback('哔哩保存失败：Cookie 缺少 SESSDATA，建议重新复制后再保存');
      return;
    }
    upsertSession('bilibili', {
      cookie: normalized,
      userAgent: bilibiliUserAgentDraft.trim(),
    });
    setFeedback('已保存哔哩登录态');
  };

  const handleClearBilibili = () => {
    removeSession('bilibili');
    setBilibiliCookieDraft('');
    setBilibiliUserAgentDraft('');
    setFeedback('已清除哔哩登录态');
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-main overflow-hidden">
      <div className="flex items-center justify-between px-8 py-4 border-b border-black/5">
        <h1 className="text-xl font-medium text-text-main">解析工作台</h1>
        <div className="text-[12px] text-text-muted">
          夸克更新时间：{quarkUpdatedText} ｜ 哔哩更新时间：{bilibiliUpdatedText}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="bg-white border border-black/5 rounded-xl p-5">
            <div className="text-base font-medium text-text-main">夸克网盘登录态</div>
            <div className="text-[13px] text-text-muted mt-2 leading-6">
              打开夸克网页版扫码登录后，将 Cookie 粘贴到这里。保存后，新建任务遇到夸克链接会自动套用该登录态。
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => void openUrl('https://pan.quark.cn/')}
                className="h-8 px-3 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <ExternalLink size={14} />
                打开夸克网页版
              </button>
              <button
                onClick={handleClearQuark}
                className="h-8 px-3 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 size={14} />
                清除登录态
              </button>
            </div>
            <div className="mt-4 text-[12px] text-text-main">Cookie</div>
            <textarea
              value={quarkCookieDraft}
              onChange={(event) => setQuarkCookieDraft(event.target.value)}
              className="mt-1 w-full h-28 rounded-md border border-black/10 bg-white px-3 py-2 text-[13px] text-text-main outline-none focus:border-primary resize-y"
              placeholder="示例：__puus=xxxx; ..."
            />
            <div className="mt-3 text-[12px] text-text-main">User-Agent（可选）</div>
            <input
              value={quarkUserAgentDraft}
              onChange={(event) => setQuarkUserAgentDraft(event.target.value)}
              className="mt-1 w-full h-9 rounded-md border border-black/10 bg-white px-3 text-[13px] text-text-main outline-none focus:border-primary"
              placeholder="留空则沿用任务内 User-Agent"
            />
            <div className="mt-4 flex items-center justify-between">
              <div className="text-[12px] text-text-muted flex items-center gap-1.5">
                <Link2 size={13} />
                当前仅接入夸克示例插件，后续可扩展到 UC/百度。
              </div>
              <button
                onClick={handleSaveQuark}
                className="h-9 px-4 rounded-md bg-primary text-white text-[13px] hover:opacity-90 transition-opacity cursor-pointer"
              >
                保存登录态
              </button>
            </div>
          </div>

          <div className="bg-white border border-black/5 rounded-xl p-5">
            <div className="text-base font-medium text-text-main">哔哩视频登录态</div>
            <div className="text-[13px] text-text-muted mt-2 leading-6">
              打开哔哩视频页后，将浏览器 Cookie 粘贴到这里。保存后，输入 B 站视频链接时会自动解析为音视频直链并提交下载。
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => void openUrl('https://www.bilibili.com/video/BV1BJ4m1e7g8')}
                className="h-8 px-3 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <ExternalLink size={14} />
                打开哔哩网页
              </button>
              <button
                onClick={handleClearBilibili}
                className="h-8 px-3 border border-black/10 rounded-md bg-white hover:bg-black/5 text-[13px] text-text-main transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 size={14} />
                清除登录态
              </button>
            </div>
            <div className="mt-4 text-[12px] text-text-main">Cookie</div>
            <textarea
              value={bilibiliCookieDraft}
              onChange={(event) => setBilibiliCookieDraft(event.target.value)}
              className="mt-1 w-full h-28 rounded-md border border-black/10 bg-white px-3 py-2 text-[13px] text-text-main outline-none focus:border-primary resize-y"
              placeholder="示例：SESSDATA=xxxx; bili_jct=xxxx; ..."
            />
            <div className="mt-3 text-[12px] text-text-main">User-Agent（建议填写）</div>
            <input
              value={bilibiliUserAgentDraft}
              onChange={(event) => setBilibiliUserAgentDraft(event.target.value)}
              className="mt-1 w-full h-9 rounded-md border border-black/10 bg-white px-3 text-[13px] text-text-main outline-none focus:border-primary"
              placeholder="建议与浏览器保持一致，提升高画质可用率"
            />
            <div className="mt-4 flex items-center justify-between">
              <div className="text-[12px] text-text-muted flex items-center gap-1.5">
                <Link2 size={13} />
                支持 BV/av 链接与 ?p=1-3 分 P 范围解析。
              </div>
              <button
                onClick={handleSaveBilibili}
                className="h-9 px-4 rounded-md bg-primary text-white text-[13px] hover:opacity-90 transition-opacity cursor-pointer"
              >
                保存登录态
              </button>
            </div>
          </div>
          {feedback ? <div className="text-[12px] text-text-main px-1">{feedback}</div> : null}
        </div>
      </div>
    </div>
  );
}

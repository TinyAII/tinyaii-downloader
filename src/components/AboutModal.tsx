import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { openUrl } from '@tauri-apps/plugin-opener';
import { X, HelpCircle, Rocket, Copy, RefreshCw, Check } from 'lucide-react';
import { aria2GetEngineStatus } from '../services/download/aria2RpcEngine';
import { getVersion } from '@tauri-apps/api/app';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const feedbackGroupUrl = 'https://qm.qq.com/q/4LdjmUG5Ko';

export default function AboutModal({ isOpen, onClose }: AboutModalProps) {
  const [statusLabel, setStatusLabel] = useState('检测中');
  const [statusColorClass, setStatusColorClass] = useState('bg-yellow-500');
  const [aria2Version, setAria2Version] = useState('加载中...');
  const [features, setFeatures] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const [versionCopied, setVersionCopied] = useState(false);

  useEffect(() => {
    let canceled = false;
    getVersion()
      .then((version) => {
        if (!canceled) setAppVersion(version);
      })
      .catch(() => {
        if (!canceled) setAppVersion('未知');
      });
    return () => {
      canceled = true;
    };
  }, []);

  const copyVersion = async () => {
    if (!appVersion) return;
    try {
      await navigator.clipboard.writeText(appVersion);
      setVersionCopied(true);
      window.setTimeout(() => setVersionCopied(false), 1600);
    } catch (_error) {
      setVersionCopied(false);
    }
  };

  const loadEngineStatus = async (forceRefresh: boolean) => {
    try {
      setRefreshing(true);
      const result = await aria2GetEngineStatus(forceRefresh);
      setAria2Version(result.version);
      setFeatures(result.enabledFeatures);
      if (result.status === 'online') {
        setStatusLabel('在线');
        setStatusColorClass('bg-emerald-500');
      } else if (result.status === 'auth_failed') {
        setStatusLabel('鉴权失败');
        setStatusColorClass('bg-amber-500');
      } else {
        setStatusLabel('离线');
        setStatusColorClass('bg-red-500');
      }
    } catch {
      setStatusLabel('离线');
      setStatusColorClass('bg-red-500');
      setAria2Version('不可用');
      setFeatures([]);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    void loadEngineStatus(false).then(() => {
      if (disposed) return;
    });
    return () => {
      disposed = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-main w-[420px] rounded-xl shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-text-muted hover:text-text-main transition-colors cursor-pointer"
        >
          <X size={20} />
        </button>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-8 flex flex-col items-center">
          {/* Logo */}
          <img
            src="/app-logo.png"
            alt="TinyAii"
            className="w-24 h-24 rounded-2xl shadow-lg border border-black/10 mb-6 object-cover"
          />

          {/* Title */}
          <h2 className="text-2xl font-bold text-text-main mb-6 flex items-center gap-2">
            TinyAii <span className="text-[#e5a038]">下载器</span>
          </h2>

          {/* Versions */}
          <div className="w-full space-y-2 mb-6">
            <div className="flex items-center justify-between px-4 py-2.5 bg-white border border-black/10 rounded-lg">
              <span className="text-[13px] text-text-main font-mono">引擎状态</span>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${statusColorClass}`} />
                <span className="text-[13px] text-text-muted">{statusLabel}</span>
              </div>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 bg-white border border-black/10 rounded-lg">
              <span className="text-[13px] text-text-main font-mono">TinyAii 版本</span>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-text-main">
                  {appVersion ? `v${appVersion}` : '读取中...'}
                </span>
                <button
                  onClick={() => void copyVersion()}
                  title="复制版本号"
                  className="text-text-muted hover:text-text-main cursor-pointer"
                >
                  {versionCopied ? (
                    <Check size={14} strokeWidth={2.5} className="text-emerald-600" />
                  ) : (
                    <Copy size={14} />
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5 bg-white border border-black/10 rounded-lg">
              <span className="text-[13px] text-text-main font-mono">aria2 版本</span>
              <span className="text-[13px] text-text-muted">{aria2Version}</span>
            </div>
            <div className="px-4 py-2.5 bg-white border border-black/10 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-text-main font-mono">已启用特性</span>
                <button
                  className="flex items-center gap-1 text-[12px] text-[#e5a038] hover:text-[#c7892f] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  onClick={() => void loadEngineStatus(true)}
                  disabled={refreshing}
                >
                  <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                  {refreshing ? '刷新中' : '刷新'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {features.length > 0 ? (
                  features.map((item) => (
                    <span
                      key={item}
                      className="px-2 py-0.5 rounded-full text-[11px] bg-[#e5a038]/10 text-[#e5a038] border border-[#e5a038]/30"
                    >
                      {item}
                    </span>
                  ))
                ) : (
                  <span className="text-[12px] text-text-muted">暂无可用特性信息</span>
                )}
              </div>
            </div>
          </div>

          {/* Slogan */}
          <p className="text-[13px] text-text-muted mb-8">
            极简且全能的下载管理器 —— 从零构建。
          </p>

          {/* Tech Stack */}
          <div className="w-full flex flex-col items-center mb-8">
            <span className="text-[30px] font-black tracking-[0.18em] uppercase text-transparent bg-clip-text text-gold-wave drop-shadow-[0_6px_18px_rgba(184,134,11,0.3)]">
              Tiny Aii
            </span>
          </div>

          {/* Links */}
          <div className="w-full grid grid-cols-2 gap-3 mb-8">
            <button
              onClick={() => void openUrl(feedbackGroupUrl)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-black/10 hover:border-black/20 hover:bg-black/5 rounded-lg text-[13px] text-text-main transition-colors cursor-pointer"
            >
              <Rocket size={16} /> 官方Q群
            </button>
            <button
              onClick={() => void openUrl(feedbackGroupUrl)}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-black/10 hover:border-black/20 hover:bg-black/5 rounded-lg text-[13px] text-text-main transition-colors cursor-pointer"
            >
              <HelpCircle size={16} /> 点我反馈
            </button>
          </div>

          {/* Footer */}
          <div className="text-center">
            <p className="text-[15px] font-semibold leading-6 mb-1 text-transparent bg-clip-text text-gold-wave drop-shadow-[0_6px_16px_rgba(184,134,11,0.28)]">
              金麟岂是池中物，一遇风云便化龙。
            </p>
            <p className="text-[12px] text-text-muted/50">
              © 2026 TinyAii
            </p>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

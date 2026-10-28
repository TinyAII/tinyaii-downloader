interface EmptyStateProps {
  showText?: boolean;
  title?: string;
  subtitle?: string;
}

export default function EmptyState({
  showText = true,
  title = 'Tiny Aii',
  subtitle = '静待新的下载浪潮',
}: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center select-none pointer-events-none opacity-70">
      <svg
        width="220"
        height="140"
        viewBox="0 0 220 140"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="mb-7 drop-shadow-[0_10px_24px_rgba(184,134,11,0.18)]"
      >
        <defs>
          <linearGradient id="empty-state-wave-gradient" x1="0" y1="70" x2="220" y2="70" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#8f6100" />
            <stop offset="18%" stopColor="#f8d678" />
            <stop offset="38%" stopColor="#b8860b" />
            <stop offset="58%" stopColor="#fff2b8" />
            <stop offset="78%" stopColor="#c98a00" />
            <stop offset="100%" stopColor="#ffeb9b" />
          </linearGradient>
        </defs>
        <path
          d="M18 88C34 77 50 77 66 88C82 99 98 99 114 88C130 77 146 77 162 88C178 99 194 99 210 88"
          stroke="url(#empty-state-wave-gradient)"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d="M28 63C42 53 56 53 70 63C84 73 98 73 112 63C126 53 140 53 154 63C168 73 182 73 196 63"
          stroke="url(#empty-state-wave-gradient)"
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.92"
        />
        <path
          d="M44 42C56 34 68 34 80 42C92 50 104 50 116 42C128 34 140 34 152 42C164 50 176 50 188 42"
          stroke="url(#empty-state-wave-gradient)"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.8"
        />
        <circle cx="110" cy="24" r="7" fill="#f5cf70" opacity="0.95" />
      </svg>
      <div className="text-[28px] font-black tracking-[0.18em] uppercase text-transparent bg-clip-text text-gold-wave drop-shadow-[0_6px_18px_rgba(184,134,11,0.28)]">
        {title}
      </div>
      {showText && (
        <div className="mt-3 text-[14px] font-semibold tracking-[0.22em] text-transparent bg-clip-text text-gold-wave opacity-85">
          {subtitle}
        </div>
      )}
    </div>
  );
}

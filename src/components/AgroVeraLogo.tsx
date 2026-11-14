import React from 'react';

interface AgroVeraLogoProps {
  tagline?: string;
  compact?: boolean;
  theme?: 'dark' | 'light';
}

export const AgroVeraLogo: React.FC<AgroVeraLogoProps> = ({
  tagline,
  compact = false,
  theme = 'dark',
}) => {
  const wordmarkPrimary = theme === 'dark' ? 'text-white' : 'text-[#0F291E]';
  const wordmarkAccent =
    theme === 'dark' ? 'text-emerald-300' : 'text-emerald-700';
  const subText =
    theme === 'dark' ? 'text-emerald-200/85' : 'text-stone-500';

  return (
    <div className="flex items-center gap-2.5 select-none">
      <div
        className="w-8 h-8 rounded-lg bg-[#163D2C] border border-emerald-400/30 flex items-center justify-center shrink-0"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 32 32"
          className="w-5 h-5"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M16 5C10.8 8.4 8 13.3 8 18.2C8 22.8 11.4 26.2 16 26.8C20.6 26.2 24 22.8 24 18.2C24 13.3 21.2 8.4 16 5Z"
            stroke="#6EE7B7"
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M12.2 17.8L15.1 20.7L20.4 14.6"
            stroke="#ECFDF5"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="min-w-0">
        <div
          className={`text-base font-bold tracking-tight leading-none ${wordmarkPrimary}`}
        >
          Agro<span className={wordmarkAccent}>Vera</span>
        </div>
        {!compact && tagline && (
          <div className={`text-[11px] leading-snug mt-1 ${subText}`}>
            {tagline}
          </div>
        )}
      </div>
    </div>
  );
};

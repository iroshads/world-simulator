import React from 'react';

/**
 * Brand mark: a wireframe globe (meridian + equator) inside a dark tile.
 * Geometry is kept identical to /public/favicon.svg so the tab icon and the
 * in-app logo read as the same mark.
 */
export const LogoMark: React.FC<{ size?: number; className?: string }> = ({ size = 36, className = '' }) => (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="World Simulator">
        <defs>
            <linearGradient id="wsMarkGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#22D3EE" />
                <stop offset="1" stopColor="#A78BFA" />
            </linearGradient>
        </defs>
        <rect width="64" height="64" rx="15" fill="#0B1220" />
        <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="14.25" fill="none" stroke="#FFFFFF" strokeOpacity="0.12" strokeWidth="1.5" />
        <g fill="none" stroke="url(#wsMarkGrad)" strokeWidth="3.2" strokeLinecap="round">
            <circle cx="32" cy="32" r="14.5" />
            <ellipse cx="32" cy="32" rx="6.2" ry="14.5" />
            <path d="M17.5 32h29" />
        </g>
    </svg>
);

export const Logo: React.FC = () => (
    <div className="flex items-center gap-3 select-none flex-shrink-0">
        <LogoMark size={34} className="rounded-[8px] shadow-sm" />
        <div className="leading-none">
            <h1 className="text-[15px] font-bold tracking-[-0.02em] text-slate-900">World Simulator</h1>
            <span className="mt-1 block text-[9px] font-medium tracking-[0.16em] text-slate-400">MULTI-AGENT SANDBOX</span>
        </div>
    </div>
);

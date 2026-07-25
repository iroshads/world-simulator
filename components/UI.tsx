import React from 'react';
import { LucideIcon } from 'lucide-react';

export const Card: React.FC<{ children: React.ReactNode; className?: string; title?: string; action?: React.ReactNode }> =
({ children, className = '', title, action }) => (
    <div className={`bg-white/80 border border-slate-200/80 rounded-2xl overflow-hidden flex flex-col backdrop-blur-md shadow-sm ${className}`}>
        {(title || action) && (
            <div className="px-4 py-2.5 border-b border-slate-100 flex justify-between items-center flex-shrink-0">
                {title && <h3 className="text-[11px] font-semibold text-slate-500 tracking-wide">{title}</h3>}
                {action && <div>{action}</div>}
            </div>
        )}
        <div className="relative flex-1 w-full h-full min-h-0">{children}</div>
    </div>
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    icon?: LucideIcon;
    size?: 'sm' | 'md';
}
export const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', size = 'md', icon: Icon, className = '', ...props }) => {
    const base = 'rounded-xl font-semibold transition-all duration-150 flex items-center justify-center gap-2 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none';
    const sizes = { sm: 'px-3 py-1.5 text-[11px]', md: 'px-4 py-2 text-sm' };
    const variants = {
        primary: 'bg-gradient-to-r from-cyan-500 to-violet-500 hover:from-cyan-400 hover:to-violet-400 text-white shadow-lg shadow-cyan-500/25',
        secondary: 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm',
        ghost: 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/80',
        danger: 'bg-rose-500 hover:bg-rose-400 text-white shadow-lg shadow-rose-500/25',
    };
    return (
        <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>
            {Icon && <Icon size={size === 'sm' ? 13 : 16} strokeWidth={2.2} />}
            {children}
        </button>
    );
};

interface SliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    desc?: string;
    onChange: (val: number) => void;
}
export const Slider: React.FC<SliderProps> = ({ label, value, min, max, step = 1, unit = '', desc, onChange }) => {
    const pct = ((value - min) / (max - min)) * 100;
    return (
        <div className="mb-4.5 mb-5 select-none group" title={desc}>
            <div className="flex justify-between items-center mb-2">
                <label className="text-[11px] font-semibold text-slate-600 group-hover:text-slate-900 transition-colors">{label}</label>
                <span className="text-[10px] font-mono font-bold text-slate-700 bg-gradient-to-r from-cyan-50 to-violet-50 px-2 py-0.5 rounded-full border border-slate-200/80 min-w-[38px] text-center shadow-sm">{value}{unit}</span>
            </div>
            <div className="relative flex items-center h-5 cursor-pointer">
                <div className="absolute w-full h-2 bg-slate-200/70 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-500 to-violet-500" style={{ width: `${pct}%` }} />
                </div>
                <input type="range" min={min} max={max} step={step} value={value}
                    onChange={(e) => onChange(parseFloat(e.target.value))}
                    className="absolute w-full h-6 opacity-0 cursor-pointer z-10" />
                <div className="absolute h-4 w-4 bg-white rounded-full shadow-md ring-2 ring-violet-400/70 pointer-events-none transition-transform group-hover:scale-110 group-active:scale-125"
                    style={{ left: `calc(${pct}% - 8px)` }} />
            </div>
            {desc && <p className="mt-1 text-[9px] text-slate-400 leading-tight opacity-0 group-hover:opacity-100 transition-opacity">{desc}</p>}
        </div>
    );
};

export const Segmented: React.FC<{ options: { id: string; label: string; icon?: LucideIcon }[]; value: string; onChange: (id: string) => void; className?: string }> =
({ options, value, onChange, className = '' }) => (
    <div className={`flex bg-slate-100/80 border border-slate-200/70 rounded-full p-0.5 gap-0.5 ${className}`}>
        {options.map(o => (
            <button key={o.id} onClick={() => onChange(o.id)}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-full text-[10px] font-bold tracking-wide transition-all
                    ${value === o.id ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-600'}`}>
                {o.icon && <o.icon size={11} strokeWidth={2.2} />}
                {o.label}
            </button>
        ))}
    </div>
);

export const Sparkline: React.FC<{ data: number[]; color?: string; width?: number; height?: number; label?: string; value?: string }> =
({ data, color = '#0891b2', width = 120, height = 32, label, value }) => {
    const n = data.length;
    let path = '';
    let areaPath = '';
    if (n >= 2) {
        const min = Math.min(...data), max = Math.max(...data);
        const range = max - min || 1;
        const pts = data.map((v, i) => [
            (i / (n - 1)) * width,
            height - 3 - ((v - min) / range) * (height - 6),
        ]);
        path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
        areaPath = `${path} L${width},${height} L0,${height} Z`;
    }
    return (
        <div className="flex flex-col gap-0.5">
            {(label || value) && (
                <div className="flex justify-between items-baseline">
                    <span className="text-[10px] font-semibold text-slate-500">{label}</span>
                    <span className="text-[10px] font-mono font-bold" style={{ color }}>{value}</span>
                </div>
            )}
            <svg width={width} height={height} className="overflow-visible">
                {areaPath && <path d={areaPath} fill={color} opacity={0.1} />}
                {path && <path d={path} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />}
                {n >= 2 && (() => {
                    const min = Math.min(...data), max = Math.max(...data);
                    const range = max - min || 1;
                    const last = data[n - 1];
                    return <circle cx={width} cy={height - 3 - ((last - min) / range) * (height - 6)} r={2.5} fill={color} />;
                })()}
            </svg>
        </div>
    );
};

export const DemandBar: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
    <div className="flex items-center gap-1.5">
        <span className="text-[9px] font-black w-3" style={{ color }}>{label}</span>
        <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(2, Math.min(100, value))}%`, background: color }} />
        </div>
    </div>
);

import React from 'react';
import { LucideIcon } from 'lucide-react';

interface CardProps {
    children: React.ReactNode;
    className?: string;
    title?: string;
    action?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ children, className = '', title, action }) => (
    <div className={`bg-white border border-slate-200/80 rounded-2xl shadow-premium overflow-hidden flex flex-col hover:border-slate-300 transition-colors duration-300 ${className}`}>
        {(title || action) && (
            <div className="px-5 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 backdrop-blur z-10">
                {title && <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">{title}</h3>}
                {action && <div>{action}</div>}
            </div>
        )}
        <div className="relative flex-1 w-full h-full z-0">{children}</div>
    </div>
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
    icon?: LucideIcon;
    size?: 'sm' | 'md' | 'lg';
}

export const Button: React.FC<ButtonProps> = ({ children, variant = 'primary', size = 'md', icon: Icon, className = '', ...props }) => {
    const base = "rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 active:scale-95";
    const sizes = {
        sm: "px-3 py-1.5 text-xs",
        md: "px-5 py-2.5 text-sm",
        lg: "px-8 py-3.5 text-base"
    };
    const variants = {
        primary: "bg-slate-900 hover:bg-cyan-600 text-white shadow-lg shadow-slate-900/10 hover:shadow-cyan-500/25",
        secondary: "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm",
        outline: "border border-cyan-600 text-cyan-700 hover:bg-cyan-50/50",
        ghost: "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
    };

    return (
        <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props}>
            {Icon && <Icon size={size === 'sm' ? 14 : 18} />}
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
    description?: string;
    onChange: (val: number) => void;
}

export const Slider: React.FC<SliderProps> = ({ label, value, min, max, step = 1, unit = '', description, onChange }) => (
    <div className="mb-6 select-none group">
        <div className="flex justify-between mb-1.5">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider group-hover:text-cyan-600 transition-colors">{label}</label>
            <span className="text-[10px] font-mono font-bold text-cyan-700 bg-cyan-50 px-1.5 py-0.5 rounded border border-cyan-100 min-w-[30px] text-center">{value}{unit}</span>
        </div>
        <div className="relative flex items-center h-3 cursor-pointer">
            <div className="absolute w-full h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                <div 
                    className="h-full bg-gradient-to-r from-cyan-500 to-violet-500 transition-all duration-75" 
                    style={{ width: `${((value - min) / (max - min)) * 100}%` }}
                />
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="absolute w-full h-4 opacity-0 cursor-pointer z-10"
            />
            <div 
                className="absolute h-3 w-3 bg-white border-2 border-slate-900 rounded-full shadow-md pointer-events-none transition-all duration-100 group-hover:scale-125 group-active:scale-110"
                style={{ left: `calc(${((value - min) / (max - min)) * 100}% - 6px)` }}
            />
        </div>
        {description && (
            <p className="mt-1.5 text-[10px] text-slate-400 leading-tight">{description}</p>
        )}
    </div>
);

interface ToggleProps {
    label: string;
    checked: boolean;
    onChange: (val: boolean) => void;
}

export const Toggle: React.FC<ToggleProps> = ({ label, checked, onChange }) => (
    <div className="flex items-center justify-between mb-5 cursor-pointer group select-none" onClick={() => onChange(!checked)}>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider group-hover:text-slate-700 transition-colors">{label}</span>
        <div className={`relative w-9 h-5 rounded-full transition-colors duration-200 border ${checked ? 'bg-cyan-500 border-cyan-600' : 'bg-slate-100 border-slate-200'}`}>
            <span
                className={`absolute top-0.5 left-0.5 bg-white w-3.5 h-3.5 rounded-full shadow-sm transition-transform duration-200 ${checked ? 'translate-x-4' : 'translate-x-0'}`}
            />
        </div>
    </div>
);

export const Badge: React.FC<{ children: React.ReactNode, variant?: 'neutral' | 'good' | 'warning' | 'critical' }> = ({ children, variant = 'neutral' }) => {
    const colors = {
        neutral: 'bg-slate-100 text-slate-600 border-slate-200',
        good: 'bg-emerald-100 text-emerald-800 border-emerald-200',
        warning: 'bg-amber-100 text-amber-800 border-amber-200',
        critical: 'bg-rose-100 text-rose-800 border-rose-200'
    };
    return (
        <span className={`px-2 py-1 rounded-md text-[9px] font-bold uppercase tracking-widest border ${colors[variant]} shadow-sm backdrop-blur-sm bg-opacity-95`}>
            {children}
        </span>
    );
};
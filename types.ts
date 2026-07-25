export enum DomainId {
    WORLD = 'world',
    AUTONOMY = 'autonomy',
    ROBOTICS = 'robotics',
    SOCIAL = 'social',
}

export interface DomainTab {
    id: string;
    label: string;
    icon?: any;
}

export interface SimMetric {
    label: string;
    value: string | number;
    unit?: string;
    status?: 'good' | 'warning' | 'critical' | 'neutral';
    /** key into the history store for sparklines */
    historyKey?: string;
}

export interface SimEvent {
    time: number;      // ms timestamp
    text: string;
    severity: 'info' | 'good' | 'warning' | 'critical';
}

export interface SimInteraction {
    x: number;         // NDC -1..1
    y: number;
    label: string;
    data?: string[];
    visible: boolean;
}

export interface SimTool {
    id: string;
    label: string;
    icon?: any;
    color: string;     // tailwind text color for icon
    hotkey?: string;
    /** tools that support click-drag painting */
    drag?: boolean;
    /** short help text shown when active */
    hint?: string;
}

export interface SliderDef {
    key: string;
    label: string;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    desc?: string;
}

export interface ControlGroup {
    title: string;
    sliders: SliderDef[];
}

export interface Preset {
    id: string;
    label: string;
    settings: Record<string, number>;
}

export interface SimProps {
    settings: Record<string, number>;
    active: boolean;
    activeTool?: string;
    zoom?: number;
    timeScale: number; // 0 = paused, 1/2/4 = speed
    overlay?: string;  // world sim data overlay mode
    onUpdateMetrics: (metrics: SimMetric[], history?: Record<string, number>) => void;
    onHover?: (data: SimInteraction) => void;
    onEvent?: (text: string, severity?: SimEvent['severity']) => void;
}

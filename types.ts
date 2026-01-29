
export interface DomainTab {
    id: string;
    label: string;
    icon?: any;
}

export enum DomainId {
    WORLD = 'world',
    AUTONOMY = 'autonomy',
    SOCIAL = 'social',
    ROBOTICS = 'robotics'
}

export interface SimulationControl {
    id: string;
    label: string;
    type: 'slider' | 'toggle' | 'select';
    min?: number;
    max?: number;
    step?: number;
    value: number | boolean | string;
    options?: string[];
}

export interface SimMetric {
    label: string;
    value: string | number;
    unit?: string;
    status?: 'good' | 'warning' | 'critical' | 'neutral';
    simState?: any;
}

export interface SimInteraction {
    x: number;
    y: number;
    label: string;
    data?: string[];
    visible: boolean;
}

export interface SimTool {
    id: string;
    label: string;
    color: string;
    icon?: any;
}

export interface SimProps {
    settings: Record<string, any>;
    active: boolean;
    activeTool?: string;
    zoom?: number;
    onUpdateMetrics: (metrics: SimMetric[]) => void;
    onHover?: (data: SimInteraction) => void;
}

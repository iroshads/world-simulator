import React, { useState, useEffect, useRef, useCallback } from 'react';
import { WorldSim, WORLD_SAVE_KEY } from './components/simulations/WorldSim';
import { AutonomySim } from './components/simulations/AutonomySim';
import { SocialSim } from './components/simulations/SocialSim';
import { RoboticsSim } from './components/simulations/RoboticsSim';
import { Button, Slider, Segmented, Sparkline, DemandBar } from './components/UI';
import { Logo } from './components/Logo';
import { DomainId, DomainTab, SimMetric, SimInteraction, SimTool, SimEvent, ControlGroup, Preset } from './types';
import {
    Globe, Car, Users, Bot, Home, Factory, Building2, Ban, Eraser, MousePointer2,
    Route, TreePine, Zap, Flame, Crosshair, Radio, ShieldCheck, Package, Plus, Minus,
    Play, Pause, Gauge, RefreshCw, RotateCcw, Activity, Layers, ZoomIn, ZoomOut,
} from 'lucide-react';

/** per-domain starting zoom — city & warehouse read best up close */
const ZOOM_DEFAULTS: Record<string, number> = {
    [DomainId.WORLD]: 1.8,
    [DomainId.AUTONOMY]: 1.3,
    [DomainId.ROBOTICS]: 2.3,
    [DomainId.SOCIAL]: 1.1,
};

const DOMAINS: DomainTab[] = [
    { id: DomainId.WORLD, label: 'World', icon: Globe },
    { id: DomainId.AUTONOMY, label: 'Traffic', icon: Car },
    { id: DomainId.ROBOTICS, label: 'Robotics', icon: Bot },
    { id: DomainId.SOCIAL, label: 'Social', icon: Users },
];

const DEFAULT_SETTINGS: Record<string, Record<string, number>> = {
    [DomainId.WORLD]: { taxRate: 12, cityServices: 50, growthSpeed: 55, trafficDensity: 50, dayLength: 60, weatherIntensity: 30 },
    [DomainId.AUTONOMY]: { trafficDensity: 50, speedLimit: 55, driverAggression: 30, greenDuration: 6, greenWave: 30, adaptiveSignals: 0, roadFriction: 100 },
    [DomainId.SOCIAL]: { connectionDensity: 40, homophily: 60, openness: 30, influenceStrength: 40, radicalization: 25, feedStrength: 50, messageRate: 40 },
    [DomainId.ROBOTICS]: { robotSpeed: 45, taskRate: 40, batteryDrain: 20 },
};

const CONTROL_GROUPS: Record<string, ControlGroup[]> = {
    [DomainId.WORLD]: [
        { title: 'Governance', sliders: [
            { key: 'taxRate', label: 'Tax Rate', min: 0, max: 40, unit: '%', desc: 'Funds the treasury but drags happiness and growth.' },
            { key: 'cityServices', label: 'City Services', min: 0, max: 100, desc: 'Police, fire & sanitation. Costs money, boosts happiness, fights fires faster.' },
        ]},
        { title: 'Development', sliders: [
            { key: 'growthSpeed', label: 'Growth Speed', min: 0, max: 100, desc: 'How fast zones develop when demand exists.' },
            { key: 'trafficDensity', label: 'Traffic Volume', min: 0, max: 100, desc: 'Cars per capita on the road network.' },
        ]},
        { title: 'Environment', sliders: [
            { key: 'dayLength', label: 'Day Length', min: 20, max: 120, unit: 's', desc: 'Real seconds per in-game day.' },
            { key: 'weatherIntensity', label: 'Storm Frequency', min: 0, max: 100, desc: 'Higher = more rain fronts. Rain suppresses fire but dampens mood.' },
        ]},
    ],
    [DomainId.AUTONOMY]: [
        { title: 'Traffic', sliders: [
            { key: 'trafficDensity', label: 'Traffic Density', min: 0, max: 100, desc: 'Target number of vehicles in the network.' },
            { key: 'speedLimit', label: 'Speed Limit', min: 20, max: 120, unit: 'km', desc: 'Desired free-flow speed for all drivers.' },
            { key: 'driverAggression', label: 'Aggression', min: 0, max: 100, desc: 'Shrinks following distance, runs late yellows — and red lights above 75.' },
        ]},
        { title: 'Signal Control', sliders: [
            { key: 'greenDuration', label: 'Green Phase', min: 2, max: 15, unit: 's', desc: 'Green duration per axis at every intersection.' },
            { key: 'greenWave', label: 'Green Wave', min: 0, max: 100, desc: 'Phase offset between neighboring intersections — tune for progressive flow.' },
            { key: 'adaptiveSignals', label: 'Adaptive Mode', min: 0, max: 100, desc: 'Queue-actuated switching: empty greens yield to waiting queues.' },
        ]},
        { title: 'Conditions', sliders: [
            { key: 'roadFriction', label: 'Road Grip', min: 20, max: 140, unit: '%', desc: 'Ice at 20, dry asphalt at 100+. Affects braking distance.' },
        ]},
    ],
    [DomainId.SOCIAL]: [
        { title: 'Network', sliders: [
            { key: 'connectionDensity', label: 'Connectivity', min: 0, max: 100, desc: 'Target follows per account.' },
            { key: 'homophily', label: 'Homophily', min: 0, max: 100, desc: 'Tendency to unfollow accounts you disagree with.' },
        ]},
        { title: 'Psychology', sliders: [
            { key: 'openness', label: 'Open-mindedness', min: 0, max: 100, desc: 'Confidence bound: how different an opinion can be and still persuade.' },
            { key: 'influenceStrength', label: 'Influence', min: 0, max: 100, desc: 'How strongly agents pull each other when they do engage.' },
            { key: 'radicalization', label: 'Backfire Effect', min: 0, max: 100, desc: 'Disagreement pushes opinions further apart instead of nowhere.' },
        ]},
        { title: 'The Algorithm', sliders: [
            { key: 'feedStrength', label: 'Feed Strength', min: 0, max: 100, desc: 'Recommender bias toward similar & popular accounts. The echo-chamber dial.' },
            { key: 'messageRate', label: 'Post Rate', min: 0, max: 100, desc: 'Volume of messages flowing across connections.' },
        ]},
    ],
    [DomainId.ROBOTICS]: [
        { title: 'Fleet', sliders: [
            { key: 'robotSpeed', label: 'Robot Speed', min: 10, max: 100, desc: 'Locomotion speed of every unit.' },
            { key: 'batteryDrain', label: 'Battery Drain', min: 5, max: 100, desc: 'Energy cost of moving & working. Robots self-manage charging.' },
        ]},
        { title: 'Operations', sliders: [
            { key: 'taskRate', label: 'Order Volume', min: 0, max: 100, desc: 'How fast new packages appear on the racks.' },
        ]},
    ],
};

const TOOLS: Record<string, SimTool[]> = {
    [DomainId.WORLD]: [
        { id: 'road', label: 'Road', color: 'text-slate-500', icon: Route, drag: true, hint: 'Drag to draw roads ($5/tile). Zones need road access within 3 tiles.' },
        { id: 'res', label: 'Res', color: 'text-emerald-600', icon: Home, drag: true, hint: 'Residential zone ($20). Grows when jobs & happiness demand it.' },
        { id: 'com', label: 'Com', color: 'text-cyan-600', icon: Building2, drag: true, hint: 'Commercial zone ($20). Needs population to grow.' },
        { id: 'ind', label: 'Ind', color: 'text-amber-600', icon: Factory, drag: true, hint: 'Industrial zone ($20). Jobs + pollution.' },
        { id: 'park', label: 'Park', color: 'text-green-600', icon: TreePine, drag: true, hint: 'Parks ($40) absorb pollution and raise land value.' },
        { id: 'power', label: 'Power', color: 'text-yellow-600', icon: Zap, hint: 'Power plant ($450). Radius coverage + grid capacity.' },
        { id: 'clear', label: 'Doze', color: 'text-rose-600', icon: Eraser, drag: true, hint: 'Bulldoze ($2). Also extinguishes a burning tile.' },
        { id: 'fire', label: 'Fire', color: 'text-orange-600', icon: Flame, hint: 'Ignite a tile. Fire spreads to adjacent buildings & forest.' },
        { id: 'meteor', label: 'Meteor', color: 'text-red-600', icon: Crosshair, hint: 'Call down a meteor strike. Massive crater + firestorm.' },
        { id: 'inspect', label: 'Inspect', color: 'text-slate-500', icon: MousePointer2, hint: 'Left-drag orbits the camera. Hover tiles for live data.' },
    ],
    [DomainId.AUTONOMY]: [
        { id: 'switch', label: 'Signals', color: 'text-emerald-600', icon: MousePointer2, hint: 'Click any intersection to manually flip its phase.' },
        { id: 'spawn', label: 'Surge', color: 'text-cyan-600', icon: Car, hint: 'Click to inject a burst of 8 vehicles.' },
        { id: 'clearWrecks', label: 'Tow', color: 'text-amber-600', icon: RefreshCw, hint: 'Click to clear all wreckage from the roads.' },
    ],
    [DomainId.SOCIAL]: [
        { id: 'viral', label: 'Viral', color: 'text-violet-600', icon: Radio, hint: 'Click an account: its post goes viral, converting followers.' },
        { id: 'botOrange', label: 'Bot+', color: 'text-orange-600', icon: Bot, hint: 'Inject a bot pushing the ORANGE narrative (7 instant follows).' },
        { id: 'botBlue', label: 'Bot−', color: 'text-blue-600', icon: Bot, hint: 'Inject a bot pushing the BLUE narrative.' },
        { id: 'factCheck', label: 'Fact', color: 'text-emerald-600', icon: ShieldCheck, hint: 'Click a region: nearby accounts moderate toward center.' },
        { id: 'ban', label: 'Ban', color: 'text-rose-600', icon: Ban, hint: 'Click an account to remove it and dissolve its connections.' },
    ],
    [DomainId.ROBOTICS]: [
        { id: 'select', label: 'Select', color: 'text-cyan-600', icon: MousePointer2, hint: 'Click a robot to see its live path & LiDAR.' },
        { id: 'package', label: 'Order', color: 'text-amber-600', icon: Package, hint: 'Drop a priority package anywhere on the floor.' },
        { id: 'wall', label: 'Shelf', color: 'text-orange-600', icon: Ban, drag: true, hint: 'Drag to build shelving — robots must re-route around it.' },
        { id: 'erase', label: 'Erase', color: 'text-slate-500', icon: Eraser, drag: true, hint: 'Drag to remove shelving.' },
        { id: 'addBot', label: 'Deploy', color: 'text-emerald-600', icon: Plus, hint: 'Click a free cell to deploy another robot (max 8).' },
        { id: 'removeBot', label: 'Retire', color: 'text-rose-600', icon: Minus, hint: 'Click a robot to decommission it.' },
    ],
};

const PRESETS: Record<string, Preset[]> = {
    [DomainId.WORLD]: [
        { id: 'boom', label: '🏗️ Boom Town', settings: { taxRate: 4, cityServices: 60, growthSpeed: 95, trafficDensity: 70, dayLength: 60, weatherIntensity: 20 } },
        { id: 'green', label: '🌳 Green City', settings: { taxRate: 18, cityServices: 85, growthSpeed: 40, trafficDensity: 25, dayLength: 80, weatherIntensity: 30 } },
        { id: 'storm', label: '⛈️ Storm Season', settings: { taxRate: 12, cityServices: 50, growthSpeed: 55, trafficDensity: 50, dayLength: 45, weatherIntensity: 95 } },
        { id: 'austerity', label: '📉 Austerity', settings: { taxRate: 38, cityServices: 10, growthSpeed: 55, trafficDensity: 50, dayLength: 60, weatherIntensity: 30 } },
    ],
    [DomainId.AUTONOMY]: [
        { id: 'rush', label: '🚗 Rush Hour', settings: { trafficDensity: 95, speedLimit: 55, driverAggression: 55, greenDuration: 6, greenWave: 30, adaptiveSignals: 0, roadFriction: 100 } },
        { id: 'smart', label: '🧠 Smart City', settings: { trafficDensity: 80, speedLimit: 60, driverAggression: 30, greenDuration: 7, greenWave: 65, adaptiveSignals: 100, roadFriction: 100 } },
        { id: 'ice', label: '🧊 Ice Storm', settings: { trafficDensity: 55, speedLimit: 70, driverAggression: 40, greenDuration: 6, greenWave: 30, adaptiveSignals: 0, roadFriction: 25 } },
        { id: 'chaos', label: '💥 Demolition', settings: { trafficDensity: 85, speedLimit: 120, driverAggression: 100, greenDuration: 4, greenWave: 0, adaptiveSignals: 0, roadFriction: 60 } },
    ],
    [DomainId.SOCIAL]: [
        { id: 'healthy', label: '🕊️ Healthy Forum', settings: { connectionDensity: 50, homophily: 20, openness: 85, influenceStrength: 40, radicalization: 5, feedStrength: 15, messageRate: 40 } },
        { id: 'doom', label: '📱 Doomscroll', settings: { connectionDensity: 60, homophily: 85, openness: 20, influenceStrength: 60, radicalization: 65, feedStrength: 95, messageRate: 80 } },
        { id: 'apathy', label: '😴 Disengaged', settings: { connectionDensity: 15, homophily: 40, openness: 30, influenceStrength: 10, radicalization: 10, feedStrength: 30, messageRate: 10 } },
    ],
    [DomainId.ROBOTICS]: [
        { id: 'max', label: '⚡ Max Throughput', settings: { robotSpeed: 90, taskRate: 90, batteryDrain: 25 } },
        { id: 'crisis', label: '🔋 Power Crisis', settings: { robotSpeed: 60, taskRate: 60, batteryDrain: 85 } },
        { id: 'calm', label: '🌙 Night Shift', settings: { robotSpeed: 30, taskRate: 15, batteryDrain: 12 } },
    ],
};

const HISTORY_DEFS: Record<string, { key: string; label: string; color: string }[]> = {
    [DomainId.WORLD]: [
        { key: 'pop', label: 'Population', color: '#0891b2' },
        { key: 'happy', label: 'Happiness', color: '#059669' },
        { key: 'treasury', label: 'Treasury', color: '#d97706' },
        { key: 'pollution', label: 'Pollution', color: '#dc2626' },
    ],
    [DomainId.AUTONOMY]: [
        { key: 'speed', label: 'Avg Speed', color: '#059669' },
        { key: 'throughput', label: 'Throughput', color: '#0891b2' },
    ],
    [DomainId.SOCIAL]: [
        { key: 'polar', label: 'Polarization', color: '#dc2626' },
        { key: 'echo', label: 'Echo %', color: '#7c3aed' },
    ],
    [DomainId.ROBOTICS]: [
        { key: 'delivered', label: 'Delivered', color: '#059669' },
        { key: 'rate', label: 'Rate /min', color: '#0891b2' },
    ],
};

const DESCRIPTIONS: Record<string, string> = {
    [DomainId.WORLD]: 'A living city: zones develop off real supply-and-demand, cars pathfind your road network, power grids brown out, pollution drifts, day turns to night, storms roll in — and fires spread if you let them.',
    [DomainId.AUTONOMY]: 'Nine signalized intersections running IDM car-following physics. Tune the green wave, enable adaptive signals, ice the roads, or crank aggression until the network collapses.',
    [DomainId.SOCIAL]: 'Opinion dynamics on a rewiring social graph. The recommender algorithm decides who follows whom — watch echo chambers emerge, then fight them with fact-checks and bans.',
    [DomainId.ROBOTICS]: 'An autonomous warehouse fleet sharing one task queue: A* pathfinding around each other, self-managed charging, and a delivery pipeline you can disrupt in real time.',
};

const SEV_STYLE: Record<string, string> = {
    info: 'text-slate-600 border-slate-300',
    good: 'text-emerald-700 border-emerald-400',
    warning: 'text-amber-700 border-amber-400',
    critical: 'text-rose-700 border-rose-400',
};

function App() {
    const [activeTab, setActiveTab] = useState<string>(DomainId.WORLD);
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [metrics, setMetrics] = useState<SimMetric[]>([]);
    const [tooltip, setTooltip] = useState<SimInteraction>({ x: 0, y: 0, visible: false, label: '' });
    const [activeTool, setActiveTool] = useState<string | null>('road');
    const [zoom, setZoom] = useState(ZOOM_DEFAULTS[DomainId.WORLD]);
    const [paused, setPaused] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [overlay, setOverlay] = useState('none');
    const [events, setEvents] = useState<SimEvent[]>([]);
    const [epoch, setEpoch] = useState(0);
    const [showLog, setShowLog] = useState(true);

    const historyRef = useRef<Record<string, Record<string, number[]>>>({});
    const [, setHistoryTick] = useState(0);

    const timeScale = paused ? 0 : speed;

    const updateSetting = (key: string, value: number) =>
        setSettings(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], [key]: value } }));

    const handleMetrics = useCallback((m: SimMetric[], hist?: Record<string, number>) => {
        setMetrics(m);
        if (hist) {
            const store = (historyRef.current[activeTab] ??= {});
            for (const [k, v] of Object.entries(hist)) {
                (store[k] ??= []).push(v);
                if (store[k].length > 140) store[k].shift();
            }
            setHistoryTick(t => t + 1);
        }
    }, [activeTab]);

    const handleEvent = useCallback((text: string, severity: SimEvent['severity'] = 'info') => {
        setEvents(prev => [{ time: Date.now(), text, severity }, ...prev].slice(0, 60));
    }, []);

    useEffect(() => {
        setMetrics([]);
        setTooltip(t => ({ ...t, visible: false }));
        setActiveTool(TOOLS[activeTab]?.[0]?.id ?? null);
        setOverlay('none');
        setZoom(ZOOM_DEFAULTS[activeTab] ?? 1.3);
    }, [activeTab]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
            if (e.code === 'Space') { e.preventDefault(); setPaused(p => !p); }
            if (e.key === '1') setActiveTab(DomainId.WORLD);
            if (e.key === '2') setActiveTab(DomainId.AUTONOMY);
            if (e.key === '3') setActiveTab(DomainId.ROBOTICS);
            if (e.key === '4') setActiveTab(DomainId.SOCIAL);
            if (e.key === '+' || e.key === '=') setZoom(z => Math.min(4, z + 0.25));
            if (e.key === '-') setZoom(z => Math.max(0.5, z - 0.25));
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const simProps = {
        settings: settings[activeTab],
        active: true,
        activeTool: activeTool || undefined,
        zoom, timeScale, overlay,
        onUpdateMetrics: handleMetrics,
        onHover: setTooltip,
        onEvent: handleEvent,
    };

    const renderSimulation = () => {
        const key = activeTab + ':' + epoch;
        switch (activeTab) {
            case DomainId.WORLD: return <WorldSim key={key} {...simProps} />;
            case DomainId.AUTONOMY: return <AutonomySim key={key} {...simProps} />;
            case DomainId.SOCIAL: return <SocialSim key={key} {...simProps} />;
            case DomainId.ROBOTICS: return <RoboticsSim key={key} {...simProps} />;
            default: return null;
        }
    };

    const currentTool = TOOLS[activeTab]?.find(t => t.id === activeTool);
    const latestEvent = events[0];
    const hist = historyRef.current[activeTab] ?? {};

    return (
        <div className="h-screen w-full flex flex-col bg-transparent text-slate-800 overflow-hidden">
            {/* ---------- header ---------- */}
            <header className="h-14 px-5 flex-shrink-0 flex items-center gap-5 border-b border-slate-200 bg-white/80 backdrop-blur-md z-40 shadow-sm">
                <Logo />

                {/* tabs */}
                <nav className="flex gap-1 bg-slate-100/70 border border-slate-200/70 rounded-full p-1">
                    {DOMAINS.map((tab, i) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                title={`Shortcut: ${i + 1}`}
                                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[11px] font-bold tracking-wide transition-all
                                    ${isActive ? 'bg-gradient-to-r from-cyan-500 to-violet-500 text-white shadow-md shadow-cyan-500/30' : 'text-slate-500 hover:text-slate-800 hover:bg-white/70'}`}>
                                {Icon && <Icon size={13} strokeWidth={2.4} />}
                                {tab.label}
                            </button>
                        );
                    })}
                </nav>

                <div className="flex-1" />

                {/* time controls */}
                <div className="flex items-center gap-0.5 bg-slate-100/70 border border-slate-200/70 rounded-full p-1">
                    <button onClick={() => setPaused(p => !p)} title="Space"
                        className={`p-1.5 rounded-full transition-colors ${paused ? 'bg-amber-400 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-white/70'}`}>
                        {paused ? <Play size={13} strokeWidth={2.4} /> : <Pause size={13} strokeWidth={2.4} />}
                    </button>
                    {[1, 2, 4].map(s => (
                        <button key={s} onClick={() => { setSpeed(s); setPaused(false); }}
                            className={`px-2.5 py-1 rounded-full text-[10px] font-black font-mono transition-all
                                ${speed === s && !paused ? 'bg-white text-cyan-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-400 hover:text-slate-700'}`}>
                            {s}×
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" icon={ZoomIn} onClick={() => setZoom(z => Math.min(4, z + 0.25))} title="Zoom in (+)" />
                    <Button variant="ghost" size="sm" icon={ZoomOut} onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} title="Zoom out (−)" />
                    <Button variant="secondary" size="sm" icon={RefreshCw}
                        onClick={() => {
                            if (activeTab === DomainId.WORLD) { try { localStorage.removeItem(WORLD_SAVE_KEY); } catch { /* ignore */ } }
                            setEpoch(e => e + 1); setEvents([]); historyRef.current[activeTab] = {};
                        }}
                        title="Regenerate simulation (clears the world autosave)">
                        New Run
                    </Button>
                </div>
            </header>

            {/* ---------- main ---------- */}
            <main className="flex-1 flex min-h-0">
                {/* viewport */}
                <div className="flex-1 relative min-w-0 bg-slate-100">
                    {renderSimulation()}

                    {/* metric chips */}
                    <div className="absolute top-3 left-3 right-3 z-10 flex justify-between items-start pointer-events-none gap-3">
                        <div className="bg-white/90 backdrop-blur-md px-3 py-1.5 rounded-full flex items-center gap-2 border border-slate-200 shadow-lg flex-shrink-0 ring-1 ring-slate-900/5">
                            <div className="relative w-2 h-2">
                                <div className={`absolute w-full h-full rounded-full ${paused ? 'bg-amber-500' : 'bg-emerald-500 animate-ping opacity-60'}`} />
                                <div className={`relative w-full h-full rounded-full ${paused ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                            </div>
                            <span className="text-[9px] font-black tracking-[0.2em] uppercase text-slate-600">
                                {paused ? 'Paused' : `Live · ${speed}×`}
                            </span>
                        </div>
                        <div className="flex gap-1.5 flex-wrap justify-end">
                            {metrics.map((m, i) => (
                                <div key={i} className="bg-white/90 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-200 shadow-md ring-1 ring-slate-900/5 flex flex-col items-end min-w-[68px]">
                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{m.label}</span>
                                    <span className={`font-mono text-[13px] font-black leading-tight ${
                                        m.status === 'good' ? 'text-emerald-600' :
                                        m.status === 'warning' ? 'text-amber-600' :
                                        m.status === 'critical' ? 'text-rose-600' : 'text-slate-700'}`}>
                                        {m.value}<span className="text-[8px] text-slate-400 ml-0.5">{m.unit}</span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* event ticker */}
                    {latestEvent && (
                        <div key={latestEvent.time} className="absolute bottom-3 left-3 z-10 pointer-events-none max-w-[55%] ticker-in">
                            <div className={`bg-white/95 backdrop-blur-md px-3.5 py-2 rounded-xl border-l-4 border shadow-xl ring-1 ring-slate-900/5 flex items-center gap-2.5 ${SEV_STYLE[latestEvent.severity]}`}>
                                <Activity size={13} className="flex-shrink-0 animate-pulse" />
                                <span className="text-[11px] font-mono leading-snug font-medium">{latestEvent.text}</span>
                            </div>
                        </div>
                    )}

                    {/* tool hint */}
                    {currentTool?.hint && (
                        <div className="absolute bottom-3 right-3 z-10 pointer-events-none max-w-[38%]">
                            <div className="bg-white/80 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-200 text-[9px] text-slate-500 font-mono leading-snug shadow-sm">
                                {currentTool.hint}
                            </div>
                        </div>
                    )}

                    {/* orbit hint */}
                    <div className="absolute top-14 left-3 z-10 pointer-events-none">
                        <span className="text-[8px] text-slate-400 font-mono uppercase tracking-widest">right-drag orbit · scroll zoom</span>
                    </div>

                    {/* tooltip */}
                    {tooltip.visible && (
                        <div className="absolute z-30 pointer-events-none bg-slate-900/95 text-white px-3 py-2 rounded-lg shadow-2xl border border-slate-700 backdrop-blur-md -translate-x-1/2 -translate-y-[125%] min-w-[130px]"
                            style={{ left: `${(tooltip.x + 1) * 50}%`, top: `${(-tooltip.y + 1) * 50}%` }}>
                            <div className="text-[10px] font-black uppercase tracking-wider text-cyan-400 mb-1 border-b border-slate-700 pb-1">{tooltip.label}</div>
                            {tooltip.data?.map((line, i) => (
                                <div key={i} className="text-[10px] font-mono text-slate-300 whitespace-nowrap leading-relaxed">{line}</div>
                            ))}
                        </div>
                    )}
                </div>

                {/* ---------- right panel ---------- */}
                <aside className="w-[300px] flex-shrink-0 border-l border-slate-200 bg-white/70 backdrop-blur flex flex-col min-h-0">
                    <div className="p-4 pb-3 flex-shrink-0 border-b border-slate-100">
                        <p className="text-[10px] leading-relaxed text-slate-500">{DESCRIPTIONS[activeTab]}</p>
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-5">
                        {/* tools */}
                        {TOOLS[activeTab] && (
                            <div>
                                <h3 className="text-[10px] font-bold text-slate-400 tracking-wider mb-2">Tools</h3>
                                <div className="grid grid-cols-5 gap-1.5">
                                    {TOOLS[activeTab].map(t => (
                                        <button key={t.id} onClick={() => setActiveTool(t.id)} title={t.hint}
                                            className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border transition-all duration-150
                                                ${activeTool === t.id
                                                    ? 'bg-gradient-to-b from-cyan-500 to-violet-500 border-transparent shadow-lg shadow-cyan-500/25 scale-[1.04]'
                                                    : 'bg-white border-slate-200/80 hover:border-slate-300 hover:shadow-md shadow-sm'}`}>
                                            {t.icon && <t.icon size={15} strokeWidth={2.2} className={activeTool === t.id ? 'text-white' : t.color} />}
                                            <span className={`text-[8px] font-bold tracking-wide ${activeTool === t.id ? 'text-white' : 'text-slate-500'}`}>{t.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* overlays (world only) */}
                        {activeTab === DomainId.WORLD && (
                            <div>
                                <h3 className="text-[10px] font-bold text-slate-400 tracking-wider mb-2 flex items-center gap-1.5"><Layers size={11} strokeWidth={2.2} /> Data Overlay</h3>
                                <Segmented value={overlay} onChange={setOverlay} options={[
                                    { id: 'none', label: 'Map' },
                                    { id: 'value', label: 'Value' },
                                    { id: 'pollution', label: 'Smog' },
                                    { id: 'traffic', label: 'Flow' },
                                    { id: 'happiness', label: 'Mood' },
                                ]} />
                            </div>
                        )}

                        {/* zone demand (world only) */}
                        {activeTab === DomainId.WORLD && (() => {
                            const last = (k: string) => { const a = hist[k]; return a?.length ? a[a.length - 1] : 0; };
                            const toPct = (v: number) => (v + 100) / 2;
                            return (
                                <div>
                                    <h3 className="text-[10px] font-bold text-slate-400 tracking-wider mb-2">Zone Demand</h3>
                                    <div className="space-y-1.5 bg-white border border-slate-200/80 rounded-2xl p-3 shadow-sm">
                                        <DemandBar label="R" value={toPct(last('demandR'))} color="#10b981" />
                                        <DemandBar label="C" value={toPct(last('demandC'))} color="#06b6d4" />
                                        <DemandBar label="I" value={toPct(last('demandI'))} color="#f59e0b" />
                                        <p className="text-[9px] text-slate-400 pt-1 leading-tight">Above the midpoint = citizens want more of that zone.</p>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* presets */}
                        {PRESETS[activeTab] && (
                            <div>
                                <h3 className="text-[10px] font-bold text-slate-400 tracking-wider mb-2 flex items-center gap-1.5"><Gauge size={11} strokeWidth={2.2} /> Scenarios</h3>
                                <div className="grid grid-cols-2 gap-1.5">
                                    {PRESETS[activeTab].map(p => (
                                        <button key={p.id}
                                            onClick={() => { setSettings(prev => ({ ...prev, [activeTab]: { ...p.settings } })); handleEvent(`Scenario loaded: ${p.label}`, 'info'); }}
                                            className="px-2.5 py-2 rounded-xl bg-white border border-slate-200/80 hover:border-violet-300 hover:bg-gradient-to-r hover:from-violet-50 hover:to-cyan-50 hover:shadow-md text-[10px] font-semibold text-slate-600 transition-all text-left shadow-sm">
                                            {p.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* sliders */}
                        {CONTROL_GROUPS[activeTab]?.map(group => (
                            <div key={group.title}>
                                <h3 className="text-[10px] font-bold text-slate-400 tracking-wider mb-2.5">{group.title}</h3>
                                {group.sliders.map(sl => (
                                    <Slider key={sl.key} label={sl.label} min={sl.min} max={sl.max} step={sl.step} unit={sl.unit} desc={sl.desc}
                                        value={settings[activeTab][sl.key] ?? sl.min}
                                        onChange={v => updateSetting(sl.key, v)} />
                                ))}
                            </div>
                        ))}

                        {/* history charts */}
                        {HISTORY_DEFS[activeTab]?.some(d => (hist[d.key]?.length ?? 0) > 2) && (
                            <div>
                                <h3 className="text-[10px] font-bold text-slate-400 tracking-wider mb-2.5">Trends</h3>
                                <div className="grid grid-cols-2 gap-3 bg-white border border-slate-200/80 rounded-2xl p-3 shadow-sm">
                                    {HISTORY_DEFS[activeTab].map(d => {
                                        const data = hist[d.key] ?? [];
                                        if (data.length < 3) return null;
                                        return <Sparkline key={d.key} data={data} color={d.color} label={d.label} value={String(data[data.length - 1])} width={110} height={30} />;
                                    })}
                                </div>
                            </div>
                        )}

                        <Button variant="ghost" size="sm" icon={RotateCcw} className="w-full"
                            onClick={() => setSettings(prev => ({ ...prev, [activeTab]: { ...DEFAULT_SETTINGS[activeTab] } }))}>
                            Reset Parameters
                        </Button>
                    </div>

                    {/* event log */}
                    <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50/80">
                        <button onClick={() => setShowLog(s => !s)} className="w-full px-4 py-2 flex items-center justify-between text-[10px] font-bold text-slate-400 tracking-wider hover:text-slate-600 transition-colors">
                            <span className="flex items-center gap-1.5"><Activity size={11} strokeWidth={2.2} /> Event Log ({events.length})</span>
                            <span>{showLog ? '▾' : '▴'}</span>
                        </button>
                        {showLog && (
                            <div className="max-h-36 overflow-y-auto px-3 pb-3 space-y-1">
                                {events.length === 0 && <p className="text-[10px] text-slate-400 font-mono px-1">Awaiting simulation events…</p>}
                                {events.map((e, i) => (
                                    <div key={e.time + '-' + i} className={`text-[9px] font-mono leading-snug px-2 py-1 rounded border-l-2 bg-white shadow-sm ${SEV_STYLE[e.severity]}`}>
                                        <span className="text-slate-400 mr-1.5">{new Date(e.time).toLocaleTimeString([], { hour12: false })}</span>
                                        {e.text}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </aside>
            </main>

            <footer className="flex-shrink-0 h-7 flex items-center justify-center text-[9px] text-slate-400 bg-white/70 border-t border-slate-200 gap-2">
                <span>Made with ❤️ by <a href="https://www.irosha.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-600 hover:text-cyan-600 transition-colors">Irosha de Silva</a> in San Francisco</span>
                <span className="text-slate-300">·</span>
                <span className="font-mono">SPACE pause · 1-4 domains · +/− zoom</span>
            </footer>
        </div>
    );
}

export default App;

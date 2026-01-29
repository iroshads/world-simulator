
import React, { useState, useEffect, useRef } from 'react';
import { WorldSim } from './components/simulations/WorldSim';
import { AutonomySim } from './components/simulations/AutonomySim';
import { SocialSim } from './components/simulations/SocialSim';
import { RoboticsSim } from './components/simulations/RoboticsSim';
import { Card, Button, Slider, Toggle, Badge } from './components/UI';
import { DomainId, DomainTab, SimMetric, SimInteraction, SimTool } from './types';
import { 
  Globe, Car, Users, Bot, Zap, Package, Activity, MessageSquare, Brain,
  MousePointer2, Home, Factory, Building2, Ban, Eraser, Crosshair, Grid3X3, Plus, Minus,
  Radio, Sparkles, Cpu, Activity as ActivityIcon, Signal
} from 'lucide-react';

const DOMAINS: DomainTab[] = [
    { id: DomainId.WORLD, label: 'World', icon: Globe },
    { id: DomainId.AUTONOMY, label: 'Autonomy', icon: Car },
    { id: DomainId.ROBOTICS, label: 'Robotics', icon: Bot },
    { id: DomainId.SOCIAL, label: 'Social', icon: Users },
];

const DEFAULT_SETTINGS: Record<string, any> = {
    [DomainId.WORLD]: { 
        taxRate: 15, 
        policeFunding: 50, 
        publicServices: 50, 
        indDemand: 60, 
        comDemand: 40,
        growthSpeed: 50,
        amenityDensity: 40
    },
    [DomainId.AUTONOMY]: { 
        trafficDensity: 50, 
        greenLightDuration: 5, 
        driverAggression: 30, 
        roadFriction: 100, 
        speedLimit: 50 
    },
    [DomainId.SOCIAL]: { 
        connectionDensity: 40, 
        homophily: 70, 
        influenceStrength: 30, 
        radicalizationRate: 10,
        openness: 20
    },
    [DomainId.ROBOTICS]: { 
        mapComplexity: 30, 
        sensorNoise: 10, 
        robotSpeed: 40, 
        batteryDrain: 20,
        sensorRange: 5
    },
};

const TOOLS: Record<string, SimTool[]> = {
    [DomainId.WORLD]: [
        { id: 'res', label: 'Zone Res', color: 'bg-emerald-400', icon: Home }, 
        { id: 'com', label: 'Zone Com', color: 'bg-cyan-400', icon: Building2 },
        { id: 'ind', label: 'Zone Ind', color: 'bg-amber-500', icon: Factory },
        { id: 'clear', label: 'Bulldoze', color: 'bg-rose-500', icon: Eraser },
        { id: 'inspect', label: 'Inspect', color: 'bg-slate-400', icon: MousePointer2 },
    ],
    [DomainId.ROBOTICS]: [
        { id: 'target', label: 'Set Goal', color: 'bg-emerald-500', icon: Crosshair },
        { id: 'wall', label: 'Place Wall', color: 'bg-slate-600', icon: Ban },
        { id: 'clear', label: 'Clear', color: 'bg-slate-300', icon: Eraser },
    ]
};

const SIM_DESCRIPTIONS: Record<string, string> = {
    [DomainId.WORLD]: "Cellular Automata City. 'Tax Rate' impacts growth speed. 'Police & Services' boost Citizen Happiness and Land Value. 'Amenity Density' increases park/plaza effectiveness. Happy citizens build taller buildings!",
    [DomainId.AUTONOMY]: "Physics-based Traffic Simulation. Cars calculate braking distance based on 'Road Friction' and Speed. High 'Driver Aggression' causes speeding and red-light running. Collisions occur if safety margins are breached.",
    [DomainId.SOCIAL]: "Social Network Analysis. Agents are visualized as Blue or Orange Nodes. Connections form based on 'Homophily'. 'Signals' represent active data exchange. Click a node to trigger a Data Burst.",
    [DomainId.ROBOTICS]: "Autonomous Humanoid Simulation. The robot ('Optimus') autonomously identifies tasks (Green Boxes), pathfinds to them, and performs a work cycle. It uses head-mounted LiDAR (Red) to scan for obstacles. You can also manually 'Set Goal' or 'Place Wall' to test its adaptability.",
};

const INSIGHT_STYLES: Record<string, { bg: string, border: string, icon: any, color: string, tag: string }> = {
    [DomainId.WORLD]: { 
        bg: 'bg-emerald-950/90', 
        border: 'border-emerald-500/30', 
        icon: Globe, 
        color: 'text-emerald-400',
        tag: 'INSIGHTS ON THE WORLD SIMULATION' 
    },
    [DomainId.AUTONOMY]: { 
        bg: 'bg-amber-950/90', 
        border: 'border-amber-500/30', 
        icon: ActivityIcon, 
        color: 'text-amber-400',
        tag: 'INSIGHTS ON THE TRAFFIC SIMULATION'
    },
    [DomainId.SOCIAL]: { 
        bg: 'bg-violet-950/90', 
        border: 'border-violet-500/30', 
        icon: Signal, 
        color: 'text-violet-400',
        tag: 'INSIGHTS ON THE SOCIAL SIMULATION'
    },
    [DomainId.ROBOTICS]: { 
        bg: 'bg-cyan-950/90', 
        border: 'border-cyan-500/30', 
        icon: Cpu, 
        color: 'text-cyan-400',
        tag: 'INSIGHTS ON THE ROBOTICS SIMULATION'
    }
};

function App() {
    const [activeTab, setActiveTab] = useState<string>(DomainId.WORLD);
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [metrics, setMetrics] = useState<SimMetric[]>([]);
    const [tooltip, setTooltip] = useState<SimInteraction>({x:0, y:0, visible: false, label: ''});
    const [activeTool, setActiveTool] = useState<string | null>('res'); 
    const [zoom, setZoom] = useState(1.5); 
    const [narration, setNarration] = useState<string>("Initializing system protocols...");

    const lastNarrationTime = useRef(0);

    const updateSetting = (domain: string, key: string, value: any) => {
        setSettings(prev => ({
            ...prev,
            [domain]: { ...prev[domain], [key]: value }
        }));
    };

    const handleZoom = (delta: number) => {
        setZoom(prev => Math.max(0.5, Math.min(3, prev + delta)));
    };

    useEffect(() => {
        lastNarrationTime.current = 0;
        setNarration("Calibrating domain sensors...");
    }, [activeTab]);

    const generateNarration = (currentMetrics: SimMetric[]) => {
        if (!currentMetrics || currentMetrics.length === 0) return "Awaiting data stream...";

        const getVal = (label: string) => {
            const m = currentMetrics.find(x => x.label === label);
            if (!m) return 0;
            return typeof m.value === 'string' ? parseFloat(m.value.replace(/,/g, '')) : m.value;
        };
        const getStatus = (label: string) => currentMetrics.find(x => x.label === label)?.value || '';

        let messages: string[] = [];

        if (activeTab === DomainId.WORLD) {
            const pop = getVal('Population');
            const happy = getVal('Happiness');
            const peds = getVal('Pedestrians');
            const value = getVal('Land Value');
            
            if (pop > 1500) messages.push("Metropolis Alert: Housing density is maximized!");
            else if (pop > 800) messages.push("City is thriving. Citizens are moving in.");
            
            if (peds > 300) messages.push("Streets are bustling with activity!");
            
            if (happy > 80) messages.push("Utopian levels of happiness achieved!");
            else if (happy < 40) messages.push("Citizens are requesting better services.");
            
            if (value > 80) messages.push("Property values are sky rocketing.");
        }
        else if (activeTab === DomainId.AUTONOMY) {
            const crashes = getVal('Collisions');
            const vehicles = getVal('Vehicles');
            const avgSpeed = getVal('Avg Speed');
            const lightN = getStatus('Light N');
            
            if (crashes > 5) messages.push("CRITICAL: Multiple accidents detected! Safety protocols failing.");
            else if (crashes > 0) messages.push("Accident reported. Dispatching emergency services.");
            
            if (avgSpeed < 10 && vehicles > 10) messages.push("Gridlock detected. Average speed critical.");
            else if (avgSpeed > 60) messages.push("High speed flow. Efficiency optimal.");
            
            if (lightN === 'RED') messages.push("Northbound intersection holding pattern active.");
            if (lightN === 'GRN') messages.push("Northbound intersection flow released.");
        }
        else if (activeTab === DomainId.SOCIAL) {
            const blue = getVal('Blue Team');
            const orange = getVal('Orange Team');
            const signals = getVal('Signals');
            const echo = getStatus('Echo Chambers');
            
            if (echo === 'Formed') messages.push("Warning: Deep polarization detected. Echo chambers isolated.");
            else messages.push("Social discourse is fluid. Cross-group interaction healthy.");
            
            if (signals > 500) messages.push("Viral Event Detected! Data throughput spiking.");
            
            if (blue > orange * 1.5) messages.push("Blue ideology is dominating the narrative.");
            else if (orange > blue * 1.5) messages.push("Orange ideology is trending heavily.");
            else messages.push("Political balance maintained.");
        }
        else if (activeTab === DomainId.ROBOTICS) {
            const batt = getVal('Battery');
            const status = getStatus('Status');
            
            if (status === 'DEAD') messages.push("CRITICAL FAILURE: Robot systems offline. Battery depleted.");
            else if (status === 'BLOCKED') messages.push("OBSTACLE DETECTED. Re-calculating A* pathfinding...");
            else if (status === 'WORKING') messages.push("Target reached. Executing interaction protocol.");
            else if (status === 'MOVING') messages.push("Traversing grid. Lidar scanning for collisions...");
            else if (status === 'CHARGING') messages.push("Energy restoration in progress. Systems stabilizing.");
            else if (status === 'RETURNING') messages.push("CRITICAL LOW BATTERY. Aborting task. Returning to base.");
            else messages.push("Robot is idle. Awaiting user input or auto-task.");
            
            if (batt < 25 && status !== 'CHARGING' && status !== 'RETURNING' && status !== 'DEAD') messages.push("Low battery warning. Optimization mode engaged.");
        }

        if (messages.length > 0) {
            return messages[Math.floor(Math.random() * messages.length)];
        }
        return "Monitoring system status...";
    };

    const handleMetricsUpdate = (newMetrics: SimMetric[]) => {
        setMetrics(newMetrics);
        const now = Date.now();
        if (now - lastNarrationTime.current > 2500) {
            const text = generateNarration(newMetrics);
            setNarration(text);
            lastNarrationTime.current = now;
        }
    };

    const renderSimulation = () => {
        const props = { 
            settings: settings[activeTab], 
            active: true, 
            onUpdateMetrics: handleMetricsUpdate, 
            onHover: setTooltip,
            activeTool: activeTool || undefined,
            zoom: zoom 
        };
        switch(activeTab) {
            case DomainId.WORLD: return <WorldSim {...props} />;
            case DomainId.AUTONOMY: return <AutonomySim {...props} />;
            case DomainId.SOCIAL: return <SocialSim {...props} />;
            case DomainId.ROBOTICS: return <RoboticsSim {...props} />;
            default: return <div className="flex items-center justify-center h-full text-slate-400">Simulation Domain Loading...</div>;
        }
    };

    useEffect(() => {
        if (TOOLS[activeTab]) setActiveTool(TOOLS[activeTab][0].id);
        else setActiveTool(null);
    }, [activeTab]);

    const renderTools = () => {
        const tools = TOOLS[activeTab];
        if (!tools) return null;

        return (
            <div className="flex gap-2 mb-6 flex-wrap">
                {tools.map((t) => (
                    <button
                        key={t.id}
                        onClick={() => setActiveTool(t.id)}
                        className={`
                            flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-200 border shadow-sm
                            ${activeTool === t.id 
                                ? 'bg-slate-800 text-white border-slate-800 shadow-md ring-2 ring-offset-1 ring-slate-200' 
                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                            }
                        `}
                    >
                        {t.icon && <t.icon size={14} className={activeTool === t.id ? 'text-cyan-400' : t.color.replace('bg-', 'text-')} />}
                        {t.label}
                    </button>
                ))}
            </div>
        );
    };

    const renderControls = () => {
        const currentSettings = settings[activeTab];
        if (!currentSettings) return null;

        return Object.entries(currentSettings).map(([key, value]) => {
            const label = key.replace(/([A-Z])/g, ' $1').trim();
            let min = 0, max = 100, step = 1;
            
            if (key.toLowerCase().includes('duration')) max = 20;
            else if (key.toLowerCase().includes('speed')) max = 100;
            else if (key.toLowerCase().includes('friction')) max = 200;
            else if (key.toLowerCase().includes('homophily') || key.toLowerCase().includes('density')) max = 100;
            else if (key.toLowerCase().includes('tax')) max = 50; 
            else if (key.toLowerCase().includes('funding')) max = 100;
            
            if (typeof value === 'boolean') {
                return <Toggle key={key} label={label} checked={value} onChange={(v) => updateSetting(activeTab, key, v)} />;
            }
            return (
                <Slider
                    key={key}
                    label={label}
                    value={value as number}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(v) => updateSetting(activeTab, key, v)}
                />
            );
        });
    };

    const insightStyle = INSIGHT_STYLES[activeTab] || INSIGHT_STYLES[DomainId.WORLD];
    const InsightIcon = insightStyle.icon;

    return (
        <div className="h-screen w-full flex flex-col bg-slate-50/50 text-slate-900 font-sans selection:bg-cyan-100 overflow-hidden">
            {/* Header */}
            <div className="h-16 px-6 flex-shrink-0 flex items-center border-b border-slate-200/60 bg-white/70 backdrop-blur-md z-50 gap-6">
                 <div className="flex items-center select-none flex-shrink-0 cursor-pointer">
                    <h1 className="text-lg font-black text-slate-900 tracking-tight leading-none hover:text-slate-700 transition-colors">
                        World Simulator
                    </h1>
                 </div>
                 
                 <div className="hidden lg:block h-8 w-px bg-slate-200 flex-shrink-0"></div>

                 <div className="hidden lg:flex flex-1 items-center text-[10px] text-slate-500 leading-relaxed border border-slate-200/60 bg-slate-50/50 rounded-lg px-4 py-2 shadow-sm">
                    <span>Live, multi-domain simulation environment where you can explore how <span className="font-medium text-slate-700">cities grow</span>, <span className="font-medium text-slate-700">traffic systems behave</span>, <span className="font-medium text-slate-700">social networks evolve</span>, and <span className="font-medium text-slate-700">autonomous robots navigate</span>, all powered by adjustable real-time parameters that reveal how complex systems react and self-organize.</span>
                 </div>
            </div>

            <main className="flex-1 flex flex-col min-h-0 max-w-[1600px] w-full mx-auto px-4 py-4">
                <div className="flex overflow-x-auto pb-2 mb-2 gap-2 no-scrollbar flex-shrink-0">
                    {DOMAINS.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => { setActiveTab(tab.id); setMetrics([]); setTooltip({...tooltip, visible: false}); }}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg whitespace-nowrap text-xs font-bold uppercase tracking-wide transition-all duration-300 border
                                    ${isActive 
                                        ? 'bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-900/20 translate-y-[-1px]' 
                                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700 hover:shadow-sm'
                                    }`}
                            >
                                {Icon && <Icon size={14} className={isActive ? 'text-green-500' : 'text-slate-400'} />}
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
                    <div className="lg:col-span-9 flex flex-col min-h-0">
                        <Card className="flex-1 bg-slate-50/50 border-slate-200/80 shadow-2xl shadow-slate-200/50 overflow-hidden group relative rounded-2xl backdrop-blur-sm">
                            <div className="absolute top-5 left-5 right-5 z-10 flex justify-between pointer-events-none">
                                <div className="bg-white/90 backdrop-blur-xl text-slate-800 px-4 py-2 rounded-full flex items-center gap-3 shadow-xl border border-white/60 ring-1 ring-slate-900/5">
                                    <div className="relative w-2 h-2">
                                        <div className="absolute w-full h-full bg-emerald-500 rounded-full animate-ping opacity-75"></div>
                                        <div className="relative w-full h-full bg-emerald-500 rounded-full border border-emerald-400"></div>
                                    </div>
                                    <span className="text-[10px] font-extrabold tracking-widest uppercase text-slate-600">Live Simulation</span>
                                </div>
                                <div className="flex gap-2 flex-wrap justify-end">
                                    {metrics.filter(m => m.label !== 'Pedestrians').map((m, i) => (
                                        <div key={i} className="bg-white/95 backdrop-blur-xl px-4 py-2 rounded-xl border border-white/60 shadow-lg ring-1 ring-slate-900/5 text-xs flex flex-col items-end min-w-[80px]">
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">{m.label}</span>
                                            <span className={`font-mono text-sm font-black ${
                                                m.status === 'good' ? 'text-emerald-500' : 
                                                m.status === 'warning' ? 'text-amber-500' : 
                                                m.status === 'critical' ? 'text-rose-500' : 'text-slate-700'
                                            }`}>
                                                {m.value}<span className="text-[9px] text-slate-400 ml-0.5 font-medium">{m.unit}</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="absolute bottom-6 left-6 z-20 pointer-events-none max-w-[60%]">
                                <div className={`${insightStyle.bg} backdrop-blur-md text-white px-4 py-3 rounded-xl shadow-2xl border ${insightStyle.border} flex items-center gap-3 transform transition-all duration-500 hover:scale-105`}>
                                    <div className="relative">
                                        <InsightIcon size={16} className={`${insightStyle.color} animate-pulse`} />
                                        <div className={`absolute inset-0 ${insightStyle.color} blur-sm opacity-50`}></div>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">{insightStyle.tag}</span>
                                        <span className="text-xs font-mono font-medium tracking-wide leading-tight text-slate-100">
                                            {narration}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <div className="absolute bottom-6 right-6 z-20 flex flex-col gap-2 pointer-events-auto">
                                <button onClick={() => handleZoom(0.5)} className="bg-white hover:bg-slate-50 text-slate-600 p-2 rounded-lg shadow-lg border border-slate-200 active:scale-95 transition-all"><Plus size={18} /></button>
                                <button onClick={() => handleZoom(-0.5)} className="bg-white hover:bg-slate-50 text-slate-600 p-2 rounded-lg shadow-lg border border-slate-200 active:scale-95 transition-all"><Minus size={18} /></button>
                            </div>

                            {tooltip.visible && (
                                <div 
                                    className="absolute z-30 pointer-events-none bg-slate-900/95 text-white px-3 py-2 rounded-lg shadow-xl border border-slate-700 backdrop-blur-md transform -translate-x-1/2 -translate-y-[130%] transition-opacity duration-150 min-w-[120px]"
                                    style={{ left: `${(tooltip.x + 1) * 50}%`, top: `${(-tooltip.y + 1) * 50}%` }}
                                >
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-green-500 mb-1 border-b border-slate-700 pb-1">{tooltip.label}</div>
                                    <div className="flex flex-col gap-0.5">
                                        {tooltip.data?.map((line, i) => (
                                            <div key={i} className="text-[10px] font-mono text-slate-300 whitespace-nowrap">{line}</div>
                                        ))}
                                    </div>
                                    <div className="absolute left-1/2 -bottom-1.5 w-3 h-3 bg-slate-900 transform -translate-x-1/2 rotate-45 border-r border-b border-slate-700"></div>
                                </div>
                            )}
                            
                            <div className="w-full h-full cursor-crosshair">
                                {renderSimulation()}
                            </div>
                        </Card>
                    </div>

                    <div className="lg:col-span-3 flex flex-col min-h-0">
                        <Card title="Control Panel" className="flex-1 bg-white border-slate-200 shadow-xl shadow-slate-200/40">
                            <div className="p-5 flex flex-col h-full overflow-hidden">
                                <div className="mb-4 text-[11px] leading-relaxed text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100 flex-shrink-0">
                                    {SIM_DESCRIPTIONS[activeTab]}
                                </div>
                                
                                {renderTools()}

                                <div className="space-y-6 overflow-y-auto pr-2 flex-1 custom-scrollbar pt-1 min-h-0">
                                    {renderControls()}
                                </div>

                                <div className="mt-4 pt-4 border-t border-slate-100 flex-shrink-0">
                                    <Button variant="ghost" size="sm" className="w-full text-xs text-slate-400 hover:bg-slate-50 hover:text-slate-600" onClick={() => setSettings(prev => ({...prev, [activeTab]: DEFAULT_SETTINGS[activeTab]}))}>
                                        Reset Parameters
                                    </Button>
                                </div>
                            </div>
                        </Card>
                    </div>
                </div>
            </main>

            <div className="flex-shrink-0 py-3 text-center text-[10px] text-slate-400 bg-white/50 backdrop-blur-sm border-t border-slate-200/60">
                Made with ❤️ by <a href="https://www.irosha.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-600 hover:text-cyan-600 transition-colors">Irosha de Silva</a> in San Francisco
            </div>
        </div>
    );
}

export default App;

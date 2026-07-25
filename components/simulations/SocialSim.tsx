import React, { useRef } from 'react';
import * as THREE from 'three';
import { useThreeSim, SimContext } from '../../hooks/useThreeSim';
import { SimProps } from '../../types';

/**
 * Social network with continuous opinion dynamics.
 * Agents hold an opinion in [-1, +1] (blue ↔ orange). Connected agents whose
 * opinions differ less than the confidence bound converge (bounded-confidence
 * model); beyond it, radicalization makes them repel. An "algorithmic feed"
 * rewires the graph toward similar & popular accounts — echo chambers emerge
 * rather than being scripted. Inject bots, trigger viral posts, deploy
 * fact-checkers, or ban accounts.
 */

const BASE_N = 110;
const MAX_N = 220;
const MAX_EDGES = 1400;
const MAX_PULSE = 400;

interface Agent {
    alive: boolean;
    bot: boolean;
    opinion: number;      // -1..1 (bots are pinned)
    influence: number;    // 1..3
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    degree: number;
    viral: number;        // viral boost timer
}
interface Edge { a: number; b: number; }
interface Pulse { a: number; b: number; t: number; op: number; }

export const SocialSim: React.FC<SimProps> = React.memo(({ settings, active, activeTool, zoom, timeScale, onUpdateMetrics, onHover, onEvent }) => {
    const agents = useRef<Agent[]>([]);
    const edges = useRef<Edge[]>([]);
    const pulses = useRef<Pulse[]>([]);
    const stats = useRef({ tickAcc: 0, rewireAcc: 0, metricAcc: 0, echoWarned: false });

    const nodeMesh = useRef<THREE.InstancedMesh | null>(null);
    const botMesh = useRef<THREE.InstancedMesh | null>(null);
    const haloMesh = useRef<THREE.InstancedMesh | null>(null);
    const pulseMesh = useRef<THREE.InstancedMesh | null>(null);
    const lineGeo = useRef<THREE.BufferGeometry | null>(null);

    const settingsRef = useRef(settings); settingsRef.current = settings;
    const toolRef = useRef(activeTool); toolRef.current = activeTool;
    const cbRef = useRef({ onUpdateMetrics, onHover, onEvent });
    cbRef.current = { onUpdateMetrics, onHover, onEvent };

    const opinionColor = (op: number, c: THREE.Color) => {
        // blue (-1) → neutral gray (0) → orange (+1); darker mid reads on light bg
        const t = (op + 1) / 2;
        const blue = new THREE.Color(0x2563eb);
        const mid = new THREE.Color(0x94a3b8);
        const orange = new THREE.Color(0xea580c);
        if (t < 0.5) c.copy(blue).lerp(mid, t * 2);
        else c.copy(mid).lerp(orange, (t - 0.5) * 2);
        return c;
    };

    const init = (ctx: SimContext) => {
        const { scene } = ctx;
        agents.current = [];
        edges.current = [];
        pulses.current = [];
        stats.current = { tickAcc: 0, rewireAcc: 0, metricAcc: 0, echoWarned: false };

        for (let i = 0; i < BASE_N; i++) {
            agents.current.push({
                alive: true, bot: false,
                opinion: (Math.random() * 2 - 1) * 0.75,
                influence: 1 + Math.pow(Math.random(), 3) * 2,
                pos: new THREE.Vector3((Math.random() - 0.5) * 26, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 12),
                vel: new THREE.Vector3(),
                degree: 0, viral: 0,
            });
        }
        // seed random edges
        for (let k = 0; k < BASE_N * 2; k++) {
            const a = Math.floor(Math.random() * BASE_N), b = Math.floor(Math.random() * BASE_N);
            if (a !== b && !edges.current.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) edges.current.push({ a, b });
        }

        const geo = new THREE.SphereGeometry(0.42, 20, 20);
        const mat = new THREE.MeshPhysicalMaterial({ metalness: 0.15, roughness: 0.2, clearcoat: 0.8, emissiveIntensity: 0.35 });
        (mat as any).emissive = new THREE.Color(0xffffff);
        const nm = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.2, emissive: 0x000000 }), MAX_N);
        nm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(nm);
        nodeMesh.current = nm;

        const bm = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ roughness: 0.1, metalness: 0.7, emissive: 0x000000, emissiveIntensity: 0.8 }), 60);
        bm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(bm);
        botMesh.current = bm;

        const hm = new THREE.InstancedMesh(new THREE.RingGeometry(0.62, 0.72, 28), new THREE.MeshBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }), MAX_N);
        hm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(hm);
        haloMesh.current = hm;

        const pm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false }), MAX_PULSE);
        pm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(pm);
        pulseMesh.current = pm;

        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_EDGES * 6), 3));
        lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_EDGES * 6), 3));
        const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false }));
        lines.frustumCulled = false;
        scene.add(lines);
        lineGeo.current = lg;

        ctx.lights.hemi.intensity = 1.15;
        ctx.lights.sun.intensity = 2.0;
    };

    const addBot = (op: number) => {
        if (agents.current.length >= MAX_N) return;
        const i = agents.current.length;
        agents.current.push({
            alive: true, bot: true, opinion: op, influence: 2.6,
            pos: new THREE.Vector3((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10),
            vel: new THREE.Vector3(), degree: 0, viral: 0,
        });
        // bots aggressively connect
        const targets = agents.current.map((a, j) => j).filter(j => j !== i && agents.current[j].alive && !agents.current[j].bot);
        for (let k = 0; k < 7 && targets.length; k++) {
            const j = targets.splice(Math.floor(Math.random() * targets.length), 1)[0];
            edges.current.push({ a: i, b: j });
        }
        cbRef.current.onEvent?.(`Bot account injected (pushing ${op > 0 ? 'ORANGE' : 'BLUE'} narrative) with 7 instant follows.`, 'warning');
    };

    // ---- opinion dynamics tick ----
    const tick = (dt: number) => {
        const A = agents.current, E = edges.current;
        const s = settingsRef.current;
        const bound = 0.25 + ((s.openness ?? 30) / 100) * 1.1;       // confidence bound
        const mu = 0.10 + ((s.influenceStrength ?? 40) / 100) * 0.25; // convergence rate
        const radical = (s.radicalization ?? 25) / 100;
        const msgRate = (s.messageRate ?? 40) / 100;

        for (const e of E) {
            const a = A[e.a], b = A[e.b];
            if (!a?.alive || !b?.alive) continue;
            const diff = b.opinion - a.opinion;
            const ad = Math.abs(diff);
            if (ad < bound) {
                const wa = (b.influence + b.viral * 2) / 2, wb = (a.influence + a.viral * 2) / 2;
                if (!a.bot) a.opinion += mu * diff * wa * dt * 4;
                if (!b.bot) b.opinion -= mu * diff * wb * dt * 4;
            } else if (radical > 0) {
                // backfire effect
                if (!a.bot) a.opinion -= Math.sign(diff) * radical * 0.06 * dt * 4;
                if (!b.bot) b.opinion += Math.sign(diff) * radical * 0.06 * dt * 4;
            }
            if (Math.random() < msgRate * dt * 1.2 && pulses.current.length < MAX_PULSE) {
                const fromA = Math.random() < 0.5;
                pulses.current.push({ a: fromA ? e.a : e.b, b: fromA ? e.b : e.a, t: 0, op: (fromA ? a : b).opinion });
            }
        }
        for (const a of A) {
            if (!a.alive || a.bot) continue;
            a.opinion += (Math.random() - 0.5) * 0.01;  // noise
            a.opinion = Math.max(-1, Math.min(1, a.opinion * (1 - 0.002 * dt))); // slight mean reversion
            if (a.viral > 0) a.viral = Math.max(0, a.viral - dt * 0.5);
        }
    };

    // ---- algorithmic feed rewiring ----
    const rewire = () => {
        const A = agents.current, E = edges.current;
        const s = settingsRef.current;
        const homophily = (s.homophily ?? 60) / 100;
        const feed = (s.feedStrength ?? 50) / 100;
        const targetEdges = Math.min(MAX_EDGES, Math.round(A.filter(a => a.alive).length * (1 + (s.connectionDensity ?? 40) / 25)));

        // degrees
        for (const a of A) a.degree = 0;
        for (const e of E) { A[e.a].degree++; A[e.b].degree++; }

        // popularity begets influence: well-followed accounts slowly become influencers
        for (const a of A) {
            if (!a.alive || a.bot) continue;
            const target = 1 + Math.min(2.2, a.degree / 7);
            a.influence += (target - a.influence) * 0.06;
        }

        // unfollow: drop most-discordant edges with prob homophily
        for (let k = E.length - 1; k >= 0; k--) {
            const e = E[k];
            const a = A[e.a], b = A[e.b];
            if (!a?.alive || !b?.alive) { E.splice(k, 1); continue; }
            const disagreement = Math.abs(a.opinion - b.opinion);
            if (disagreement > 1.0 && Math.random() < homophily * 0.25) E.splice(k, 1);
        }

        // follow suggestions: preferential attachment × similarity (the "algorithm")
        let attempts = 0;
        while (E.length < targetEdges && attempts < 60) {
            attempts++;
            const ai = Math.floor(Math.random() * A.length);
            const a = A[ai];
            if (!a?.alive) continue;
            let best = -1, bestScore = -1;
            for (let k = 0; k < 8; k++) {
                const bi = Math.floor(Math.random() * A.length);
                const b = A[bi];
                if (bi === ai || !b?.alive) continue;
                const sim = 1 - Math.abs(a.opinion - b.opinion) / 2;
                const popularity = Math.min(1, b.degree / 10) + b.viral;
                const score = feed * (sim * 0.7 + popularity * 0.5) + (1 - feed) * Math.random();
                if (score > bestScore) { bestScore = score; best = bi; }
            }
            if (best >= 0 && !E.some(e => (e.a === ai && e.b === best) || (e.a === best && e.b === ai))) {
                E.push({ a: ai, b: best });
            }
        }
    };

    const animate = (ctx: SimContext) => {
        const A = agents.current, E = edges.current;
        const s = settingsRef.current;
        const dt = ctx.dt;
        const st = stats.current;

        st.tickAcc += dt;
        while (st.tickAcc >= 0.15) { st.tickAcc -= 0.15; tick(0.15); }
        st.rewireAcc += dt;
        if (st.rewireAcc >= 1) { st.rewireAcc = 0; rewire(); }

        // ---- force layout ----
        const radical = (s.radicalization ?? 25) / 100;
        for (let i = 0; i < A.length; i++) {
            const a = A[i];
            if (!a.alive) continue;
            // spatial sorting by opinion (visualizes polarization)
            const targetX = a.opinion * (8 + radical * 14);
            a.vel.x += (targetX - a.pos.x) * 0.004;
            a.vel.addScaledVector(a.pos, -0.0018); // center gravity
            for (let j = i + 1; j < A.length; j++) {
                const b = A[j];
                if (!b.alive) continue;
                const dx = a.pos.x - b.pos.x, dy = a.pos.y - b.pos.y, dz = a.pos.z - b.pos.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < 16 && d2 > 0.001) {
                    const f = 0.06 / d2;
                    a.vel.x += dx * f; a.vel.y += dy * f; a.vel.z += dz * f;
                    b.vel.x -= dx * f; b.vel.y -= dy * f; b.vel.z -= dz * f;
                }
            }
        }
        const tmp = new THREE.Vector3();
        for (const e of E) {
            const a = A[e.a], b = A[e.b];
            if (!a?.alive || !b?.alive) continue;
            tmp.copy(b.pos).sub(a.pos);
            const d = tmp.length() || 0.01;
            const agree = Math.abs(a.opinion - b.opinion) < 0.6;
            const rest = agree ? 3.2 : 6.5;
            const k = agree ? 0.012 : 0.005;
            tmp.normalize().multiplyScalar((d - rest) * k);
            a.vel.add(tmp); b.vel.sub(tmp);
        }
        for (const a of A) {
            if (!a.alive) continue;
            a.vel.multiplyScalar(0.9);
            a.pos.addScaledVector(a.vel, Math.min(2, dt * 60));
            a.pos.clamp(new THREE.Vector3(-32, -20, -16), new THREE.Vector3(32, 20, 16));
        }

        // ---- render nodes ----
        const nm = nodeMesh.current!, bm = botMesh.current!, hm = haloMesh.current!;
        const dummy = new THREE.Object3D();
        const col = new THREE.Color();
        let ni = 0, bi = 0, hi = 0;
        for (const a of A) {
            if (!a.alive) continue;
            const scale = a.influence * (1 + a.viral * 0.5);
            dummy.position.copy(a.pos);
            dummy.scale.setScalar(a.bot ? 1.2 : scale);
            dummy.rotation.set(0, a.bot ? ctx.wallTime * 1.5 : 0, 0);
            dummy.updateMatrix();
            opinionColor(a.opinion, col);
            if (a.bot && bi < 60) { bm.setMatrixAt(bi, dummy.matrix); bm.setColorAt(bi, col); bi++; }
            else if (ni < MAX_N) { nm.setMatrixAt(ni, dummy.matrix); nm.setColorAt(ni, col); ni++; }
            if ((a.influence > 2.4 || a.viral > 0.2 || a.bot) && hi < MAX_N) {
                dummy.scale.setScalar(scale * 1.6 + Math.sin(ctx.wallTime * 3 + a.pos.x) * 0.15);
                dummy.rotation.set(ctx.wallTime * 0.6, ctx.wallTime * 0.8, 0);
                dummy.updateMatrix();
                hm.setMatrixAt(hi++, dummy.matrix);
            }
        }
        dummy.position.set(0, -900, 0); dummy.scale.setScalar(0); dummy.updateMatrix();
        for (let i = ni; i < MAX_N; i++) nm.setMatrixAt(i, dummy.matrix);
        for (let i = bi; i < 60; i++) bm.setMatrixAt(i, dummy.matrix);
        for (let i = hi; i < MAX_N; i++) hm.setMatrixAt(i, dummy.matrix);
        nm.instanceMatrix.needsUpdate = true; if (nm.instanceColor) nm.instanceColor.needsUpdate = true;
        bm.instanceMatrix.needsUpdate = true; if (bm.instanceColor) bm.instanceColor.needsUpdate = true;
        hm.instanceMatrix.needsUpdate = true;

        // ---- edges ----
        const lg = lineGeo.current!;
        const posA = lg.attributes.position.array as Float32Array;
        const colA = lg.attributes.color.array as Float32Array;
        let li = 0;
        const cA = new THREE.Color(), cB = new THREE.Color();
        for (const e of E) {
            if (li >= MAX_EDGES * 6) break;
            const a = A[e.a], b = A[e.b];
            if (!a?.alive || !b?.alive) continue;
            const conflict = Math.abs(a.opinion - b.opinion) > 0.9;
            opinionColor(a.opinion, cA); opinionColor(b.opinion, cB);
            if (conflict) { cA.lerp(new THREE.Color(0xff2244), 0.5); cB.lerp(new THREE.Color(0xff2244), 0.5); }
            posA[li] = a.pos.x; colA[li++] = cA.r; posA[li] = a.pos.y; colA[li++] = cA.g; posA[li] = a.pos.z; colA[li++] = cA.b;
            posA[li] = b.pos.x; colA[li++] = cB.r; posA[li] = b.pos.y; colA[li++] = cB.g; posA[li] = b.pos.z; colA[li++] = cB.b;
        }
        for (let i = li; i < posA.length; i++) posA[i] = 0;
        lg.attributes.position.needsUpdate = true;
        lg.attributes.color.needsUpdate = true;

        // ---- pulses ----
        const pm = pulseMesh.current!;
        const nextP: Pulse[] = [];
        let pi = 0;
        for (const p of pulses.current) {
            p.t += dt * 1.6;
            const a = A[p.a], b = A[p.b];
            if (p.t >= 1 || !a?.alive || !b?.alive) continue;
            tmp.copy(a.pos).lerp(b.pos, p.t);
            dummy.position.copy(tmp);
            dummy.scale.setScalar(1 + Math.sin(p.t * Math.PI) * 1.4);
            dummy.updateMatrix();
            if (pi < MAX_PULSE) {
                pm.setMatrixAt(pi, dummy.matrix);
                pm.setColorAt(pi, opinionColor(p.op, col));
                pi++;
            }
            nextP.push(p);
        }
        pulses.current = nextP;
        dummy.position.set(0, -900, 0); dummy.scale.setScalar(0); dummy.updateMatrix();
        for (let i = pi; i < MAX_PULSE; i++) pm.setMatrixAt(i, dummy.matrix);
        pm.instanceMatrix.needsUpdate = true;
        if (pm.instanceColor) pm.instanceColor.needsUpdate = true;

        // ---- hover ----
        if (cbRef.current.onHover && Math.floor(ctx.wallTime * 10) % 2 === 0) {
            const hit = pickAgent(ctx);
            if (hit >= 0) {
                const a = A[hit];
                cbRef.current.onHover({
                    x: ctx.mouse.x, y: ctx.mouse.y, visible: true,
                    label: a.bot ? '🤖 Bot Account' : a.influence > 2 ? '⭐ Influencer' : 'User',
                    data: [
                        `Opinion: ${a.opinion > 0 ? '+' : ''}${a.opinion.toFixed(2)} ${a.opinion > 0.3 ? '(orange)' : a.opinion < -0.3 ? '(blue)' : '(moderate)'}`,
                        `Followers: ${a.degree}`, `Influence: ${a.influence.toFixed(1)}×`,
                        a.viral > 0 ? '🔥 VIRAL' : '',
                    ].filter(Boolean),
                });
            } else cbRef.current.onHover({ x: 0, y: 0, visible: false, label: '' });
        }

        // ---- metrics ----
        st.metricAcc += dt || 0.016;
        if (st.metricAcc > 0.5) {
            st.metricAcc = 0;
            const alive = A.filter(a => a.alive);
            const ops = alive.map(a => a.opinion);
            const mean = ops.reduce((x, y) => x + y, 0) / (ops.length || 1);
            const variance = ops.reduce((x, y) => x + (y - mean) ** 2, 0) / (ops.length || 1);
            const polarization = Math.sqrt(variance);
            let sameSide = 0, total = 0;
            for (const e of E) {
                const a = A[e.a], b = A[e.b];
                if (!a?.alive || !b?.alive) continue;
                total++;
                if (Math.sign(a.opinion) === Math.sign(b.opinion) && Math.abs(a.opinion) > 0.15 && Math.abs(b.opinion) > 0.15) sameSide++;
            }
            const echoPct = total ? Math.round((sameSide / total) * 100) : 0;
            const bots = alive.filter(a => a.bot).length;
            const extremists = Math.round((ops.filter(o => Math.abs(o) > 0.75).length / (ops.length || 1)) * 100);

            if (echoPct > 80 && polarization > 0.6 && !st.echoWarned) {
                st.echoWarned = true;
                cbRef.current.onEvent?.('Echo chambers locked in — over 80% of connections are now same-side. Discourse has collapsed.', 'critical');
            } else if (echoPct < 60) st.echoWarned = false;

            cbRef.current.onUpdateMetrics([
                { label: 'Agents', value: alive.length, status: 'neutral' },
                { label: 'Polarization', value: polarization.toFixed(2), status: polarization > 0.7 ? 'critical' : polarization > 0.45 ? 'warning' : 'good', historyKey: 'polar' },
                { label: 'Echo', value: echoPct, unit: '%', status: echoPct > 75 ? 'critical' : echoPct > 55 ? 'warning' : 'good', historyKey: 'echo' },
                { label: 'Extremists', value: extremists, unit: '%', status: extremists > 40 ? 'critical' : 'neutral' },
                { label: 'Connections', value: E.length, status: 'neutral' },
                { label: 'Bots', value: bots, status: bots > 0 ? 'warning' : 'good' },
                { label: 'Lean', value: (mean >= 0 ? '+' : '') + mean.toFixed(2), status: Math.abs(mean) > 0.4 ? 'warning' : 'neutral' },
            ], { polar: Math.round(polarization * 100), echo: echoPct });
        }
    };

    const pickAgent = (ctx: SimContext): number => {
        let best = -1, bestD = 1.4;
        const v = new THREE.Vector3();
        for (let i = 0; i < agents.current.length; i++) {
            const a = agents.current[i];
            if (!a.alive) continue;
            ctx.raycaster.ray.closestPointToPoint(a.pos, v);
            const d = v.distanceTo(a.pos);
            if (d < bestD * a.influence * 0.7 + 0.5 && d < bestD + 1) { bestD = d; best = i; }
        }
        return best;
    };

    const onClick = (ctx: SimContext) => {
        const tool = toolRef.current;
        if (tool === 'botOrange') { addBot(0.95); return; }
        if (tool === 'botBlue') { addBot(-0.95); return; }

        const hit = pickAgent(ctx);
        if (hit < 0) return;
        const A = agents.current;
        const a = A[hit];

        if (tool === 'factCheck') {
            let n = 0;
            for (const b of A) {
                if (!b.alive || b.bot) continue;
                if (b.pos.distanceTo(a.pos) < 9) { b.opinion *= 0.35; n++; }
            }
            cbRef.current.onEvent?.(`Fact-check deployed — ${n} accounts moderated toward center.`, 'good');
            return;
        }
        if (tool === 'ban') {
            a.alive = false;
            edges.current = edges.current.filter(e => e.a !== hit && e.b !== hit);
            cbRef.current.onEvent?.(a.bot ? 'Bot account banned and removed from the network.' : 'Account banned. Its connections dissolve.', a.bot ? 'good' : 'warning');
            return;
        }
        // default: viral post
        a.viral = 2;
        const layer1 = edges.current.filter(e => e.a === hit || e.b === hit);
        for (const e of layer1) {
            const other = e.a === hit ? e.b : e.a;
            if (pulses.current.length < MAX_PULSE) pulses.current.push({ a: hit, b: other, t: 0, op: a.opinion });
            const b = A[other];
            if (b.alive && !b.bot) b.opinion += (a.opinion - b.opinion) * 0.3;
        }
        for (const b of A) {
            if (!b.alive) continue;
            const d = b.pos.distanceTo(a.pos);
            if (d < 10 && d > 0.1) b.vel.addScaledVector(b.pos.clone().sub(a.pos).normalize(), 2.5 / d);
        }
        cbRef.current.onEvent?.(`Viral post from ${a.bot ? 'a bot' : 'an account'} (${a.opinion > 0 ? 'orange' : 'blue'} lean) reached ${layer1.length} followers instantly.`, 'info');
    };

    const mount = useThreeSim({
        init, animate, onClick,
        active, zoom: zoom ?? 1.1, timeScale,
        cameraType: 'perspective',
        cameraPos: [0, 6, 40],
        leftOrbits: false,
        background: 0xeef2f8,
    });

    return <div ref={mount} className="w-full h-full" />;
});

import React, { useRef } from 'react';
import * as THREE from 'three';
import { useThreeSim, SimContext } from '../../hooks/useThreeSim';
import { SimProps } from '../../types';

/**
 * Autonomous warehouse: a fleet of humanoid robots working a shared task queue.
 * Packages appear on shelf racks; robots claim the nearest task, A* to it
 * (treating other robots as dynamic obstacles), carry the package to a dispatch
 * dock, and manage their own battery — queueing at chargers when low.
 */

const GRID = 22;
const OFF = GRID / 2;

type BotStatus = 'IDLE' | 'TO_PICKUP' | 'PICKING' | 'TO_DOCK' | 'DROPPING' | 'TO_CHARGER' | 'CHARGING' | 'STUCK';

interface Task { cell: number; claimed: number; } // claimed: robot idx or -1
interface Bot {
    id: number;
    pos: THREE.Vector3;
    angle: number;
    status: BotStatus;
    path: number[];
    pathIdx: number;
    battery: number;
    task: number;      // index into tasks, -1 none
    timer: number;
    stuck: number;
    delivered: number;
    model: THREE.Group;
    carry: THREE.Mesh;
}

export const RoboticsSim: React.FC<SimProps> = React.memo(({ settings, active, activeTool, zoom, timeScale, onUpdateMetrics, onHover, onEvent }) => {
    const walls = useRef<Uint8Array>(new Uint8Array(GRID * GRID));
    const tasks = useRef<Task[]>([]);
    const bots = useRef<Bot[]>([]);
    const stats = useRef({ delivered: 0, spawnAcc: 0, metricAcc: 0, selected: -1, botSeq: 0, startTime: 0 });

    const floorMesh = useRef<THREE.InstancedMesh | null>(null);
    const pkgMesh = useRef<THREE.InstancedMesh | null>(null);
    const singles = useRef<Record<string, any>>({});
    const sceneRef = useRef<THREE.Scene | null>(null);

    const settingsRef = useRef(settings); settingsRef.current = settings;
    const toolRef = useRef(activeTool); toolRef.current = activeTool;
    const cbRef = useRef({ onUpdateMetrics, onHover, onEvent });
    cbRef.current = { onUpdateMetrics, onHover, onEvent };

    const DOCKS = [GRID * (GRID - 1) + 4, GRID * (GRID - 1) + 10, GRID * (GRID - 1) + 16];
    const CHARGERS = [0, 1, GRID, GRID + 1];

    const c2xz = (i: number): [number, number] => [(i % GRID) - OFF + 0.5, Math.floor(i / GRID) - OFF + 0.5];
    const xz2c = (x: number, z: number): number => {
        const gx = Math.floor(x + OFF), gz = Math.floor(z + OFF);
        if (gx < 0 || gx >= GRID || gz < 0 || gz >= GRID) return -1;
        return gz * GRID + gx;
    };

    // ---------- A* ----------
    const astar = (from: number, to: number, blocked?: Set<number>): number[] | null => {
        if (from === to) return [];
        const W = walls.current;
        const h = (i: number) => Math.abs((i % GRID) - (to % GRID)) + Math.abs(Math.floor(i / GRID) - Math.floor(to / GRID));
        const open = new Map<number, number>([[from, h(from)]]);
        const g = new Map<number, number>([[from, 0]]);
        const prev = new Map<number, number>();
        const closed = new Set<number>();
        while (open.size) {
            let cur = -1, best = Infinity;
            for (const [k, f] of open) if (f < best) { best = f; cur = k; }
            if (cur === to) {
                const path: number[] = [];
                let c = to;
                while (c !== from) { path.push(c); c = prev.get(c)!; }
                return path.reverse();
            }
            open.delete(cur); closed.add(cur);
            const gx = cur % GRID, gz = Math.floor(cur / GRID);
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = gx + dx, nz = gz + dz;
                if (nx < 0 || nx >= GRID || nz < 0 || nz >= GRID) continue;
                const ni = nz * GRID + nx;
                if (W[ni] === 1 || closed.has(ni) || (blocked?.has(ni) && ni !== to)) continue;
                const ng = g.get(cur)! + 1;
                if (ng < (g.get(ni) ?? Infinity)) {
                    g.set(ni, ng); prev.set(ni, cur);
                    open.set(ni, ng + h(ni));
                }
            }
            if (closed.size > 500) return null;
        }
        return null;
    };

    // ---------- robot model ----------
    const RM = {
        white: new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.25 }),
        black: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4 }),
        joint: new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3, metalness: 0.3 }),
    };
    const buildRobot = (): THREE.Group => {
        const group = new THREE.Group();
        const s = 0.32; group.scale.set(s, s, s);
        const torso = new THREE.Group(); torso.position.y = 2.8; group.add(torso);
        group.userData.torso = torso;
        const chest = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 0.8), RM.white); chest.position.y = 0.6; chest.castShadow = true; torso.add(chest);
        const abs = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.8, 8), RM.black); abs.position.y = -0.4; torso.add(abs);
        const head = new THREE.Group(); head.position.y = 1.4; torso.add(head);
        group.userData.head = head;
        head.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.8), RM.white));
        const visorGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.6, 16, 1, false, 0, Math.PI); visorGeo.rotateZ(Math.PI / 2);
        const visorMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, emissive: 0x06b6d4, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.1 });
        const visor = new THREE.Mesh(visorGeo, visorMat); visor.position.set(0, 0.05, 0.35); head.add(visor);
        group.userData.visorMat = visorMat;
        const mkArm = (side: 1 | -1) => {
            const arm = new THREE.Group(); arm.position.set(side * 0.9, 1.1, 0); torso.add(arm);
            arm.add(new THREE.Mesh(new THREE.SphereGeometry(0.32), RM.joint));
            const ua = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.2), RM.black); ua.position.y = -0.6; arm.add(ua);
            const fa = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 1.1), RM.white); fa.position.y = -1.7; arm.add(fa);
            return arm;
        };
        group.userData.armL = mkArm(1); group.userData.armR = mkArm(-1);
        const hips = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 0.7), RM.white); hips.position.y = -0.9; torso.add(hips);
        const mkLeg = (side: 1 | -1) => {
            const leg = new THREE.Group(); leg.position.set(side * 0.4, -0.9, 0); torso.add(leg);
            const th = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 1.4), RM.white); th.position.y = -0.7; leg.add(th);
            const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 1.4), RM.black); sh.position.y = -2.1; leg.add(sh);
            const ft = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.5), RM.white); ft.position.set(0, -2.85, 0.1); leg.add(ft);
            return leg;
        };
        group.userData.legL = mkLeg(1); group.userData.legR = mkLeg(-1);
        // carried package
        const carry = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshStandardMaterial({ color: 0xc08a4d, roughness: 0.8 }));
        carry.position.set(0, 0.4, 1.0);
        carry.visible = false;
        torso.add(carry);
        group.userData.carry = carry;
        // battery bar (sprite-like plane above head)
        const bar = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.18), new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false }));
        bar.position.y = 5.4;
        group.add(bar);
        group.userData.bar = bar;
        return group;
    };

    const spawnBot = (cell: number) => {
        if (!sceneRef.current || bots.current.length >= 8) return false;
        if (walls.current[cell] === 1) return false;
        const model = buildRobot();
        sceneRef.current.add(model);
        const [x, z] = c2xz(cell);
        const bot: Bot = {
            id: stats.current.botSeq++,
            pos: new THREE.Vector3(x, 0, z), angle: 0,
            status: 'IDLE', path: [], pathIdx: 0,
            battery: 70 + Math.random() * 30, task: -1, timer: 0, stuck: 0, delivered: 0,
            model, carry: model.userData.carry,
        };
        bots.current.push(bot);
        return true;
    };

    // ---------- init ----------
    const init = (ctx: SimContext) => {
        const { scene } = ctx;
        sceneRef.current = scene;
        bots.current = [];
        tasks.current = [];
        stats.current = { delivered: 0, spawnAcc: 0, metricAcc: 0, selected: -1, botSeq: 0, startTime: 0 };

        // warehouse layout: shelf racks
        const W = walls.current; W.fill(0);
        for (let row = 3; row < GRID - 4; row += 3) {
            for (let gx = 3; gx < GRID - 3; gx++) {
                if (gx % 7 === 6) continue; // aisles
                W[row * GRID + gx] = 1;
            }
        }
        for (const c of [...DOCKS, ...CHARGERS]) W[c] = 0;

        // floor
        const fGeo = new THREE.BoxGeometry(0.96, 0.15, 0.96); fGeo.translate(0, -0.075, 0);
        const fm = new THREE.InstancedMesh(fGeo, new THREE.MeshStandardMaterial({ roughness: 0.7 }), GRID * GRID);
        fm.receiveShadow = true;
        scene.add(fm);
        floorMesh.current = fm;

        // packages
        const pGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5); pGeo.translate(0, 0.25, 0);
        const pm = new THREE.InstancedMesh(pGeo, new THREE.MeshStandardMaterial({ color: 0xc08a4d, roughness: 0.8 }), 60);
        pm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        pm.castShadow = true;
        scene.add(pm);
        pkgMesh.current = pm;

        // dock pads
        for (const d of DOCKS) {
            const [x, z] = c2xz(d);
            const pad = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.9), new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x10b981, emissiveIntensity: 0.4 }));
            pad.position.set(x, 0.03, z);
            scene.add(pad);
        }
        // chargers
        for (const c of CHARGERS) {
            const [x, z] = c2xz(c);
            const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.42, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 }));
            base.position.set(x, 0.05, z);
            scene.add(base);
            const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.18), new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.9 }));
            crystal.position.set(x, 0.5, z);
            (crystal as any).userData.base = 0.5;
            scene.add(crystal);
            (singles.current.crystals ??= []).push(crystal);
        }

        // path visualizer for selected bot
        const pathLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x0e7490, transparent: true, opacity: 0.95 }));
        scene.add(pathLine);
        singles.current.pathLine = pathLine;

        // lidar
        const lidar = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xdb2777, transparent: true, opacity: 0.55 }));
        scene.add(lidar);
        singles.current.lidar = lidar;

        // cursor + plane
        const cur = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 1), new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.6 }));
        cur.visible = false; scene.add(cur);
        singles.current.cursor = cur;
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ visible: false }));
        plane.rotation.x = -Math.PI / 2; scene.add(plane);
        singles.current.plane = plane;

        // initial fleet + tasks
        spawnBot(2 * GRID + 5);
        spawnBot(2 * GRID + 12);
        spawnBot(7 * GRID + 8);
        for (let i = 0; i < 4; i++) spawnTask();

        ctx.lights.hemi.intensity = 0.85;
    };

    const spawnTask = () => {
        if (tasks.current.length >= 40) return;
        const W = walls.current;
        // spawn adjacent to a shelf
        for (let tries = 0; tries < 40; tries++) {
            const i = Math.floor(Math.random() * GRID * GRID);
            if (W[i] === 1 || DOCKS.includes(i) || CHARGERS.includes(i)) continue;
            const gx = i % GRID, gz = Math.floor(i / GRID);
            const nearShelf = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
                const nx = gx + dx, nz = gz + dz;
                return nx >= 0 && nx < GRID && nz >= 0 && nz < GRID && W[nz * GRID + nx] === 1;
            });
            if (!nearShelf) continue;
            if (tasks.current.some(t => t.cell === i)) continue;
            tasks.current.push({ cell: i, claimed: -1 });
            return;
        }
    };

    // ---------- FSM ----------
    const setPath = (b: Bot, target: number): boolean => {
        const occupied = new Set<number>();
        for (const o of bots.current) if (o !== b) occupied.add(xz2c(o.pos.x, o.pos.z));
        const from = xz2c(b.pos.x, b.pos.z);
        if (from < 0) return false;
        const p = astar(from, target, occupied);
        if (!p) {
            const p2 = astar(from, target); // ignore robots
            if (!p2) return false;
            b.path = p2;
        } else b.path = p;
        b.pathIdx = 0;
        return true;
    };

    const stepBot = (b: Bot, i: number, dt: number, ctx: SimContext) => {
        const s = settingsRef.current;
        const speed = Math.max(0.5, (s.robotSpeed ?? 45) / 22);
        const drain = (s.batteryDrain ?? 20) / 100;

        const moving = b.status === 'TO_PICKUP' || b.status === 'TO_DOCK' || b.status === 'TO_CHARGER';
        if (moving || b.status === 'PICKING' || b.status === 'DROPPING') b.battery = Math.max(0, b.battery - drain * dt * (moving ? 2.2 : 1.2));

        // low battery override
        if (b.battery < 18 && b.status !== 'TO_CHARGER' && b.status !== 'CHARGING') {
            if (b.task >= 0 && tasks.current[b.task]) tasks.current[b.task].claimed = -1;
            b.task = -1; b.carry.visible = false;
            const free = CHARGERS.filter(c => !bots.current.some(o => o !== b && xz2c(o.pos.x, o.pos.z) === c));
            const target = free[0] ?? CHARGERS[b.id % CHARGERS.length];
            if (setPath(b, target)) { b.status = 'TO_CHARGER'; cbRef.current.onEvent?.(`Unit-${b.id + 1} battery low (${Math.round(b.battery)}%) — heading to charger.`, 'warning'); }
            else b.status = 'STUCK';
        }

        switch (b.status) {
            case 'IDLE': {
                b.timer += dt;
                if (b.timer < 0.4) break;
                b.timer = 0;
                // claim nearest unclaimed task
                let best = -1, bestD = Infinity;
                for (let t = 0; t < tasks.current.length; t++) {
                    const task = tasks.current[t];
                    if (task.claimed >= 0) continue;
                    const [tx, tz] = c2xz(task.cell);
                    const d = Math.abs(tx - b.pos.x) + Math.abs(tz - b.pos.z);
                    if (d < bestD) { bestD = d; best = t; }
                }
                if (best >= 0 && setPath(b, tasks.current[best].cell)) {
                    tasks.current[best].claimed = b.id;
                    b.task = best;
                    b.status = 'TO_PICKUP';
                }
                break;
            }
            case 'TO_PICKUP': case 'TO_DOCK': case 'TO_CHARGER': {
                if (b.pathIdx >= b.path.length) {
                    if (b.status === 'TO_PICKUP') { b.status = 'PICKING'; b.timer = 0; }
                    else if (b.status === 'TO_DOCK') { b.status = 'DROPPING'; b.timer = 0; }
                    else { b.status = 'CHARGING'; }
                    break;
                }
                const nextCell = b.path[b.pathIdx];
                // dynamic obstacle: another robot on next cell → wait, then replan
                const occupiedBy = bots.current.find(o => o !== b && xz2c(o.pos.x, o.pos.z) === nextCell);
                if (occupiedBy) {
                    b.stuck += dt;
                    if (b.stuck > 1.2) {
                        b.stuck = 0;
                        const goal = b.path[b.path.length - 1];
                        setPath(b, goal);
                    }
                    break;
                }
                b.stuck = 0;
                const [nx, nz] = c2xz(nextCell);
                const dx = nx - b.pos.x, dz = nz - b.pos.z;
                const dist = Math.hypot(dx, dz);
                const targetAngle = Math.atan2(dx, dz);
                let ad = targetAngle - b.angle;
                while (ad > Math.PI) ad -= Math.PI * 2;
                while (ad < -Math.PI) ad += Math.PI * 2;
                b.angle += ad * Math.min(1, dt * 10);
                const eff = Math.abs(ad) > 0.5 ? 0 : speed;
                if (dist < 0.12) b.pathIdx++;
                else {
                    b.pos.x += Math.sin(b.angle) * eff * dt;
                    b.pos.z += Math.cos(b.angle) * eff * dt;
                }
                break;
            }
            case 'PICKING': {
                b.timer += dt;
                if (b.timer > 1.1) {
                    // grab package
                    if (b.task >= 0 && tasks.current[b.task]) {
                        tasks.current.splice(b.task, 1);
                        // reindex claims
                        for (const o of bots.current) if (o.task > b.task) o.task--;
                        b.task = -1;
                    }
                    b.carry.visible = true;
                    const dock = DOCKS[Math.floor(Math.random() * DOCKS.length)];
                    if (setPath(b, dock)) b.status = 'TO_DOCK';
                    else b.status = 'STUCK';
                }
                break;
            }
            case 'DROPPING': {
                b.timer += dt;
                if (b.timer > 0.9) {
                    b.carry.visible = false;
                    b.delivered++;
                    stats.current.delivered++;
                    if (stats.current.delivered % 10 === 0) cbRef.current.onEvent?.(`Fleet milestone: ${stats.current.delivered} packages dispatched! 📦`, 'good');
                    b.status = 'IDLE'; b.timer = 0;
                }
                break;
            }
            case 'CHARGING': {
                b.battery = Math.min(100, b.battery + dt * 14);
                if (b.battery >= 96) { b.status = 'IDLE'; b.timer = 0; }
                break;
            }
            case 'STUCK': {
                b.timer += dt;
                if (b.timer > 2) { b.timer = 0; b.status = 'IDLE'; }
                break;
            }
        }

        // ---- animation ----
        const m = b.model;
        m.position.set(b.pos.x, m.position.y, b.pos.z);
        m.rotation.y = b.angle;
        const { armL, armR, legL, legR, torso, head, visorMat, bar } = m.userData;
        const f = ctx.time * 9 + i * 2;
        if (moving && b.pathIdx < b.path.length) {
            const sw = Math.sin(f);
            armL.rotation.x = sw * 0.6; armR.rotation.x = -sw * 0.6;
            legL.rotation.x = -sw * 0.7; legR.rotation.x = sw * 0.7;
            m.position.y = Math.abs(Math.cos(f)) * 0.05;
            torso.rotation.x = 0.08;
        } else if (b.status === 'PICKING' || b.status === 'DROPPING') {
            const pr = Math.min(1, b.timer / 0.9);
            const squat = Math.sin(pr * Math.PI);
            m.position.y = -squat * 0.22;
            torso.rotation.x = squat * 0.5;
            armL.rotation.x = -squat * 1.4; armR.rotation.x = -squat * 1.4;
        } else {
            const breath = Math.sin(ctx.wallTime * 2 + i) * 0.04;
            armL.rotation.x *= 0.9; armR.rotation.x *= 0.9;
            legL.rotation.x *= 0.9; legR.rotation.x *= 0.9;
            torso.rotation.x = breath * 0.5;
            m.position.y = 0;
        }
        head.rotation.y = Math.sin(ctx.wallTime * 1.2 + i * 3) * 0.4;
        visorMat.emissive.setHex(
            b.status === 'CHARGING' ? 0xfacc15 :
            b.status === 'STUCK' ? 0xef4444 :
            b.status === 'TO_CHARGER' ? 0xf59e0b :
            b.carry.visible ? 0x10b981 : 0x06b6d4);
        // battery bar
        bar.scale.x = Math.max(0.02, b.battery / 100);
        (bar.material as THREE.MeshBasicMaterial).color.setHex(b.battery > 50 ? 0x22c55e : b.battery > 20 ? 0xeab308 : 0xef4444);
        bar.lookAt(ctx.camera.position);
    };

    // ---------- animate ----------
    const animate = (ctx: SimContext) => {
        const dt = ctx.dt;
        const s = settingsRef.current;
        const st = stats.current;
        if (st.startTime === 0) st.startTime = ctx.time;

        // task spawner
        st.spawnAcc += dt;
        const interval = Math.max(0.6, 8 - (s.taskRate ?? 40) * 0.07);
        if (st.spawnAcc > interval) { st.spawnAcc = 0; spawnTask(); }

        for (let i = 0; i < bots.current.length; i++) stepBot(bots.current[i], i, dt, ctx);

        // ---- floor render ----
        const fm = floorMesh.current!;
        const dummy = new THREE.Object3D();
        const col = new THREE.Color();
        const W = walls.current;
        for (let i = 0; i < GRID * GRID; i++) {
            const [x, z] = c2xz(i);
            const isWall = W[i] === 1;
            dummy.position.set(x, isWall ? 0.6 : 0, z);
            dummy.scale.set(1, isWall ? 9 : 1, 1);
            dummy.updateMatrix();
            fm.setMatrixAt(i, dummy.matrix);
            if (isWall) {
                const seed = Math.abs(Math.sin(i * 12.9898)) % 1;
                col.setHSL(0.08, 0.42, 0.42 + seed * 0.16);
            } else {
                const check = ((i % GRID) + Math.floor(i / GRID)) % 2 === 0;
                col.setHex(check ? 0xf4f7fa : 0xe3e9f1);
                if (DOCKS.includes(i)) col.setHex(0xbfe8d2);
                if (CHARGERS.includes(i)) col.setHex(0xf3e3ad);
            }
            fm.setColorAt(i, col);
        }
        fm.instanceMatrix.needsUpdate = true;
        if (fm.instanceColor) fm.instanceColor.needsUpdate = true;

        // ---- packages ----
        const pm = pkgMesh.current!;
        let pi = 0;
        for (const t of tasks.current) {
            const [x, z] = c2xz(t.cell);
            dummy.position.set(x, Math.sin(ctx.wallTime * 2 + t.cell) * 0.06 + 0.05, z);
            dummy.rotation.set(0, ctx.wallTime * 0.8 + t.cell, 0);
            dummy.scale.setScalar(1);
            dummy.updateMatrix();
            if (pi < 60) pm.setMatrixAt(pi++, dummy.matrix);
        }
        dummy.position.set(0, -500, 0); dummy.scale.setScalar(0); dummy.updateMatrix();
        for (let i = pi; i < 60; i++) pm.setMatrixAt(i, dummy.matrix);
        pm.instanceMatrix.needsUpdate = true;

        // ---- chargers glow ----
        for (const c of singles.current.crystals ?? []) {
            c.rotation.y += dt * 2;
            c.position.y = c.userData.base + Math.sin(ctx.wallTime * 3) * 0.08;
        }

        // ---- selected bot: path + lidar ----
        const sel = bots.current.find(b => b.id === st.selected);
        const pathLine = singles.current.pathLine as THREE.Line;
        const lidar = singles.current.lidar as THREE.LineSegments;
        if (sel && sel.path.length && sel.pathIdx < sel.path.length) {
            const pts = [sel.pos.clone().setY(0.08)];
            for (let k = sel.pathIdx; k < sel.path.length; k++) {
                const [x, z] = c2xz(sel.path[k]);
                pts.push(new THREE.Vector3(x, 0.08, z));
            }
            pathLine.geometry.setFromPoints(pts);
            pathLine.visible = true;
        } else pathLine.visible = false;

        if (sel) {
            const rays = 28, range = 5;
            const lp: number[] = [];
            const hp = sel.pos.clone().add(new THREE.Vector3(0, 1.35, 0));
            for (let r = 0; r < rays; r++) {
                const a = (r / rays) * Math.PI * 2 + ctx.wallTime * 1.5;
                const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
                let hit = range;
                for (let d = 0.4; d < range; d += 0.4) {
                    const ci = xz2c(sel.pos.x + dir.x * d, sel.pos.z + dir.z * d);
                    if (ci < 0 || W[ci] === 1) { hit = d; break; }
                }
                const end = hp.clone().addScaledVector(dir, hit);
                end.y = Math.max(0.05, end.y - hit * 0.25);
                lp.push(hp.x, hp.y, hp.z, end.x, end.y, end.z);
            }
            lidar.geometry.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
            lidar.visible = true;
        } else lidar.visible = false;

        // ---- cursor / hover ----
        const ints = ctx.raycaster.intersectObject(singles.current.plane);
        const cursor = singles.current.cursor as THREE.Mesh;
        let hoverCell = -1;
        if (ints.length) hoverCell = xz2c(ints[0].point.x, ints[0].point.z);
        if (hoverCell >= 0 && toolRef.current && toolRef.current !== 'select') {
            const [x, z] = c2xz(hoverCell);
            cursor.position.set(x, 0.3, z);
            cursor.visible = true;
            (cursor.material as THREE.MeshBasicMaterial).color.setHex(
                toolRef.current === 'wall' ? 0xb45309 : toolRef.current === 'erase' ? 0xe2e8f0 :
                toolRef.current === 'package' ? 0xc08a4d : toolRef.current === 'addBot' ? 0x22d3ee : 0x22d3ee);
        } else cursor.visible = false;

        if (cbRef.current.onHover && Math.floor(ctx.wallTime * 10) % 2 === 0) {
            // hover robot?
            let hovBot: Bot | null = null;
            if (ints.length) {
                for (const b of bots.current) {
                    if (Math.hypot(b.pos.x - ints[0].point.x, b.pos.z - ints[0].point.z) < 0.8) { hovBot = b; break; }
                }
            }
            if (hovBot) {
                cbRef.current.onHover({
                    x: ctx.mouse.x, y: ctx.mouse.y, visible: true,
                    label: `Unit-${hovBot.id + 1}`,
                    data: [`Status: ${hovBot.status}`, `Battery: ${Math.round(hovBot.battery)}%`, `Delivered: ${hovBot.delivered}`, 'Click to select'],
                });
            } else if (hoverCell >= 0) {
                const isWall = W[hoverCell] === 1;
                const isDock = DOCKS.includes(hoverCell);
                const isCharger = CHARGERS.includes(hoverCell);
                const hasPkg = tasks.current.some(t => t.cell === hoverCell);
                cbRef.current.onHover({
                    x: ctx.mouse.x, y: ctx.mouse.y, visible: true,
                    label: isDock ? 'Dispatch Dock' : isCharger ? 'Charging Pad' : isWall ? 'Shelf Rack' : hasPkg ? 'Package (task)' : 'Open Floor',
                    data: [],
                });
            } else cbRef.current.onHover({ x: 0, y: 0, visible: false, label: '' });
        }

        // ---- metrics ----
        st.metricAcc += dt || 0.016;
        if (st.metricAcc > 0.5) {
            st.metricAcc = 0;
            const fleet = bots.current;
            const avgBatt = fleet.length ? fleet.reduce((a, b) => a + b.battery, 0) / fleet.length : 0;
            const busy = fleet.filter(b => b.status !== 'IDLE' && b.status !== 'CHARGING' && b.status !== 'STUCK').length;
            const util = fleet.length ? Math.round((busy / fleet.length) * 100) : 0;
            const elapsedMin = Math.max(0.15, (ctx.time - st.startTime) / 60);
            cbRef.current.onUpdateMetrics([
                { label: 'Fleet', value: fleet.length, status: 'neutral' },
                { label: 'Delivered', value: st.delivered, status: 'good', historyKey: 'delivered' },
                { label: 'Rate', value: (st.delivered / elapsedMin).toFixed(1), unit: '/min', status: 'neutral', historyKey: 'rate' },
                { label: 'Queue', value: tasks.current.length, status: tasks.current.length > 20 ? 'warning' : 'neutral' },
                { label: 'Utilization', value: util, unit: '%', status: util > 70 ? 'good' : 'neutral' },
                { label: 'Avg Battery', value: Math.round(avgBatt), unit: '%', status: avgBatt < 25 ? 'critical' : avgBatt < 45 ? 'warning' : 'good' },
            ], { delivered: st.delivered, rate: Math.round((st.delivered / elapsedMin) * 10) / 10 });
        }
    };

    // ---------- interaction ----------
    const onClick = (ctx: SimContext) => {
        const ints = ctx.raycaster.intersectObject(singles.current.plane);
        if (!ints.length) return;
        const pt = ints[0].point;
        const cell = xz2c(pt.x, pt.z);
        if (cell < 0) return;
        const tool = toolRef.current;
        const W = walls.current;

        if (tool === 'select' || !tool) {
            for (const b of bots.current) {
                if (Math.hypot(b.pos.x - pt.x, b.pos.z - pt.z) < 0.9) {
                    stats.current.selected = stats.current.selected === b.id ? -1 : b.id;
                    cbRef.current.onEvent?.(stats.current.selected >= 0 ? `Unit-${b.id + 1} selected — path & LiDAR shown.` : 'Selection cleared.', 'info');
                    return;
                }
            }
            stats.current.selected = -1;
            return;
        }
        if (tool === 'wall') { if (!DOCKS.includes(cell) && !CHARGERS.includes(cell)) { W[cell] = 1; tasks.current = tasks.current.filter(t => t.cell !== cell); } return; }
        if (tool === 'erase') { W[cell] = 0; return; }
        if (tool === 'package') {
            if (W[cell] === 0 && !tasks.current.some(t => t.cell === cell)) {
                tasks.current.push({ cell, claimed: -1 });
                cbRef.current.onEvent?.('Priority package placed on the floor.', 'info');
            }
            return;
        }
        if (tool === 'addBot') {
            if (spawnBot(cell)) cbRef.current.onEvent?.(`New robot deployed — fleet size ${bots.current.length}.`, 'good');
            else cbRef.current.onEvent?.('Cannot deploy: cell blocked or fleet at max (8).', 'warning');
            return;
        }
        if (tool === 'removeBot') {
            for (let i = 0; i < bots.current.length; i++) {
                const b = bots.current[i];
                if (Math.hypot(b.pos.x - pt.x, b.pos.z - pt.z) < 0.9) {
                    if (b.task >= 0 && tasks.current[b.task]) tasks.current[b.task].claimed = -1;
                    sceneRef.current?.remove(b.model);
                    bots.current.splice(i, 1);
                    cbRef.current.onEvent?.(`Unit-${b.id + 1} decommissioned.`, 'warning');
                    return;
                }
            }
        }
    };

    const onPaint = (ctx: SimContext) => {
        const tool = toolRef.current;
        if (tool !== 'wall' && tool !== 'erase') return;
        const ints = ctx.raycaster.intersectObject(singles.current.plane);
        if (!ints.length) return;
        const cell = xz2c(ints[0].point.x, ints[0].point.z);
        if (cell < 0) return;
        if (tool === 'wall' && !DOCKS.includes(cell) && !CHARGERS.includes(cell)) { walls.current[cell] = 1; tasks.current = tasks.current.filter(t => t.cell !== cell); }
        if (tool === 'erase') walls.current[cell] = 0;
    };

    const mount = useThreeSim({
        init, animate, onClick, onPaint,
        active, zoom: zoom ?? 1.6, timeScale,
        cameraType: 'orthographic',
        cameraPos: [30, 34, 30],
        leftOrbits: false,
        background: 0xe8edf5,
    });

    return <div ref={mount} className="w-full h-full" />;
});

import React, { useRef } from 'react';
import * as THREE from 'three';
import { useThreeSim, SimContext } from '../../hooks/useThreeSim';
import { SimProps } from '../../types';

// ---------- helpers ----------
const mulberry32 = (a: number) => () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// smooth value noise
const makeNoise = (rng: () => number) => {
    const P = 64;
    const g: number[] = Array(P * P).fill(0).map(() => rng());
    const sm = (t: number) => t * t * (3 - 2 * t);
    return (x: number, y: number) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        const xf = x - xi, yf = y - yi;
        const idx = (i: number, j: number) => g[((j % P + P) % P) * P + ((i % P + P) % P)];
        const a = idx(xi, yi), b = idx(xi + 1, yi), c = idx(xi, yi + 1), d = idx(xi + 1, yi + 1);
        const u = sm(xf), v = sm(yf);
        return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
};

const T = { GRASS: 0, WATER: 1, SAND: 2, FOREST: 3, ROAD: 4, RES: 5, COM: 6, IND: 7, PARK: 8, POWER: 9, RUBBLE: 10 };
const ZONES = [T.RES, T.COM, T.IND];
const FLAMMABLE = new Set([T.FOREST, T.RES, T.COM, T.IND, T.PARK]);

interface Cell {
    type: number;
    level: number;   // logical dev level
    anim: number;    // rendered level (eased)
    elev: number;
    seed: number;
    pollution: number;
    value: number;
    happy: number;
    powered: boolean;
    access: boolean;
    fire: number;    // burn timer (sim seconds remaining), 0 = not burning
}

interface Car { path: number[]; seg: number; t: number; speed: number; hue: number; }
interface Ped { cell: number; next: number; t: number; speed: number; hue: number; skin: number; off: number; }

const SIZE = 56;
const N = SIZE * SIZE;
const MAX_CARS = 80;
const MAX_PEDS = 1200;
const MAX_FLAME = 260;
const MAX_SMOKE = 200;
const RAIN_N = 700;

const COSTS: Record<string, number> = { road: 5, res: 20, com: 20, ind: 20, park: 40, power: 450, clear: 2, fire: 0, meteor: 0 };
const LEVEL_CAP: Record<number, number> = { [T.RES]: 6, [T.COM]: 8, [T.IND]: 4 };

const money = (v: number) => {
    const a = Math.abs(v);
    const s = a >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : a >= 1e3 ? (v / 1e3).toFixed(1) + 'k' : Math.round(v).toString();
    return '$' + s;
};

export const WorldSim: React.FC<SimProps> = React.memo(({ settings, activeTool, active, zoom, timeScale, overlay, onUpdateMetrics, onHover, onEvent }) => {
    const grid = useRef<Cell[]>([]);
    const state = useRef({
        treasury: 25000,
        pop: 0, jobs: 0, happiness: 60, avgPollution: 0, avgValue: 50, congestion: 0,
        demandR: 20, demandC: 5, demandI: 10,
        powerCap: 0, powerDemand: 0,
        day: 1, clock: '06:00', weather: 'CLEAR' as 'CLEAR' | 'CLOUDY' | 'RAIN',
        weatherTimer: 30, rainF: 0, // eased rain factor 0..1
        tickAcc: 0, metricAcc: 0, spawnAcc: 0,
        roadsDirty: true, colorsDirty: true,
        lastPaint: -1,
        eventCooldown: {} as Record<string, number>,
        milestone: 500,
        blackout: false,
    });
    const cars = useRef<Car[]>([]);
    const peds = useRef<Ped[]>([]);
    const smoke = useRef<{ p: THREE.Vector3; v: THREE.Vector3; life: number; max: number }[]>([]);
    const meteor = useRef<{ active: boolean; pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);

    const M = useRef<Record<string, THREE.InstancedMesh>>({});
    const singles = useRef<Record<string, any>>({});
    const roadCellsRef = useRef<number[]>([]);

    const settingsRef = useRef(settings); settingsRef.current = settings;
    const toolRef = useRef(activeTool); toolRef.current = activeTool;
    const overlayRef = useRef(overlay); overlayRef.current = overlay;
    const cbRef = useRef({ onUpdateMetrics, onHover, onEvent });
    cbRef.current = { onUpdateMetrics, onHover, onEvent };

    const idx2xz = (i: number): [number, number] => [(i % SIZE) - SIZE / 2 + 0.5, Math.floor(i / SIZE) - SIZE / 2 + 0.5];
    const inBounds = (x: number, z: number) => x >= 0 && x < SIZE && z >= 0 && z < SIZE;

    const fireEvent = (key: string, text: string, sev: 'info' | 'good' | 'warning' | 'critical', cooldown = 8) => {
        const s = state.current;
        const now = performance.now() / 1000;
        if ((s.eventCooldown[key] ?? -99) + cooldown > now) return;
        s.eventCooldown[key] = now;
        cbRef.current.onEvent?.(text, sev);
    };

    // ---------- world generation ----------
    const generate = () => {
        const rng = mulberry32(1337);
        const elevN = makeNoise(mulberry32(11));
        const moistN = makeNoise(mulberry32(23));
        const cells: Cell[] = [];
        for (let i = 0; i < N; i++) {
            const gx = i % SIZE, gz = Math.floor(i / SIZE);
            const x = gx - SIZE / 2, z = gz - SIZE / 2;
            let elev = elevN(gx * 0.09, gz * 0.09) * 0.8 + elevN(gx * 0.25, gz * 0.25) * 0.2;
            // river valley
            const river = Math.abs(x + Math.sin(z * 0.16) * 6 + 14);
            if (river < 2.6) elev = 0.12;
            const moist = moistN(gx * 0.12, gz * 0.12);
            let type = T.GRASS;
            if (elev < 0.2) type = T.WATER;
            else if (elev < 0.26) type = T.SAND;
            else if (moist > 0.62 && elev > 0.3) type = T.FOREST;
            cells.push({
                type, level: type === T.FOREST ? 1 + rng() : 0, anim: 0,
                elev: Math.max(0.15, elev), seed: rng(),
                pollution: 0, value: 50, happy: 60, powered: false, access: false, fire: 0,
            });
        }
        // starter town: crossroads + small zoned core + power plant
        const road = (gx: number, gz: number) => { if (inBounds(gx, gz)) { const c = cells[gz * SIZE + gx]; if (c.type !== T.WATER) { c.type = T.ROAD; c.level = 0; } } };
        const cx = Math.floor(SIZE / 2) + 4, cz = Math.floor(SIZE / 2);
        for (let d = -8; d <= 8; d++) { road(cx + d, cz); road(cx, cz + d); }
        for (let d = -8; d <= 8; d++) { road(cx + d, cz - 5); road(cx + d, cz + 5); road(cx - 5, cz + d); road(cx + 5, cz + d); }
        const zone = (gx: number, gz: number, t: number, lvl: number) => {
            if (!inBounds(gx, gz)) return;
            const c = cells[gz * SIZE + gx];
            if (c.type === T.GRASS || c.type === T.FOREST) { c.type = t; c.level = lvl; c.anim = lvl; }
        };
        const zrng = mulberry32(77);
        for (let dx = -7; dx <= 7; dx++) for (let dz = -4; dz <= 4; dz++) {
            const gx = cx + dx, gz = cz + dz;
            const c = cells[gz * SIZE + gx];
            if (!c || c.type !== T.GRASS) continue;
            if (zrng() < 0.55) {
                const r = zrng();
                zone(gx, gz, r < 0.55 ? T.RES : r < 0.85 ? T.COM : T.IND, 1 + zrng() * 1.5);
            }
        }
        zone(cx - 7, cz + 6, T.POWER, 2); cells[(cz + 6) * SIZE + cx - 7].type = T.POWER;
        zone(cx + 3, cz - 3, T.PARK, 1);
        zone(cx - 3, cz + 3, T.PARK, 1);
        grid.current = cells;
        state.current.roadsDirty = true;
        state.current.colorsDirty = true;
    };

    // ---------- derived maps ----------
    const recomputeRoads = () => {
        const cells = grid.current;
        const roadCells: number[] = [];
        for (let i = 0; i < N; i++) if (cells[i].type === T.ROAD) roadCells.push(i);
        roadCellsRef.current = roadCells;
        // road access: BFS out 3 steps from roads
        for (let i = 0; i < N; i++) cells[i].access = false;
        const q: [number, number][] = roadCells.map(i => [i, 0]);
        const seen = new Set<number>(roadCells);
        while (q.length) {
            const [i, d] = q.shift()!;
            cells[i].access = true;
            if (d >= 3) continue;
            const gx = i % SIZE, gz = Math.floor(i / SIZE);
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = gx + dx, nz = gz + dz;
                if (!inBounds(nx, nz)) continue;
                const ni = nz * SIZE + nx;
                if (!seen.has(ni)) { seen.add(ni); q.push([ni, d + 1]); }
            }
        }
        // power coverage
        const plants: number[] = [];
        for (let i = 0; i < N; i++) { cells[i].powered = false; if (cells[i].type === T.POWER) plants.push(i); }
        const R = 14;
        for (const p of plants) {
            const px = p % SIZE, pz = Math.floor(p / SIZE);
            for (let gx = Math.max(0, px - R); gx < Math.min(SIZE, px + R); gx++)
                for (let gz = Math.max(0, pz - R); gz < Math.min(SIZE, pz + R); gz++)
                    if ((gx - px) ** 2 + (gz - pz) ** 2 <= R * R) cells[gz * SIZE + gx].powered = true;
        }
        state.current.powerCap = plants.length * 420;
        state.current.roadsDirty = false;
        // lane markings + lamps rebuild
        rebuildRoadDeco();
    };

    const roadPathBFS = (from: number, to: number): number[] | null => {
        const cells = grid.current;
        if (cells[from]?.type !== T.ROAD || cells[to]?.type !== T.ROAD) return null;
        const prev = new Map<number, number>(); prev.set(from, -1);
        const q = [from];
        while (q.length) {
            const i = q.shift()!;
            if (i === to) {
                const path: number[] = [];
                let c = to;
                while (c !== -1) { path.push(c); c = prev.get(c)!; }
                path.reverse();
                return path.length > 1 ? path : null;
            }
            const gx = i % SIZE, gz = Math.floor(i / SIZE);
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = gx + dx, nz = gz + dz;
                if (!inBounds(nx, nz)) continue;
                const ni = nz * SIZE + nx;
                if (cells[ni].type === T.ROAD && !prev.has(ni)) { prev.set(ni, i); q.push(ni); }
            }
        }
        return null;
    };

    // ---------- scene ----------
    const rebuildRoadDeco = () => {
        const lane = M.current.lane, lamp = M.current.lamp;
        if (!lane || !lamp) return;
        const cells = grid.current;
        const dummy = new THREE.Object3D();
        let li = 0, la = 0;
        for (const i of roadCellsRef.current) {
            const [x, z] = idx2xz(i);
            const gx = i % SIZE, gz = Math.floor(i / SIZE);
            const h = inBounds(gx + 1, gz) && cells[gz * SIZE + gx + 1].type === T.ROAD || inBounds(gx - 1, gz) && cells[gz * SIZE + gx - 1].type === T.ROAD;
            const v = inBounds(gx, gz + 1) && cells[(gz + 1) * SIZE + gx].type === T.ROAD || inBounds(gx, gz - 1) && cells[(gz - 1) * SIZE + gx].type === T.ROAD;
            if (li < 3000 && (h !== v)) { // straight segment: draw center dash
                dummy.position.set(x, 0.075, z);
                dummy.rotation.set(0, h ? 0 : Math.PI / 2, 0);
                dummy.scale.set(1, 1, 1);
                dummy.updateMatrix();
                lane.setMatrixAt(li++, dummy.matrix);
            }
            if ((gx + gz) % 3 === 0 && la < 1200) {
                dummy.position.set(x + 0.42, 0.5, z + 0.42);
                dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
                dummy.updateMatrix();
                lamp.setMatrixAt(la++, dummy.matrix);
            }
        }
        dummy.position.set(0, -500, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix();
        for (let i = li; i < 3000; i++) lane.setMatrixAt(i, dummy.matrix);
        for (let i = la; i < 1200; i++) lamp.setMatrixAt(i, dummy.matrix);
        lane.instanceMatrix.needsUpdate = true;
        lamp.instanceMatrix.needsUpdate = true;
    };

    const init = (ctx: SimContext) => {
        generate();
        const { scene } = ctx;
        scene.fog = new THREE.Fog(0x87b7e4, 90, 260);

        const mk = (key: string, geo: THREE.BufferGeometry, mat: THREE.Material, count: number, shadow = true) => {
            const m = new THREE.InstancedMesh(geo, mat, count);
            m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            m.castShadow = shadow; m.receiveShadow = true;
            m.frustumCulled = false;
            scene.add(m);
            M.current[key] = m;
            return m;
        };

        // terrain
        const tGeo = new THREE.BoxGeometry(1, 1, 1); tGeo.translate(0, -0.5, 0);
        mk('terrain', tGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), N, false);
        // buildings
        const bGeo = new THREE.BoxGeometry(0.82, 1, 0.82); bGeo.translate(0, 0.5, 0);
        const bMat = new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: new THREE.Color(0xffd9a0), emissiveIntensity: 0 });
        mk('building', bGeo, bMat, N);
        // roofs (res)
        const rGeo = new THREE.ConeGeometry(0.62, 0.42, 4); rGeo.translate(0, 0.21, 0); rGeo.rotateY(Math.PI / 4);
        mk('roof', rGeo, new THREE.MeshStandardMaterial({ color: 0xb3574e, roughness: 0.8 }), N);
        // trees
        const trGeo = new THREE.ConeGeometry(0.34, 1, 6); trGeo.translate(0, 0.5, 0);
        mk('tree', trGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), N);
        // lane markings + lamps
        const laneGeo = new THREE.BoxGeometry(0.34, 0.02, 0.06);
        mk('lane', laneGeo, new THREE.MeshBasicMaterial({ color: 0xf8fafc }), 3000, false);
        const lampGeo = new THREE.SphereGeometry(0.07, 6, 6);
        mk('lamp', lampGeo, new THREE.MeshStandardMaterial({ color: 0x94a3b8, emissive: 0xffe9b0, emissiveIntensity: 0 }), 1200, false);
        // cars
        const cGeo = new THREE.BoxGeometry(0.26, 0.16, 0.5); cGeo.translate(0, 0.16, 0);
        mk('car', cGeo, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 }), MAX_CARS);
        // pedestrians
        const pGeo = new THREE.CapsuleGeometry(0.07, 0.2, 3, 6); pGeo.translate(0, 0.2, 0);
        mk('ped', pGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), MAX_PEDS, false);
        const hGeo = new THREE.SphereGeometry(0.07, 6, 6); hGeo.translate(0, 0.4, 0);
        mk('head', hGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), MAX_PEDS, false);
        // flames
        const fGeo = new THREE.ConeGeometry(0.32, 0.9, 6); fGeo.translate(0, 0.45, 0);
        mk('flame', fGeo, new THREE.MeshBasicMaterial({ color: 0xff6a00, transparent: true, opacity: 0.9, depthWrite: false }), MAX_FLAME, false);
        // smoke
        const smGeo = new THREE.IcosahedronGeometry(0.3, 0);
        mk('smoke', smGeo, new THREE.MeshBasicMaterial({ color: 0x555b66, transparent: true, opacity: 0.35, depthWrite: false }), MAX_SMOKE, false);
        // rain
        const rainGeo = new THREE.BoxGeometry(0.02, 0.5, 0.02);
        const rainMesh = mk('rain', rainGeo, new THREE.MeshBasicMaterial({ color: 0xa8c5e6, transparent: true, opacity: 0.35 }), RAIN_N, false);
        rainMesh.visible = false;
        singles.current.rainDrops = Array(RAIN_N).fill(0).map(() => ({
            x: (Math.random() - 0.5) * SIZE * 1.2, z: (Math.random() - 0.5) * SIZE * 1.2, y: Math.random() * 30,
        }));

        // water plane
        const waterMat = new THREE.MeshStandardMaterial({ color: 0x0e7bb8, transparent: true, opacity: 0.8, roughness: 0.15, metalness: 0.2 });
        const water = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), waterMat);
        water.rotation.x = -Math.PI / 2; water.position.y = -0.28;
        scene.add(water);
        singles.current.water = water;

        // clouds
        const cloudGrp = new THREE.Group();
        const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, roughness: 1 });
        const crng = mulberry32(5);
        for (let i = 0; i < 9; i++) {
            const puff = new THREE.Group();
            for (let j = 0; j < 4; j++) {
                const s = 1.6 + crng() * 2.6;
                const b = new THREE.Mesh(new THREE.SphereGeometry(s, 7, 7), cloudMat);
                b.position.set((crng() - 0.5) * 6, (crng() - 0.5) * 1, (crng() - 0.5) * 3);
                b.scale.y = 0.45;
                puff.add(b);
            }
            puff.position.set((crng() - 0.5) * 110, 34 + crng() * 10, (crng() - 0.5) * 110);
            (puff as any).userData.speed = 0.3 + crng() * 0.5;
            cloudGrp.add(puff);
        }
        scene.add(cloudGrp);
        singles.current.clouds = cloudGrp;

        // meteor
        const metGrp = new THREE.Group();
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 0), new THREE.MeshStandardMaterial({ color: 0x442211, emissive: 0xff4400, emissiveIntensity: 1.2, roughness: 0.9 }));
        metGrp.add(rock);
        const tail = new THREE.Mesh(new THREE.ConeGeometry(0.6, 5, 8), new THREE.MeshBasicMaterial({ color: 0xff8833, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
        tail.position.y = 2.8;
        metGrp.add(tail);
        metGrp.visible = false;
        scene.add(metGrp);
        singles.current.meteorMesh = metGrp;

        // hover cursor
        const cur = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.9, 1.02), new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.7 }));
        cur.visible = false;
        scene.add(cur);
        singles.current.cursor = cur;

        // raycast plane
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshBasicMaterial({ visible: false }));
        plane.rotation.x = -Math.PI / 2;
        scene.add(plane);
        singles.current.plane = plane;

        recomputeRoads();
        writeTerrainMatrices();
    };

    const writeTerrainMatrices = () => {
        const t = M.current.terrain;
        if (!t) return;
        const dummy = new THREE.Object3D();
        const cells = grid.current;
        for (let i = 0; i < N; i++) {
            const [x, z] = idx2xz(i);
            const c = cells[i];
            const h = c.type === T.WATER ? 0.25 : 0.35 + c.elev * 0.9;
            dummy.position.set(x, c.type === T.WATER ? -0.35 : h - 0.35, z);
            dummy.scale.set(1, h, 1);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            t.setMatrixAt(i, dummy.matrix);
        }
        t.instanceMatrix.needsUpdate = true;
    };

    // ---------- simulation tick (every 0.25 sim-sec) ----------
    const heatColor = (v: number, invert = false) => {
        const t = Math.max(0, Math.min(1, v / 100));
        const tt = invert ? 1 - t : t;
        const c = new THREE.Color();
        c.setHSL((1 - tt) * 0.38, 0.85, 0.42);
        return c;
    };

    const tick = (dt: number) => {
        const cells = grid.current;
        const s = state.current;
        const set = settingsRef.current;
        const growth = (set.growthSpeed ?? 50) / 50;
        const tax = set.taxRate ?? 12;
        const services = (set.cityServices ?? 50);
        const rainF = s.rainF;

        let pop = 0, jobs = 0, comCap = 0, indCap = 0;
        let happySum = 0, happyCount = 0, valueSum = 0, valueCount = 0, pollSum = 0;
        let powerDemand = 0;

        // pollution diffusion buffer
        const nextPol = new Float32Array(N);

        for (let i = 0; i < N; i++) {
            const c = cells[i];
            const gx = i % SIZE, gz = Math.floor(i / SIZE);

            // emissions
            let emit = 0;
            if (c.type === T.IND) emit = 1.6 * c.level;
            if (c.type === T.ROAD) emit = 0.35 * (s.congestion / 50 + 0.4);
            if (c.fire > 0) emit = 4;
            let absorb = 0;
            if (c.type === T.FOREST || c.type === T.PARK) absorb = 2.2;

            // diffuse
            let nsum = 0, ncount = 0;
            if (gx > 0) { nsum += cells[i - 1].pollution; ncount++; }
            if (gx < SIZE - 1) { nsum += cells[i + 1].pollution; ncount++; }
            if (gz > 0) { nsum += cells[i - SIZE].pollution; ncount++; }
            if (gz < SIZE - 1) { nsum += cells[i + SIZE].pollution; ncount++; }
            const navg = ncount ? nsum / ncount : 0;
            nextPol[i] = Math.max(0, Math.min(100, (c.pollution * 0.86 + navg * 0.12) + emit - absorb - rainF * 1.2));

            // fire behavior
            if (c.fire > 0) {
                c.fire -= dt * (1 + rainF * 3 + services / 120);
                if (c.fire <= 0) {
                    c.fire = 0;
                    c.type = c.type === T.FOREST ? T.GRASS : T.RUBBLE;
                    c.level = 0; c.anim = 0;
                    s.roadsDirty = true; s.colorsDirty = true;
                    fireEvent('burned', 'A structure burned to the ground.', 'critical', 6);
                } else if (Math.random() < 0.055 * dt * 4 * (1 - rainF)) {
                    // spread
                    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
                    const [dx, dz] = dirs[Math.floor(Math.random() * 4)];
                    const nx = gx + dx, nz = gz + dz;
                    if (inBounds(nx, nz)) {
                        const nb = cells[nz * SIZE + nx];
                        if (FLAMMABLE.has(nb.type) && nb.fire === 0) nb.fire = 6 + Math.random() * 5;
                    }
                }
            }

            // rubble decay
            if (c.type === T.RUBBLE && Math.random() < 0.01 * dt * 4) { c.type = T.GRASS; s.colorsDirty = true; }

            // zones
            if (ZONES.includes(c.type)) {
                const isRes = c.type === T.RES;
                powerDemand += c.level * 3 + 1;

                // local bonuses
                let parkB = 0, waterB = 0, indPenalty = 0;
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
                    const nx = gx + dx, nz = gz + dz;
                    if (!inBounds(nx, nz)) continue;
                    const nb = cells[nz * SIZE + nx];
                    if (nb.type === T.PARK || nb.type === T.FOREST) parkB += 2.5;
                    if (nb.type === T.WATER) waterB += 2;
                    if (nb.type === T.IND) indPenalty += 2.5;
                }

                const unemployment = s.pop > 0 ? Math.max(0, (s.pop - s.jobs * 1.15) / s.pop) : 0;
                let happy = 62 - tax * 1.1 + services * 0.22 - c.pollution * 0.45 + parkB + waterB - indPenalty - unemployment * 18 - rainF * 3 - s.congestion * 0.06;
                if (!c.powered) happy -= 15;
                c.happy = Math.max(0, Math.min(100, happy));

                c.value = Math.max(0, Math.min(100, 38 + parkB * 2.2 + waterB * 2.5 - c.pollution * 0.55 + c.happy * 0.28 + (c.access ? 8 : -10)));

                const demand = isRes ? s.demandR : c.type === T.COM ? s.demandC : s.demandI;
                const cap = LEVEL_CAP[c.type];
                const canGrow = c.access && c.powered && !s.blackout && demand > 0 && s.treasury > -500;
                const p = 0.05 * growth * dt * 4;
                if (canGrow && c.value > 25 && Math.random() < p * (0.4 + demand / 80)) c.level = Math.min(cap, c.level + 0.5);
                let decayP = 0;
                if (!c.powered || s.blackout) decayP += 0.03;
                if (c.happy < 22) decayP += 0.035;
                if (demand < -20) decayP += 0.02;
                if (!c.access) decayP += 0.03;
                if (decayP > 0 && Math.random() < decayP * dt * 4) {
                    c.level = Math.max(0, c.level - 0.5);
                    if (c.level === 0 && Math.random() < 0.3) { c.type = T.RUBBLE; s.colorsDirty = true; fireEvent('abandon', 'Building abandoned — check power, roads and happiness.', 'warning', 12); }
                }

                if (isRes) { pop += Math.floor(c.level * 42); happySum += c.happy; happyCount++; }
                else if (c.type === T.COM) { comCap += Math.floor(c.level * 24); }
                else { indCap += Math.floor(c.level * 32); }
                valueSum += c.value; valueCount++;
            }
            pollSum += nextPol[i];
        }
        for (let i = 0; i < N; i++) cells[i].pollution = nextPol[i];

        jobs = comCap + indCap;
        s.pop = pop; s.jobs = jobs;
        s.happiness = happyCount ? happySum / happyCount : 60;
        s.avgValue = valueCount ? valueSum / valueCount : 50;
        s.avgPollution = pollSum / N;
        s.powerDemand = powerDemand;

        const wasBlackout = s.blackout;
        s.blackout = powerDemand > s.powerCap;
        if (s.blackout && !wasBlackout) fireEvent('blackout', `BLACKOUT — demand ${Math.round(powerDemand)} exceeds grid capacity ${Math.round(s.powerCap)}. Build power plants!`, 'critical', 20);
        if (!s.blackout && wasBlackout) fireEvent('poweron', 'Power restored. The grid is stable again.', 'good', 20);

        // demand model
        s.demandR = Math.max(-100, Math.min(100, (jobs * 1.15 - pop) / 8 + (s.happiness - 45) * 0.8));
        s.demandC = Math.max(-100, Math.min(100, (pop * 0.35 - comCap) / 4));
        s.demandI = Math.max(-100, Math.min(100, (pop * 0.55 - indCap) / 6));

        // economy
        const income = pop * tax * 0.004 + comCap * 0.02;
        const upkeep = services * 0.28 + roadCellsRef.current.length * 0.01 + (s.powerCap / 420) * 1.4;
        s.treasury += (income - upkeep) * dt;
        if (s.treasury < 0) fireEvent('broke', 'Treasury is empty! Raise taxes or cut services.', 'critical', 25);

        // random fire chance (worse with low services)
        if (Math.random() < 0.0022 * dt * 4 * (1.6 - services / 100) * (1 - rainF)) {
            const candidates: number[] = [];
            for (let i = 0; i < N; i++) if (ZONES.includes(cells[i].type) && cells[i].level > 1) candidates.push(i);
            if (candidates.length) {
                const i = candidates[Math.floor(Math.random() * candidates.length)];
                cells[i].fire = 8 + Math.random() * 6;
                fireEvent('firestart', 'A fire has broken out in the city!', 'critical', 15);
            }
        }

        // milestones
        if (pop >= s.milestone) {
            fireEvent('milestone' + s.milestone, `Population milestone: ${s.milestone.toLocaleString()} citizens! 🎉`, 'good', 1);
            s.milestone = s.milestone < 2000 ? s.milestone * 2 : s.milestone + 2000;
        }

        // weather machine
        s.weatherTimer -= dt;
        if (s.weatherTimer <= 0) {
            const stormy = (set.weatherIntensity ?? 30) / 100;
            const r = Math.random();
            const prev = s.weather;
            s.weather = r < 0.45 - stormy * 0.25 ? 'CLEAR' : r < 0.75 - stormy * 0.1 ? 'CLOUDY' : 'RAIN';
            s.weatherTimer = 25 + Math.random() * 30;
            if (s.weather === 'RAIN' && prev !== 'RAIN') fireEvent('rain', 'Storm front moving in — rain dampens fires and spirits.', 'info', 10);
        }

        s.colorsDirty = true;
    };

    // ---------- colors ----------
    const writeColors = () => {
        const t = M.current.terrain;
        if (!t) return;
        const cells = grid.current;
        const col = new THREE.Color();
        const ov = overlayRef.current;
        for (let i = 0; i < N; i++) {
            const c = cells[i];
            if (ov && ov !== 'none' && c.type !== T.WATER) {
                if (ov === 'pollution') col.copy(heatColor(c.pollution, true));
                else if (ov === 'value') col.copy(heatColor(c.value));
                else col.copy(heatColor(ZONES.includes(c.type) ? c.happy : 50));
            } else {
                switch (c.type) {
                    case T.WATER: col.setHex(0x0a5c8f); break;
                    case T.SAND: col.setHex(0xd9c58a); break;
                    case T.FOREST: col.setHex(0x2f7d3f); break;
                    case T.ROAD: col.setHex(0x353c47); break;
                    case T.PARK: col.setHex(0x4cae54); break;
                    case T.POWER: col.setHex(0x565f6e); break;
                    case T.RUBBLE: col.setHex(0x51473d); break;
                    case T.RES: case T.COM: case T.IND: col.setHex(0x9aa3ad); break;
                    default: {
                        const g = 0.72 + c.seed * 0.1 + c.elev * 0.18;
                        col.setRGB(0.36 * g, 0.62 * g, 0.32 * g);
                    }
                }
                if (c.fire > 0) col.lerp(new THREE.Color(0xff3300), 0.45);
            }
            t.setColorAt(i, col);
        }
        t.instanceColor!.needsUpdate = true;
    };

    // ---------- painting ----------
    const applyTool = (i: number) => {
        const cells = grid.current;
        const s = state.current;
        const tool = toolRef.current;
        if (!tool || tool === 'inspect') return;
        const c = cells[i];
        if (c.type === T.WATER && tool !== 'meteor') return;

        const cost = COSTS[tool] ?? 0;
        if (s.treasury < cost) { fireEvent('nofunds', `Not enough funds (${money(cost)} needed).`, 'warning', 4); return; }

        const spend = () => { s.treasury -= cost; };
        const reset = (type: number, level = 0) => {
            cells[i] = { ...c, type, level, anim: 0, fire: 0 };
            s.roadsDirty = true; s.colorsDirty = true;
        };

        switch (tool) {
            case 'road': if (c.type !== T.ROAD) { spend(); reset(T.ROAD); } break;
            case 'res': if (c.type !== T.RES) { spend(); reset(T.RES, 0.5); } break;
            case 'com': if (c.type !== T.COM) { spend(); reset(T.COM, 0.5); } break;
            case 'ind': if (c.type !== T.IND) { spend(); reset(T.IND, 0.5); } break;
            case 'park': if (c.type !== T.PARK) { spend(); reset(T.PARK, 1); } break;
            case 'power':
                if (c.type !== T.POWER) { spend(); reset(T.POWER, 2); fireEvent('power', 'Power plant online — grid capacity increased.', 'good', 5); }
                break;
            case 'clear':
                if (c.fire > 0) { c.fire = 0; s.colorsDirty = true; }
                else if (c.type !== T.GRASS) { spend(); reset(T.GRASS); }
                break;
            case 'fire':
                if (FLAMMABLE.has(c.type)) { c.fire = 9 + Math.random() * 5; fireEvent('arson', 'Fire ignited. It will spread to adjacent buildings!', 'critical', 6); }
                break;
            case 'meteor': {
                if (meteor.current?.active) break;
                const [x, z] = idx2xz(i);
                meteor.current = { active: true, pos: new THREE.Vector3(x + 26, 46, z - 30), target: new THREE.Vector3(x, 0, z) };
                fireEvent('meteor', 'METEOR INBOUND — brace for impact!', 'critical', 5);
                break;
            }
        }
    };

    const hoverIndex = (ctx: SimContext): number => {
        const ints = ctx.raycaster.intersectObject(singles.current.plane);
        if (!ints.length) return -1;
        const pt = ints[0].point;
        const gx = Math.floor(pt.x + SIZE / 2), gz = Math.floor(pt.z + SIZE / 2);
        if (!inBounds(gx, gz)) return -1;
        return gz * SIZE + gx;
    };

    const onPaint = (ctx: SimContext) => {
        const tool = toolRef.current;
        if (!tool || tool === 'inspect' || tool === 'fire' || tool === 'meteor') {
            // click-only tools handled in onClick
            if (tool === 'inspect') return;
        }
        const i = hoverIndex(ctx);
        if (i === -1 || i === state.current.lastPaint) return;
        state.current.lastPaint = i;
        if (tool && !['fire', 'meteor', 'inspect'].includes(tool)) applyTool(i);
    };

    const onClick = (ctx: SimContext) => {
        const i = hoverIndex(ctx);
        if (i === -1) return;
        const tool = toolRef.current;
        if (tool === 'fire' || tool === 'meteor') applyTool(i);
        state.current.lastPaint = -1;
    };

    // ---------- animate ----------
    const animate = (ctx: SimContext) => {
        const s = state.current;
        const cells = grid.current;
        const set = settingsRef.current;
        const dt = ctx.dt;

        if (!ctx.pointerDown) state.current.lastPaint = -1;
        if (s.roadsDirty) { recomputeRoads(); writeTerrainMatrices(); }

        // fixed cadence sim tick
        s.tickAcc += dt;
        while (s.tickAcc >= 0.25) { s.tickAcc -= 0.25; tick(0.25); }

        // ----- day/night -----
        const dayLen = Math.max(20, set.dayLength ?? 60);
        const tDay = (ctx.time / dayLen + 0.5) % 1; // start at high noon — full sunshine
        const ang = tDay * Math.PI * 2 - Math.PI / 2;
        const sunH = Math.sin(ang);
        const dayF = Math.min(1, Math.max(0, (sunH + 0.12) * 3));
        const duskF = Math.exp(-(sunH * sunH) / 0.018) * (Math.cos(ang) > 0 ? 1 : 0.6);
        s.day = Math.floor(ctx.time / dayLen) + 1;
        const hh = Math.floor(tDay * 24), mm = Math.floor((tDay * 24 % 1) * 60);
        s.clock = `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;

        // weather easing
        const targetRain = s.weather === 'RAIN' ? 1 : 0;
        s.rainF += (targetRain - s.rainF) * Math.min(1, dt * 0.8);
        const cloudDim = s.weather === 'CLOUDY' ? 0.75 : s.weather === 'RAIN' ? 0.45 : 1;

        const { sun, hemi } = ctx.lights;
        sun.position.set(Math.cos(ang) * 70, Math.max(2, sunH * 90), 30);
        // bright moonlight floor at night so the city never goes murky
        sun.intensity = Math.max(0.5 * (1 - dayF), Math.max(0, sunH) * 2.2 * cloudDim);
        if (dayF > 0.4) sun.color.setHSL(0.09 + dayF * 0.04, 0.7, 0.55 + dayF * 0.35);
        else sun.color.setHex(0xbcd0f5); // cool moonlight
        hemi.intensity = 0.62 + dayF * 0.55 * cloudDim;

        const skyDay = new THREE.Color(0x8ec1e8).multiplyScalar(cloudDim);
        const skyNight = new THREE.Color(0x3a4c72);
        const sky = skyNight.clone().lerp(skyDay, dayF);
        sky.lerp(new THREE.Color(0xe08a54), duskF * 0.55);
        (ctx.scene.background as THREE.Color).copy(sky);
        if (ctx.scene.fog) { (ctx.scene.fog as THREE.Fog).color.copy(sky); }

        const nightF = 1 - dayF;
        (M.current.building.material as THREE.MeshStandardMaterial).emissiveIntensity = nightF * 0.55;
        (M.current.lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = nightF * 1.6;

        // water shimmer + clouds
        if (singles.current.water) {
            const wm = singles.current.water.material as THREE.MeshStandardMaterial;
            wm.opacity = 0.74 + Math.sin(ctx.wallTime * 1.3) * 0.05;
            wm.color.setHex(0x0e7bb8).multiplyScalar(0.6 + dayF * 0.4);
        }
        if (singles.current.clouds) {
            singles.current.clouds.children.forEach((p: THREE.Object3D) => {
                p.position.x += (p as any).userData.speed * dt;
                if (p.position.x > 70) p.position.x = -70;
            });
            (singles.current.clouds.children[0]?.children[0] as THREE.Mesh | undefined);
            singles.current.clouds.visible = s.weather !== 'CLEAR' || true;
            singles.current.clouds.children.forEach((p: THREE.Object3D) => {
                p.children.forEach(ch => {
                    const m = (ch as THREE.Mesh).material as THREE.MeshStandardMaterial;
                    m.opacity = (s.weather === 'CLEAR' ? 0.35 : 0.7) * (0.25 + dayF * 0.75);
                    m.color.setScalar(s.weather === 'RAIN' ? 0.45 : 1);
                });
            });
        }

        // rain particles
        const rainMesh = M.current.rain;
        rainMesh.visible = s.rainF > 0.05;
        if (rainMesh.visible) {
            const drops = singles.current.rainDrops;
            const dummy = new THREE.Object3D();
            const visN = Math.floor(RAIN_N * s.rainF);
            for (let i = 0; i < RAIN_N; i++) {
                const d = drops[i];
                if (i < visN) {
                    d.y -= dt * 32;
                    if (d.y < 0) { d.y = 26 + Math.random() * 6; d.x = (Math.random() - 0.5) * SIZE * 1.2; d.z = (Math.random() - 0.5) * SIZE * 1.2; }
                    dummy.position.set(d.x, d.y, d.z);
                    dummy.scale.set(1, 1, 1);
                } else { dummy.position.set(0, -500, 0); dummy.scale.set(0, 0, 0); }
                dummy.updateMatrix();
                rainMesh.setMatrixAt(i, dummy.matrix);
            }
            rainMesh.instanceMatrix.needsUpdate = true;
        }

        // ----- buildings / trees render -----
        const bMesh = M.current.building, rMesh = M.current.roof, trMesh = M.current.tree;
        const dummy = new THREE.Object3D();
        const bCol = new THREE.Color();
        for (let i = 0; i < N; i++) {
            const c = cells[i];
            const [x, z] = idx2xz(i);
            const baseY = 0.35 + c.elev * 0.9 - 0.35 + (c.type === T.WATER ? -0.6 : 0) + 0.35 + c.elev * 0.9 - 0.35;
            const topY = c.type === T.WATER ? 0 : 0.35 + c.elev * 0.9;

            // ease anim toward level
            if (Math.abs(c.anim - c.level) > 0.01) c.anim += (c.level - c.anim) * Math.min(1, dt * 2.5);

            // default hide
            let bSet = false, rSet = false, tSet = false;

            if (ZONES.includes(c.type) && c.anim > 0.05) {
                const lvl = c.anim;
                let h = 0, w = 0.82;
                if (c.type === T.RES) { h = 0.35 + lvl * 0.28; bCol.setHex(0xf1ede4); }
                else if (c.type === T.COM) { h = 0.3 + lvl * 0.5; bCol.setHex(0x6fd7f0); }
                else { h = 0.3 + lvl * 0.3; w = 0.9; bCol.setHex(0xe8b06a); }
                bCol.multiplyScalar(0.9 + c.seed * 0.18); // subtle per-building variance
                if (c.fire > 0) bCol.lerp(new THREE.Color(0x331111), 0.6);
                else if (!c.powered || s.blackout) bCol.multiplyScalar(0.6);
                dummy.position.set(x, topY, z);
                dummy.scale.set(w, h, w);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                bMesh.setMatrixAt(i, dummy.matrix);
                bMesh.setColorAt(i, bCol);
                bSet = true;
                if (c.type === T.RES && lvl < 3.2) {
                    dummy.position.set(x, topY + h, z);
                    dummy.scale.set(1, 1, 1);
                    dummy.updateMatrix();
                    rMesh.setMatrixAt(i, dummy.matrix);
                    rSet = true;
                }
            } else if (c.type === T.POWER) {
                dummy.position.set(x, topY, z);
                dummy.scale.set(1, 1.5, 1);
                dummy.rotation.set(0, 0, 0);
                dummy.updateMatrix();
                bMesh.setMatrixAt(i, dummy.matrix);
                bCol.setHex(0x475062);
                bMesh.setColorAt(i, bCol);
                bSet = true;
            } else if (c.type === T.FOREST || c.type === T.PARK) {
                const sc = c.type === T.PARK ? 0.55 : 0.7 + c.seed * 0.7;
                dummy.position.set(x + (c.seed - 0.5) * 0.3, topY, z + (c.seed - 0.5) * 0.3);
                dummy.scale.set(sc, sc * (1 + c.seed * 0.6), sc);
                dummy.rotation.set(0, c.seed * 3, 0);
                dummy.updateMatrix();
                trMesh.setMatrixAt(i, dummy.matrix);
                trMesh.setColorAt(i, bCol.setHex(c.type === T.PARK ? 0x35c04b : 0x1f6e33));
                tSet = true;
            }

            if (!bSet) { dummy.position.set(0, -500, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix(); bMesh.setMatrixAt(i, dummy.matrix); }
            if (!rSet) { dummy.position.set(0, -500, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix(); rMesh.setMatrixAt(i, dummy.matrix); }
            if (!tSet) { dummy.position.set(0, -500, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix(); trMesh.setMatrixAt(i, dummy.matrix); }
        }
        bMesh.instanceMatrix.needsUpdate = true;
        if (bMesh.instanceColor) bMesh.instanceColor.needsUpdate = true;
        rMesh.instanceMatrix.needsUpdate = true;
        trMesh.instanceMatrix.needsUpdate = true;
        if (trMesh.instanceColor) trMesh.instanceColor.needsUpdate = true;

        if (s.colorsDirty) { writeColors(); s.colorsDirty = false; }

        // ----- fires & smoke -----
        const flame = M.current.flame;
        let fi = 0;
        for (let i = 0; i < N && fi < MAX_FLAME - 3; i++) {
            const c = cells[i];
            if (c.fire <= 0) continue;
            const [x, z] = idx2xz(i);
            for (let k = 0; k < 3; k++) {
                const flick = 0.6 + Math.sin(ctx.wallTime * 11 + i * 3 + k * 2.4) * 0.25 + Math.random() * 0.12;
                dummy.position.set(x + (k - 1) * 0.22, 0.4 + c.elev, z + Math.sin(i + k) * 0.2);
                dummy.scale.set(flick, flick * (1 + k * 0.2), flick);
                dummy.rotation.set(0, ctx.wallTime * 2 + k, 0);
                dummy.updateMatrix();
                flame.setMatrixAt(fi++, dummy.matrix);
            }
            if (Math.random() < dt * 6 && smoke.current.length < MAX_SMOKE) {
                smoke.current.push({ p: new THREE.Vector3(x, 1 + c.elev, z), v: new THREE.Vector3((Math.random() - 0.5) * 0.3, 1.2 + Math.random(), (Math.random() - 0.5) * 0.3), life: 3, max: 3 });
            }
        }
        dummy.position.set(0, -500, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix();
        for (let i = fi; i < MAX_FLAME; i++) flame.setMatrixAt(i, dummy.matrix);
        flame.instanceMatrix.needsUpdate = true;

        const smokeMesh = M.current.smoke;
        const nextSmoke: typeof smoke.current = [];
        let si = 0;
        for (const p of smoke.current) {
            p.life -= dt;
            if (p.life <= 0) continue;
            p.p.addScaledVector(p.v, dt);
            const sc = (1 - p.life / p.max) * 1.6 + 0.3;
            dummy.position.copy(p.p);
            dummy.scale.setScalar(sc);
            dummy.rotation.set(0, p.life * 2, 0);
            dummy.updateMatrix();
            if (si < MAX_SMOKE) smokeMesh.setMatrixAt(si++, dummy.matrix);
            nextSmoke.push(p);
        }
        smoke.current = nextSmoke;
        dummy.position.set(0, -500, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix();
        for (let i = si; i < MAX_SMOKE; i++) smokeMesh.setMatrixAt(i, dummy.matrix);
        smokeMesh.instanceMatrix.needsUpdate = true;

        // ----- meteor -----
        const metMesh = singles.current.meteorMesh as THREE.Group;
        if (meteor.current?.active) {
            const m = meteor.current;
            const dir = m.target.clone().sub(m.pos);
            const dist = dir.length();
            const step = Math.min(dist, dt * 26);
            m.pos.addScaledVector(dir.normalize(), step);
            metMesh.visible = true;
            metMesh.position.copy(m.pos);
            metMesh.lookAt(m.target);
            metMesh.rotateX(-Math.PI / 2);
            if (Math.random() < dt * 30 && smoke.current.length < MAX_SMOKE) {
                smoke.current.push({ p: m.pos.clone(), v: new THREE.Vector3(0, 0.5, 0), life: 1.4, max: 1.4 });
            }
            if (dist < 0.5) {
                m.active = false;
                metMesh.visible = false;
                // impact
                const gx = Math.floor(m.target.x + SIZE / 2), gz = Math.floor(m.target.z + SIZE / 2);
                for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
                    const nx = gx + dx, nz = gz + dz;
                    if (!inBounds(nx, nz)) continue;
                    const d2 = dx * dx + dz * dz;
                    const c = cells[nz * SIZE + nx];
                    if (c.type === T.WATER) continue;
                    if (d2 <= 4) { c.type = T.RUBBLE; c.level = 0; c.anim = 0; c.fire = 0; }
                    else if (d2 <= 9 && FLAMMABLE.has(c.type)) { c.fire = 8 + Math.random() * 5; }
                }
                state.current.roadsDirty = true; state.current.colorsDirty = true;
                fireEvent('impact', 'METEOR IMPACT — city block obliterated. Fires spreading!', 'critical', 3);
            }
        } else metMesh.visible = false;

        // ----- traffic -----
        const targetCars = Math.min(MAX_CARS, Math.floor(3 + (s.pop / 60) * ((set.trafficDensity ?? 50) / 50)));
        s.spawnAcc += dt;
        if (cars.current.length < targetCars && s.spawnAcc > 0.3 && roadCellsRef.current.length > 8) {
            s.spawnAcc = 0;
            const rc = roadCellsRef.current;
            const a = rc[Math.floor(Math.random() * rc.length)];
            const b = rc[Math.floor(Math.random() * rc.length)];
            if (a !== b) {
                const path = roadPathBFS(a, b);
                if (path && path.length > 4) cars.current.push({ path, seg: 0, t: Math.random(), speed: 1.6 + Math.random() * 1.2, hue: Math.random() });
            }
        }
        const carMesh = M.current.car;
        const congestionBase = roadCellsRef.current.length > 0 ? cars.current.length / roadCellsRef.current.length : 0;
        s.congestion = Math.min(100, congestionBase * 240);
        const speedMult = Math.max(0.3, 1 - congestionBase * 1.8) * (1 - s.rainF * 0.3);
        const nextCars: Car[] = [];
        let ci = 0;
        const carCol = new THREE.Color();
        for (const car of cars.current) {
            car.t += dt * car.speed * speedMult;
            while (car.t >= 1 && car.seg < car.path.length - 2) { car.t -= 1; car.seg++; }
            if (car.seg >= car.path.length - 2 && car.t >= 1) continue; // arrived
            const [ax, az] = idx2xz(car.path[car.seg]);
            const [bx, bz] = idx2xz(car.path[car.seg + 1]);
            const px = ax + (bx - ax) * car.t, pz = az + (bz - az) * car.t;
            // lane offset
            const dx = bx - ax, dz = bz - az;
            const ox = -dz * 0.18, oz = dx * 0.18;
            dummy.position.set(px + ox, 0.36 + 0.35, pz + oz);
            dummy.rotation.set(0, Math.atan2(dx, dz), 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            if (ci < MAX_CARS) {
                carMesh.setMatrixAt(ci, dummy.matrix);
                carCol.setHSL(car.hue, 0.65, 0.5);
                carMesh.setColorAt(ci, carCol);
                ci++;
            }
            nextCars.push(car);
        }
        cars.current = nextCars;
        dummy.position.set(0, -500, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix();
        for (let i = ci; i < MAX_CARS; i++) carMesh.setMatrixAt(i, dummy.matrix);
        carMesh.instanceMatrix.needsUpdate = true;
        if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;

        // ----- pedestrians (streets empty out at night) -----
        const targetPeds = Math.min(MAX_PEDS, Math.floor((Math.floor(s.pop / 3.2) + 40) * (0.3 + dayF * 0.7)));
        const pedMesh = M.current.ped, headMesh = M.current.head;
        const rc = roadCellsRef.current;
        if (peds.current.length < targetPeds && rc.length > 4) {
            for (let k = 0; k < 6 && peds.current.length < targetPeds; k++) {
                const c0 = rc[Math.floor(Math.random() * rc.length)];
                peds.current.push({ cell: c0, next: c0, t: 1, speed: 0.5 + Math.random() * 0.7, hue: Math.random(), skin: Math.random(), off: Math.random() * 20 });
            }
        }
        if (peds.current.length > targetPeds) peds.current.length = targetPeds;
        const pedCol = new THREE.Color();
        const skinTones = [0xfadbc5, 0xe0ac69, 0xc68642, 0x8d5524, 0x6b4226];
        let pi = 0;
        for (const p of peds.current) {
            p.t += dt * p.speed;
            if (p.t >= 1) {
                p.t = 0; p.cell = p.next;
                const gx = p.cell % SIZE, gz = Math.floor(p.cell / SIZE);
                const opts: number[] = [];
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const nx = gx + dx, nz = gz + dz;
                    if (inBounds(nx, nz)) {
                        const nt = cells[nz * SIZE + nx].type;
                        if (nt === T.ROAD || nt === T.PARK) opts.push(nz * SIZE + nx);
                    }
                }
                p.next = opts.length ? opts[Math.floor(Math.random() * opts.length)] : p.cell;
            }
            const [ax, az] = idx2xz(p.cell);
            const [bx, bz] = idx2xz(p.next);
            const px = ax + (bx - ax) * p.t, pz = az + (bz - az) * p.t;
            const sideOx = 0.34 * Math.sin(p.off * 7), sideOz = 0.34 * Math.cos(p.off * 5);
            const bob = Math.abs(Math.sin(ctx.time * 7 + p.off)) * 0.05;
            dummy.position.set(px + sideOx, 0.7 + bob, pz + sideOz);
            dummy.rotation.set(0, Math.atan2(bx - ax, bz - az), Math.sin(ctx.time * 7 + p.off) * 0.08);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            if (pi < MAX_PEDS) {
                pedMesh.setMatrixAt(pi, dummy.matrix);
                pedCol.setHSL(p.hue, 0.6, 0.5);
                pedMesh.setColorAt(pi, pedCol);
                headMesh.setMatrixAt(pi, dummy.matrix);
                pedCol.setHex(skinTones[Math.floor(p.skin * skinTones.length)]);
                headMesh.setColorAt(pi, pedCol);
                pi++;
            }
        }
        dummy.position.set(0, -500, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix();
        for (let i = pi; i < MAX_PEDS; i++) { pedMesh.setMatrixAt(i, dummy.matrix); headMesh.setMatrixAt(i, dummy.matrix); }
        pedMesh.instanceMatrix.needsUpdate = true;
        if (pedMesh.instanceColor) pedMesh.instanceColor.needsUpdate = true;
        headMesh.instanceMatrix.needsUpdate = true;
        if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;

        // ----- hover / cursor -----
        const hi = hoverIndex(ctx);
        const cursor = singles.current.cursor as THREE.Mesh;
        if (hi !== -1 && toolRef.current) {
            const [x, z] = idx2xz(hi);
            cursor.position.set(x, 0.6, z);
            cursor.visible = true;
            (cursor.material as THREE.MeshBasicMaterial).color.setHex(
                toolRef.current === 'clear' ? 0xf43f5e :
                toolRef.current === 'fire' || toolRef.current === 'meteor' ? 0xff6a00 : 0x22d3ee);
        } else cursor.visible = false;

        if (cbRef.current.onHover && Math.floor(ctx.wallTime * 12) % 2 === 0) {
            if (hi !== -1) {
                const c = cells[hi];
                const names = ['Grassland', 'Water', 'Shore', 'Forest', 'Road', 'Residential', 'Commercial', 'Industrial', 'Park', 'Power Plant', 'Rubble'];
                const data: string[] = [];
                if (ZONES.includes(c.type)) {
                    data.push(`Level: ${c.level.toFixed(1)}`, `Happiness: ${Math.round(c.happy)}%`, `Land value: ${Math.round(c.value)}`,
                        `Pollution: ${Math.round(c.pollution)}`, `Power: ${c.powered && !s.blackout ? 'OK' : 'NONE'}`, `Road access: ${c.access ? 'YES' : 'NO'}`);
                } else if (c.type === T.ROAD) data.push(`Traffic: ${Math.round(s.congestion)}% load`);
                else if (c.type === T.POWER) data.push(`Capacity: 420 units`, `Grid: ${Math.round(s.powerDemand)}/${Math.round(s.powerCap)}`);
                if (c.fire > 0) data.push('🔥 ON FIRE');
                cbRef.current.onHover({ x: ctx.mouse.x, y: ctx.mouse.y, visible: true, label: names[c.type] ?? '?', data });
            } else cbRef.current.onHover({ x: 0, y: 0, visible: false, label: '' });
        }

        // ----- metrics -----
        s.metricAcc += ctx.dt === 0 ? 0.016 : ctx.dt; // still refresh HUD when paused
        if (s.metricAcc > 0.5) {
            s.metricAcc = 0;
            cbRef.current.onUpdateMetrics([
                { label: 'Population', value: s.pop.toLocaleString(), status: s.pop > 2000 ? 'good' : 'neutral', historyKey: 'pop' },
                { label: 'Jobs', value: s.jobs.toLocaleString(), status: 'neutral' },
                { label: 'Treasury', value: money(s.treasury), status: s.treasury < 500 ? 'critical' : s.treasury < 3000 ? 'warning' : 'good', historyKey: 'treasury' },
                { label: 'Happiness', value: Math.round(s.happiness), unit: '%', status: s.happiness > 70 ? 'good' : s.happiness < 40 ? 'critical' : 'neutral', historyKey: 'happy' },
                { label: 'Pollution', value: Math.round(s.avgPollution), status: s.avgPollution > 25 ? 'critical' : s.avgPollution > 12 ? 'warning' : 'good', historyKey: 'pollution' },
                { label: 'Traffic', value: Math.round(s.congestion), unit: '%', status: s.congestion > 60 ? 'warning' : 'neutral' },
                { label: 'Grid', value: s.blackout ? 'OVERLOAD' : `${Math.round((s.powerDemand / Math.max(1, s.powerCap)) * 100)}%`, status: s.blackout ? 'critical' : 'good' },
                { label: 'Day ' + s.day, value: s.clock, status: 'neutral' },
                { label: 'Weather', value: s.weather, status: s.weather === 'RAIN' ? 'warning' : 'neutral' },
                { label: 'Demand', value: `R${Math.round(s.demandR)} C${Math.round(s.demandC)} I${Math.round(s.demandI)}`, status: 'neutral' },
            ], { pop: s.pop, treasury: Math.round(s.treasury), happy: Math.round(s.happiness), pollution: Math.round(s.avgPollution) });
        }
    };

    const mount = useThreeSim({
        init, animate, onClick, onPaint,
        active, zoom: zoom ?? 1.3, timeScale,
        cameraType: 'orthographic',
        cameraPos: [44, 44, 44],
        leftOrbits: !activeTool || activeTool === 'inspect',
        background: 0xbcd7ee,
    });

    return <div ref={mount} className="w-full h-full" />;
});

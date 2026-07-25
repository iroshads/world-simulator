import React, { useRef } from 'react';
import * as THREE from 'three';
import { useThreeSim, SimContext } from '../../hooks/useThreeSim';
import { SimProps } from '../../types';

/**
 * Traffic network: 3×3 grid of signalized intersections.
 * Cars follow the Intelligent Driver Model (IDM) — real car-following physics:
 * free-road acceleration, comfortable braking, desired time-headway (shrinks
 * with aggression), and per-intersection signal phases with an adjustable
 * green-wave offset and adaptive (queue-actuated) switching.
 */

const ROAD_POS = [-16, 0, 16];
const HALF = 52;
const LANE = 1.7;
const CAR_LEN = 2.2;
const STOP_GAP = 4.2;

interface Lane { axis: 'NS' | 'EW'; fixed: number; sign: 1 | -1; }
const LANES: Lane[] = [];
for (const f of ROAD_POS) {
    LANES.push({ axis: 'NS', fixed: f, sign: 1 }, { axis: 'NS', fixed: f, sign: -1 });
    LANES.push({ axis: 'EW', fixed: f, sign: 1 }, { axis: 'EW', fixed: f, sign: -1 });
}

type VType = 'car' | 'truck' | 'sport';
interface Car {
    lane: Lane;
    u: number;         // position along travel direction (-HALF..HALF)
    v: number;         // speed units/s
    crashed: boolean;
    wreckTimer: number;
    braking: boolean;
    waiting: number;   // seconds spent at ~0 speed
    totalWait: number;
    hue: number;
    type: VType;
    len: number;       // body length (trucks are longer)
    vf: number;        // desired-speed factor (sports cars speed, trucks lumber)
    model: THREE.Group | null;
}

interface Particle { p: THREE.Vector3; vel: THREE.Vector3; life: number; max: number; kind: 'spark' | 'smoke' | 'debris'; s: number; }

export const AutonomySim: React.FC<SimProps> = React.memo(({ settings, active, activeTool, zoom, timeScale, onUpdateMetrics, onHover, onEvent }) => {
    const cars = useRef<Car[]>([]);
    const parts = useRef<Particle[]>([]);
    const inter = useRef<{ shift: number; override: number; group: THREE.Group | null; nsMat: THREE.MeshStandardMaterial | null; ewMat: THREE.MeshStandardMaterial | null }[]>([]);
    const stats = useRef({ collisions: 0, completed: 0, startTime: 0, spawnAcc: 0, metricAcc: 0, adaptAcc: 0, waitSamples: [] as number[], gridlockAt: -99 });

    const M = useRef<Record<string, THREE.InstancedMesh>>({});
    const carGroup = useRef<THREE.Group | null>(null);
    const singles = useRef<Record<string, any>>({});

    const settingsRef = useRef(settings); settingsRef.current = settings;
    const toolRef = useRef(activeTool); toolRef.current = activeTool;
    const cbRef = useRef({ onUpdateMetrics, onHover, onEvent });
    cbRef.current = { onUpdateMetrics, onHover, onEvent };

    // signal phase for intersection (ix, iz) at sim time t → returns {ns: 'G'|'Y'|'R', ew: ...}
    const phaseAt = (t: number, ix: number, iz: number) => {
        const s = settingsRef.current;
        const g = Math.max(2, s.greenDuration ?? 6);
        const y = 1.2;
        const cycle = 2 * (g + y);
        const waveOff = ((s.greenWave ?? 30) / 100) * cycle * 0.25;
        const ii = iz * 3 + ix;
        const st = inter.current[ii];
        let tl = (t + (ix + iz) * waveOff + (st?.shift ?? 0) + (st?.override ?? 0)) % cycle;
        if (tl < 0) tl += cycle;
        if (tl < g) return { ns: 'G', ew: 'R' };
        if (tl < g + y) return { ns: 'Y', ew: 'R' };
        if (tl < 2 * g + y) return { ns: 'R', ew: 'G' };
        return { ns: 'R', ew: 'Y' };
    };

    const init = (ctx: SimContext) => {
        const { scene } = ctx;
        scene.fog = new THREE.Fog(0xcfe2f3, 140, 360);
        cars.current = []; parts.current = [];
        stats.current = { collisions: 0, completed: 0, startTime: 0, spawnAcc: 0, metricAcc: 0, adaptAcc: 0, waitSamples: [], gridlockAt: -99 };

        // ground
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ color: 0x93c78d, roughness: 1 }));
        ground.rotation.x = -Math.PI / 2; ground.position.y = -0.12; ground.receiveShadow = true;
        scene.add(ground);

        // ---- city scenery: buildings & trees fill the blocks between roads ----
        const onRoad = (x: number, z: number, m: number) => ROAD_POS.some(r => Math.abs(x - r) < m) || ROAD_POS.some(r => Math.abs(z - r) < m);
        const bldGeo = new THREE.BoxGeometry(1, 1, 1); bldGeo.translate(0, 0.5, 0);
        const bldMesh = new THREE.InstancedMesh(bldGeo, new THREE.MeshStandardMaterial({ roughness: 0.75 }), 70);
        bldMesh.castShadow = true; bldMesh.receiveShadow = true;
        const dummy = new THREE.Object3D();
        const col = new THREE.Color();
        const palette = [0xe6ebf1, 0xead9bc, 0xd9a98c, 0xc9d6df, 0xf0e4d0];
        let bi = 0;
        for (let tries = 0; tries < 600 && bi < 70; tries++) {
            const x = (Math.random() - 0.5) * 104, z = (Math.random() - 0.5) * 104;
            if (onRoad(x, z, 7.5)) continue;
            const w = 2.5 + Math.random() * 3.5;
            const h = 2 + Math.random() * (10 - Math.abs(x + z) * 0.05);
            dummy.position.set(x, 0, z);
            dummy.scale.set(w, h, 2.5 + Math.random() * 3.5);
            dummy.rotation.set(0, 0, 0);
            dummy.updateMatrix();
            bldMesh.setMatrixAt(bi, dummy.matrix);
            bldMesh.setColorAt(bi, col.setHex(palette[Math.floor(Math.random() * palette.length)]));
            bi++;
        }
        for (let i = bi; i < 70; i++) { dummy.position.set(0, -500, 0); dummy.scale.setScalar(0); dummy.updateMatrix(); bldMesh.setMatrixAt(i, dummy.matrix); }
        scene.add(bldMesh);

        const sceneryTreeGeo = new THREE.ConeGeometry(0.9, 2.6, 7); sceneryTreeGeo.translate(0, 1.3, 0);
        const treeMesh = new THREE.InstancedMesh(sceneryTreeGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), 90);
        treeMesh.castShadow = true;
        let ti = 0;
        for (let tries = 0; tries < 700 && ti < 90; tries++) {
            const x = (Math.random() - 0.5) * 108, z = (Math.random() - 0.5) * 108;
            if (onRoad(x, z, 5.5)) continue;
            const s = 0.7 + Math.random() * 0.8;
            dummy.position.set(x, 0, z);
            dummy.scale.set(s, s * (0.8 + Math.random() * 0.5), s);
            dummy.updateMatrix();
            treeMesh.setMatrixAt(ti, dummy.matrix);
            treeMesh.setColorAt(ti, col.setHSL(0.33, 0.5, 0.28 + Math.random() * 0.14));
            ti++;
        }
        for (let i = ti; i < 90; i++) { dummy.position.set(0, -500, 0); dummy.scale.setScalar(0); dummy.updateMatrix(); treeMesh.setMatrixAt(i, dummy.matrix); }
        scene.add(treeMesh);

        // roads
        const roadMat = new THREE.MeshStandardMaterial({ color: 0x353c47, roughness: 0.8 });
        for (const f of ROAD_POS) {
            const h = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF + 16, 8), roadMat);
            h.rotation.x = -Math.PI / 2; h.position.set(0, 0.0, f); h.receiveShadow = true; scene.add(h);
            const v = new THREE.Mesh(new THREE.PlaneGeometry(8, 2 * HALF + 16), roadMat);
            v.rotation.x = -Math.PI / 2; v.position.set(f, 0.01, 0); v.receiveShadow = true; scene.add(v);
        }
        // markings
        const dashMat = new THREE.MeshBasicMaterial({ color: 0xcbd5e1 });
        const dashGeo = new THREE.PlaneGeometry(1.4, 0.14);
        const marks = new THREE.Group();
        for (const f of ROAD_POS) {
            for (let d = -HALF; d < HALF; d += 3.2) {
                if (ROAD_POS.some(p => Math.abs(d - p) < 6)) continue;
                const m1 = new THREE.Mesh(dashGeo, dashMat); m1.rotation.x = -Math.PI / 2; m1.position.set(d, 0.02, f); marks.add(m1);
                const m2 = new THREE.Mesh(dashGeo, dashMat); m2.rotation.x = -Math.PI / 2; m2.rotation.z = Math.PI / 2; m2.position.set(f, 0.02, d); marks.add(m2);
            }
        }
        // stop lines
        const stopGeo = new THREE.PlaneGeometry(0.5, 3.4);
        for (const fx of ROAD_POS) for (const fz of ROAD_POS) {
            const s1 = new THREE.Mesh(stopGeo, dashMat); s1.rotation.x = -Math.PI / 2; s1.rotation.z = Math.PI / 2; s1.position.set(fx + LANE, 0.02, fz - STOP_GAP); marks.add(s1);
            const s2 = new THREE.Mesh(stopGeo, dashMat); s2.rotation.x = -Math.PI / 2; s2.rotation.z = Math.PI / 2; s2.position.set(fx - LANE, 0.02, fz + STOP_GAP); marks.add(s2);
            const s3 = new THREE.Mesh(stopGeo, dashMat); s3.rotation.x = -Math.PI / 2; s3.position.set(fx - STOP_GAP, 0.02, fz - LANE); marks.add(s3);
            const s4 = new THREE.Mesh(stopGeo, dashMat); s4.rotation.x = -Math.PI / 2; s4.position.set(fx + STOP_GAP, 0.02, fz + LANE); marks.add(s4);
        }
        scene.add(marks);

        // intersections signals
        inter.current = [];
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.7, roughness: 0.3 });
        for (let iz = 0; iz < 3; iz++) for (let ix = 0; ix < 3; ix++) {
            const grp = new THREE.Group();
            grp.position.set(ROAD_POS[ix], 0, ROAD_POS[iz]);
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6), poleMat);
            pole.position.set(5.2, 3, 5.2); pole.castShadow = true;
            grp.add(pole);
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 4.4), poleMat);
            arm.position.set(5.2, 5.7, 3.2); grp.add(arm);
            const arm2 = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.14, 0.14), poleMat);
            arm2.position.set(3.2, 5.7, 5.2); grp.add(arm2);
            const nsMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x00ff00, emissiveIntensity: 1 });
            const ewMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xff0000, emissiveIntensity: 1 });
            const nsSig = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.5), nsMat);
            nsSig.position.set(5.2, 5.0, 1.2); grp.add(nsSig);
            const ewSig = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.9), ewMat);
            ewSig.position.set(1.2, 5.0, 5.2); grp.add(ewSig);
            scene.add(grp);
            inter.current.push({ shift: 0, override: 0, group: grp, nsMat, ewMat });
        }

        carGroup.current = new THREE.Group();
        scene.add(carGroup.current);

        // particles
        const mk = (key: string, geo: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
            const m = new THREE.InstancedMesh(geo, mat, count);
            m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            m.frustumCulled = false;
            scene.add(m);
            M.current[key] = m;
        };
        mk('spark', new THREE.DodecahedronGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0xff5510, transparent: true, opacity: 0.85, depthWrite: false }), 400);
        mk('smoke', new THREE.IcosahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial({ color: 0x707784, transparent: true, opacity: 0.35, depthWrite: false }), 400);
        mk('debris', new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x4a4f58, roughness: 0.6, metalness: 0.6 }), 150);

        // click plane
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ visible: false }));
        plane.rotation.x = -Math.PI / 2;
        scene.add(plane);
        singles.current.plane = plane;
    };

    const buildCar = (hue: number, type: VType, len: number) => {
        const g = new THREE.Group();
        const col = new THREE.Color().setHSL(hue, 0.7, 0.5);
        const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.25, metalness: 0.5 });
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a2333, roughness: 0.1, metalness: 0.8 });
        if (type === 'truck') {
            const cab = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.9, 1.0), bodyMat);
            cab.position.set(0, 0.65, -len / 2 + 0.55); cab.castShadow = true; g.add(cab);
            const cargo = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, len - 1.3), new THREE.MeshStandardMaterial({ color: 0xe8e8ec, roughness: 0.6 }));
            cargo.position.set(0, 0.78, 0.55); cargo.castShadow = true; g.add(cargo);
        } else if (type === 'sport') {
            const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.36, len), bodyMat);
            chassis.position.y = 0.38; chassis.castShadow = true; g.add(chassis);
            const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.3, 0.95), glassMat);
            cabin.position.set(0, 0.68, 0.05); g.add(cabin);
        } else {
            const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, len), bodyMat);
            chassis.position.y = 0.45; chassis.castShadow = true; g.add(chassis);
            const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.42, 1.1), glassMat);
            cabin.position.set(0, 0.85, -0.1); g.add(cabin);
        }
        const brakeMat = new THREE.MeshBasicMaterial({ color: 0x330000 });
        const brake = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.18), brakeMat);
        brake.position.set(0, 0.55, len / 2 + 0.01); brake.name = 'brake'; g.add(brake);
        const headMat = new THREE.MeshBasicMaterial({ color: 0xfff7cc });
        const hl = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.15), headMat);
        hl.position.set(0, 0.45, -len / 2 - 0.01); hl.rotation.y = Math.PI; g.add(hl);
        const wGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.22, 12); wGeo.rotateZ(Math.PI / 2);
        const wMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });
        const wz = len / 2 - 0.42;
        for (const [x, z] of [[0.52, wz], [0.52, -wz], [-0.52, wz], [-0.52, -wz]]) {
            const w = new THREE.Mesh(wGeo, wMat); w.position.set(x, 0.28, z); g.add(w);
        }
        return g;
    };

    const spawnCar = (laneIdx?: number) => {
        const lane = LANES[laneIdx ?? Math.floor(Math.random() * LANES.length)];
        // don't spawn on top of another car
        for (const c of cars.current) {
            if (c.lane === lane && c.u < -HALF + 7) return;
        }
        const s = settingsRef.current;
        const r = Math.random();
        const type: VType = r < 0.16 ? 'truck' : r < 0.3 ? 'sport' : 'car';
        cars.current.push({
            lane, u: -HALF, v: (s.speedLimit ?? 50) * 0.1,
            crashed: false, wreckTimer: 0, braking: false, waiting: 0, totalWait: 0,
            hue: Math.random(), type,
            len: type === 'truck' ? 3.4 : type === 'sport' ? 2.0 : CAR_LEN,
            vf: type === 'truck' ? 0.8 : type === 'sport' ? 1.3 : 1,
            model: null,
        });
    };

    const worldPos = (c: Car): [number, number, number] => {
        // right-hand traffic lane offset
        const off = LANE * (c.lane.axis === 'NS' ? c.lane.sign : -c.lane.sign);
        const coord = c.u * c.lane.sign;
        return c.lane.axis === 'NS' ? [c.lane.fixed + off, 0, coord] : [coord, 0, c.lane.fixed + off];
    };

    const spawnExplosion = (pos: THREE.Vector3) => {
        for (let i = 0; i < 14; i++) parts.current.push({ p: pos.clone().add(new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.6, (Math.random() - 0.5))), vel: new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3), life: 0.8 + Math.random() * 0.5, max: 1.2, kind: 'spark', s: 0.3 + Math.random() * 0.4 });
        for (let i = 0; i < 10; i++) parts.current.push({ p: pos.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 0.8, 1 + Math.random(), (Math.random() - 0.5) * 0.8), life: 2.4 + Math.random() * 1.5, max: 4, kind: 'smoke', s: 0.5 + Math.random() * 0.6 });
        for (let i = 0; i < 8; i++) parts.current.push({ p: pos.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 3, (Math.random() - 0.5) * 6), life: 1.6, max: 1.6, kind: 'debris', s: 0.25 + Math.random() * 0.3 });
    };

    const animate = (ctx: SimContext) => {
        const s = settingsRef.current;
        const dt = ctx.dt;
        const t = ctx.time;
        const st = stats.current;

        // IDM parameters
        const friction = Math.max(0.2, (s.roadFriction ?? 100) / 100);
        const v0 = Math.max(2, (s.speedLimit ?? 50) * 0.14);
        const aggr = (s.driverAggression ?? 30) / 100;
        const aMax = 2.2 * friction * (1 + aggr * 0.8);
        const bComf = 3.0 * friction;
        const T_headway = Math.max(0.35, 1.6 - aggr * 1.3);
        const s0 = 1.3;

        // update signal visuals
        for (let iz = 0; iz < 3; iz++) for (let ix = 0; ix < 3; ix++) {
            const ph = phaseAt(t, ix, iz);
            const ii = iz * 3 + ix;
            const rec = inter.current[ii];
            if (rec?.nsMat && rec.ewMat) {
                rec.nsMat.emissive.setHex(ph.ns === 'G' ? 0x22c55e : ph.ns === 'Y' ? 0xeab308 : 0xef4444);
                rec.ewMat.emissive.setHex(ph.ew === 'G' ? 0x22c55e : ph.ew === 'Y' ? 0xeab308 : 0xef4444);
            }
        }

        // adaptive signals: queue-actuated phase advance
        st.adaptAcc += dt;
        const adaptivity = (s.adaptiveSignals ?? 0) / 100;
        if (st.adaptAcc > 1 && adaptivity > 0) {
            st.adaptAcc = 0;
            const queues: { ns: number; ew: number }[] = Array(9).fill(0).map(() => ({ ns: 0, ew: 0 }));
            for (const c of cars.current) {
                if (c.v > 0.5 || c.crashed) continue;
                const coord = c.u * c.lane.sign;
                for (let k = 0; k < 3; k++) {
                    const d = ROAD_POS[k] * c.lane.sign - c.u;
                    if (d > 0 && d < 14) {
                        const fixedIdx = ROAD_POS.indexOf(c.lane.fixed);
                        const ii = c.lane.axis === 'NS' ? k * 3 + fixedIdx : ROAD_POS.indexOf(ROAD_POS[k]) + 0; // NS: iz=k, ix=fixedIdx
                        const idx = c.lane.axis === 'NS' ? k * 3 + fixedIdx : fixedIdx * 3 + k;
                        if (c.lane.axis === 'NS') queues[idx].ns++; else queues[idx].ew++;
                    }
                }
            }
            for (let iz = 0; iz < 3; iz++) for (let ix = 0; ix < 3; ix++) {
                const ii = iz * 3 + ix;
                const ph = phaseAt(t, ix, iz);
                const q = queues[ii];
                // if green side empty and red side has a queue, advance phase
                if (ph.ns === 'G' && q.ns === 0 && q.ew > 1 && Math.random() < adaptivity) inter.current[ii].shift += 2.5;
                if (ph.ew === 'G' && q.ew === 0 && q.ns > 1 && Math.random() < adaptivity) inter.current[ii].shift += 2.5;
            }
        }

        // --- car physics ---
        let speedSum = 0, movingCount = 0, waitingCount = 0;
        for (const c of cars.current) {
            if (c.crashed) { c.wreckTimer -= dt; continue; }

            // find nearest obstacle distance (leader car or red light stop line)
            const v0c = v0 * c.vf;
            let gap = 999;
            let leaderV = v0c;
            for (const o of cars.current) {
                if (o === c || o.lane.axis !== c.lane.axis || o.lane.fixed !== c.lane.fixed || o.lane.sign !== c.lane.sign) continue;
                const du = o.u - c.u - (o.len + c.len) / 2;
                if (du > 0 && du < gap) { gap = du; leaderV = o.crashed ? 0 : o.v; }
            }
            // signals along the way
            for (let k = 0; k < 3; k++) {
                const uInt = ROAD_POS[k] * c.lane.sign;
                const dStop = uInt - STOP_GAP - c.u - c.len / 2;
                if (dStop < -1 || dStop > 45) continue;
                const fixedIdx = ROAD_POS.indexOf(c.lane.fixed);
                const [ix, iz] = c.lane.axis === 'NS' ? [fixedIdx, k] : [k, fixedIdx];
                const ph = phaseAt(t, ix, iz);
                const mine = c.lane.axis === 'NS' ? ph.ns : ph.ew;
                if (mine === 'R' || (mine === 'Y' && (dStop > 6 || aggr < 0.35))) {
                    // aggressive drivers run lights when close & fast
                    const runsIt = mine === 'R' && aggr > 0.75 && dStop < 3 && c.v > v0c * 0.7 && Math.random() < 0.4;
                    if (!runsIt && dStop > -1 && dStop < gap) { gap = Math.max(0.01, dStop); leaderV = 0; }
                }
            }

            // IDM acceleration
            const dv = c.v - leaderV;
            const sStar = s0 + Math.max(0, c.v * T_headway + (c.v * dv) / (2 * Math.sqrt(aMax * bComf)));
            const acc = aMax * (1 - Math.pow(c.v / v0c, 4) - Math.pow(sStar / Math.max(0.1, gap), 2));
            c.braking = acc < -0.6;
            c.v = Math.max(0, c.v + acc * dt);
            c.u += c.v * dt;

            if (c.v < 0.3) { c.waiting += dt; c.totalWait += dt; waitingCount++; }
            else c.waiting = 0;
            speedSum += c.v; movingCount++;
        }

        // collisions: pairwise AABB in world space
        for (let i = 0; i < cars.current.length; i++) {
            const a = cars.current[i];
            if (a.crashed) continue;
            const [ax, , az] = worldPos(a);
            for (let j = i + 1; j < cars.current.length; j++) {
                const b = cars.current[j];
                if (b.crashed) continue;
                const [bx, , bz] = worldPos(b);
                const aw = a.lane.axis === 'NS' ? 0.55 : a.len / 2 - 0.15;
                const al = a.lane.axis === 'NS' ? a.len / 2 - 0.15 : 0.55;
                const bw = b.lane.axis === 'NS' ? 0.55 : b.len / 2 - 0.15;
                const bl = b.lane.axis === 'NS' ? b.len / 2 - 0.15 : 0.55;
                if (Math.abs(ax - bx) < aw + bw && Math.abs(az - bz) < al + bl) {
                    a.crashed = b.crashed = true;
                    a.wreckTimer = b.wreckTimer = 7;
                    a.v = b.v = 0;
                    stats.current.collisions++;
                    spawnExplosion(new THREE.Vector3((ax + bx) / 2, 0.6, (az + bz) / 2));
                    cbRef.current.onEvent?.('Collision! Wreckage is blocking the lane until cleared.', 'critical');
                }
            }
        }

        // render / cleanup
        const surviving: Car[] = [];
        for (const c of cars.current) {
            const done = c.u > HALF;
            const towed = c.crashed && c.wreckTimer <= 0;
            if (done || towed) {
                if (done && !c.crashed) { st.completed++; st.waitSamples.push(c.totalWait); if (st.waitSamples.length > 60) st.waitSamples.shift(); }
                if (c.model && carGroup.current) carGroup.current.remove(c.model);
                continue;
            }
            if (!c.model && carGroup.current) { c.model = buildCar(c.hue, c.type, c.len); carGroup.current.add(c.model); }
            if (c.model) {
                const [x, y, z] = worldPos(c);
                c.model.position.set(x, y, z);
                c.model.rotation.y = c.lane.axis === 'NS' ? (c.lane.sign === 1 ? 0 : Math.PI) : (c.lane.sign === 1 ? Math.PI / 2 : -Math.PI / 2);
                const brake = c.model.getObjectByName('brake') as THREE.Mesh;
                if (brake) (brake.material as THREE.MeshBasicMaterial).color.setHex(c.braking || c.crashed ? 0xff2020 : 0x330000);
                if (c.crashed) {
                    c.model.rotation.z = Math.sin(c.wreckTimer * 2) * 0.02;
                    if (Math.random() < dt * 8) parts.current.push({ p: new THREE.Vector3(c.model.position.x, 1, c.model.position.z), vel: new THREE.Vector3(0, 1.2, 0), life: 1.8, max: 1.8, kind: 'smoke', s: 0.4 });
                }
            }
            surviving.push(c);
        }
        cars.current = surviving;

        // spawner
        const target = Math.round((s.trafficDensity ?? 50) * 0.6);
        st.spawnAcc += dt;
        if (cars.current.length < target && st.spawnAcc > 0.25) { st.spawnAcc = 0; spawnCar(); }

        // gridlock detection
        const avgSpeed = movingCount ? speedSum / movingCount : 0;
        if (movingCount > 12 && avgSpeed < 0.4 && t - st.gridlockAt > 20) {
            st.gridlockAt = t;
            cbRef.current.onEvent?.('Gridlock detected — network flow has collapsed. Try adaptive signals or a longer green.', 'warning');
        }

        // particles
        const dummy = new THREE.Object3D();
        const counts: Record<string, number> = { spark: 0, smoke: 0, debris: 0 };
        const caps: Record<string, number> = { spark: 400, smoke: 400, debris: 150 };
        const next: Particle[] = [];
        for (const p of parts.current) {
            p.life -= dt;
            if (p.life <= 0) continue;
            p.p.addScaledVector(p.vel, dt);
            if (p.kind === 'debris') {
                p.vel.y -= 9 * dt;
                if (p.p.y < 0.15) { p.p.y = 0.15; p.vel.y *= -0.4; p.vel.x *= 0.7; p.vel.z *= 0.7; }
            } else p.vel.multiplyScalar(1 - dt * 0.8);
            const mesh = M.current[p.kind];
            const idx = counts[p.kind];
            if (mesh && idx < caps[p.kind]) {
                const lifeR = p.life / p.max;
                dummy.position.copy(p.p);
                dummy.scale.setScalar(p.kind === 'smoke' ? p.s * (2 - lifeR) : p.s * lifeR);
                dummy.rotation.set(p.life * 3, p.life * 5, 0);
                dummy.updateMatrix();
                mesh.setMatrixAt(idx, dummy.matrix);
                counts[p.kind]++;
            }
            next.push(p);
        }
        parts.current = next;
        dummy.position.set(0, -500, 0); dummy.scale.set(0, 0, 0); dummy.updateMatrix();
        for (const k of ['spark', 'smoke', 'debris']) {
            const mesh = M.current[k];
            for (let i = counts[k]; i < caps[k]; i++) mesh.setMatrixAt(i, dummy.matrix);
            mesh.instanceMatrix.needsUpdate = true;
        }

        // hover: nearest intersection info
        if (cbRef.current.onHover && Math.floor(ctx.wallTime * 10) % 2 === 0) {
            const ints = ctx.raycaster.intersectObject(singles.current.plane);
            let shown = false;
            if (ints.length) {
                const pt = ints[0].point;
                for (let iz = 0; iz < 3; iz++) for (let ix = 0; ix < 3; ix++) {
                    if (Math.abs(pt.x - ROAD_POS[ix]) < 6 && Math.abs(pt.z - ROAD_POS[iz]) < 6) {
                        const ph = phaseAt(t, ix, iz);
                        cbRef.current.onHover({
                            x: ctx.mouse.x, y: ctx.mouse.y, visible: true,
                            label: `Intersection ${ix + 1}-${iz + 1}`,
                            data: [`NS: ${ph.ns === 'G' ? 'GREEN' : ph.ns === 'Y' ? 'YELLOW' : 'RED'}`, `EW: ${ph.ew === 'G' ? 'GREEN' : ph.ew === 'Y' ? 'YELLOW' : 'RED'}`, 'Click to switch phase'],
                        });
                        shown = true;
                    }
                }
            }
            if (!shown) cbRef.current.onHover({ x: 0, y: 0, visible: false, label: '' });
        }

        // metrics
        st.metricAcc += dt || 0.016;
        if (st.metricAcc > 0.5) {
            st.metricAcc = 0;
            const kmh = avgSpeed * (50 / 0.14 / 100); // invert of v0 scale → km/h approx
            const throughput = ctx.time > 5 ? (st.completed / ctx.time) * 60 : 0;
            const avgWait = st.waitSamples.length ? st.waitSamples.reduce((a, b) => a + b, 0) / st.waitSamples.length : 0;
            cbRef.current.onUpdateMetrics([
                { label: 'Vehicles', value: cars.current.length, status: 'neutral' },
                { label: 'Avg Speed', value: Math.round(avgSpeed * 7.1), unit: 'km/h', status: avgSpeed < 1 && cars.current.length > 8 ? 'critical' : avgSpeed < 2.5 ? 'warning' : 'good', historyKey: 'speed' },
                { label: 'Throughput', value: throughput.toFixed(0), unit: '/min', status: 'neutral', historyKey: 'throughput' },
                { label: 'Waiting', value: waitingCount, status: waitingCount > 15 ? 'warning' : 'neutral' },
                { label: 'Avg Delay', value: avgWait.toFixed(1), unit: 's', status: avgWait > 20 ? 'critical' : avgWait > 10 ? 'warning' : 'good' },
                { label: 'Collisions', value: st.collisions, status: st.collisions > 0 ? 'critical' : 'good' },
            ], { speed: Math.round(avgSpeed * 7.1), throughput: Math.round(throughput) });
        }
    };

    const onClick = (ctx: SimContext) => {
        const tool = toolRef.current;
        const ints = ctx.raycaster.intersectObject(singles.current.plane);
        if (!ints.length) return;
        const pt = ints[0].point;
        if (tool === 'spawn') {
            for (let i = 0; i < 8; i++) setTimeout(() => spawnCar(), i * 120);
            cbRef.current.onEvent?.('Traffic surge injected — 8 vehicles entering the network.', 'info');
            return;
        }
        if (tool === 'clearWrecks') {
            let n = 0;
            for (const c of cars.current) if (c.crashed) { c.wreckTimer = 0; n++; }
            if (n) cbRef.current.onEvent?.(`Tow trucks dispatched — ${n} wreck(s) cleared.`, 'good');
            return;
        }
        // default: toggle nearest intersection phase
        for (let iz = 0; iz < 3; iz++) for (let ix = 0; ix < 3; ix++) {
            if (Math.abs(pt.x - ROAD_POS[ix]) < 7 && Math.abs(pt.z - ROAD_POS[iz]) < 7) {
                const s = settingsRef.current;
                const g = Math.max(2, s.greenDuration ?? 6);
                inter.current[iz * 3 + ix].override += g + 1.2; // jump half cycle
                cbRef.current.onEvent?.(`Manual override: intersection ${ix + 1}-${iz + 1} phase switched.`, 'info');
            }
        }
    };

    const mount = useThreeSim({
        init, animate, onClick,
        active, zoom: zoom ?? 1.3, timeScale,
        cameraType: 'perspective',
        cameraPos: [46, 42, 46],
        leftOrbits: false,
        background: 0xcfe2f3,
    });

    return <div ref={mount} className="w-full h-full" />;
});

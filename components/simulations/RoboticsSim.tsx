
import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useThreeSim } from '../../hooks/useThreeSim';
import { SimProps } from '../../types';
import { Power, RotateCcw, BatteryWarning } from 'lucide-react';

const MAT = {
    base: new THREE.MeshStandardMaterial({ color: 0xffffff }), 
    hover: new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, transparent: true, opacity: 0.6 }),
};

export const RoboticsSim: React.FC<SimProps> = React.memo(({ settings, activeTool, active, zoom, onUpdateMetrics, onHover }) => {
    const GRID = 20;
    const gridRef = useRef<number[]>([]); 
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const robotRef = useRef<THREE.Group>(null);
    const lidarLinesRef = useRef<THREE.LineSegments>(null);
    const pathLinesRef = useRef<THREE.Line>(null); // Visualizer for path
    const targetRef = useRef<THREE.Mesh>(null);
    const cursorRef = useRef<THREE.Mesh>(null);
    const planeRef = useRef<THREE.Mesh>(null);
    const clickMarkerRef = useRef<THREE.Mesh>(null);
    const chargerRef = useRef<THREE.Group>(null); 
    
    // UI State for Dead Robot
    const [isDead, setIsDead] = useState(false);
    const isDeadRef = useRef(false); // To sync with animation loop without re-renders

    // Ensure activeTool is always fresh in the render loop without re-init
    const activeToolRef = useRef(activeTool);
    useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

    const stateRef = useRef({
        pos: new THREE.Vector3(0.5, 0, 0.5), 
        target: new THREE.Vector3(0.5, 0, 0.5), 
        angle: 0,
        status: 'IDLE' as 'IDLE'|'MOVING'|'BLOCKED'|'WORKING'|'CHARGING'|'RETURNING'|'DEAD', 
        workTimer: 0, 
        path: [] as THREE.Vector3[], 
        pathIdx: 0,
        battery: 100, 
        isGoingToCharge: false,
        blockedRetries: 0
    });
    const autoTaskTimer = useRef(0);
    
    // Materials
    const ROBOT_MAT = { 
        white: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }), 
        black: new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4 }), 
        visor: new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.1, metalness: 0.8, emissive: 0x06b6d4, emissiveIntensity: 0.5 }), 
        joint: new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3, metalness: 0.3 }) 
    };

    const buildRobot = (): THREE.Group => {
        const group = new THREE.Group(); const s = 0.35; group.scale.set(s, s, s);
        const torsoGrp = new THREE.Group(); torsoGrp.position.y = 2.8; group.add(torsoGrp);
        // @ts-ignore
        group.userData.torso = torsoGrp;
        const chest = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 0.8), ROBOT_MAT.white); chest.position.y = 0.6; torsoGrp.add(chest);
        const abs = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.8, 8), ROBOT_MAT.black); abs.position.y = -0.4; torsoGrp.add(abs);
        const headGrp = new THREE.Group(); headGrp.position.y = 1.4; torsoGrp.add(headGrp);
        // @ts-ignore
        group.userData.head = headGrp;
        const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.8), ROBOT_MAT.white); headGrp.add(helmet);
        const visorGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.6, 16, 1, false, 0, Math.PI); visorGeo.rotateZ(Math.PI / 2);
        const visor = new THREE.Mesh(visorGeo, ROBOT_MAT.visor); visor.position.set(0, 0.05, 0.35); headGrp.add(visor);
        const createArm = (side: 1 | -1) => { const armGrp = new THREE.Group(); armGrp.position.set(side * 0.9, 1.1, 0); torsoGrp.add(armGrp); const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.35), ROBOT_MAT.joint); armGrp.add(shoulder); const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.2), ROBOT_MAT.black); upperArm.position.y = -0.6; armGrp.add(upperArm); const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.2), ROBOT_MAT.joint); elbow.position.y = -1.2; armGrp.add(elbow); const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.1), ROBOT_MAT.white); forearm.position.y = -1.8; armGrp.add(forearm); const hand = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.1), ROBOT_MAT.black); hand.position.y = -2.45; armGrp.add(hand); return armGrp; };
        // @ts-ignore
        group.userData.rightArm = createArm(-1); // @ts-ignore
        group.userData.leftArm = createArm(1);
        const hips = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 0.7), ROBOT_MAT.white); hips.position.y = -0.9; torsoGrp.add(hips); const createLeg = (side: 1 | -1) => { const legGrp = new THREE.Group(); legGrp.position.set(side * 0.4, -0.9, 0); torsoGrp.add(legGrp); const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 1.4), ROBOT_MAT.white); thigh.position.y = -0.7; legGrp.add(thigh); const knee = new THREE.Mesh(new THREE.SphereGeometry(0.25), ROBOT_MAT.joint); knee.position.y = -1.4; legGrp.add(knee); const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.15, 1.4), ROBOT_MAT.black); shin.position.y = -2.1; legGrp.add(shin); const foot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.5), ROBOT_MAT.white); foot.position.set(0, -2.85, 0.1); legGrp.add(foot); return legGrp; };
        // @ts-ignore
        group.userData.rightLeg = createLeg(-1); // @ts-ignore
        group.userData.leftLeg = createLeg(1);
        return group;
    };

    const findPath = (start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3[] | null => {
        const offset = GRID/2; 
        // Clamp to valid grid indices to prevent boundary errors
        const sx = Math.max(0, Math.min(GRID - 1, Math.floor(start.x + offset))); 
        const sz = Math.max(0, Math.min(GRID - 1, Math.floor(start.z + offset))); 
        const ex = Math.max(0, Math.min(GRID - 1, Math.floor(end.x + offset))); 
        const ez = Math.max(0, Math.min(GRID - 1, Math.floor(end.z + offset)));
        
        // Safety bounds check (Redundant with clamping but good practice)
        if (ex < 0 || ex >= GRID || ez < 0 || ez >= GRID) return null;
        // Check if destination is blocked
        if (gridRef.current[ez*GRID + ex] === 1) return null; 

        // BFS with 8-connectivity (allow diagonals)
        const queue = [{x: sx, z: sz, path: [] as {x:number, z:number}[]}]; 
        const visited = new Set<string>(); 
        visited.add(`${sx},${sz}`);
        
        while(queue.length > 0) {
            const {x, z, path} = queue.shift()!;
            
            // Reached target
            if (x === ex && z === ez) {
                const fullPath = [...path, {x, z}].map(p => new THREE.Vector3(p.x - offset + 0.5, 0, p.z - offset + 0.5));
                // If we have a path of at least 2 steps (Start -> Next), exclude Start
                // If path is just [Start] (already at target), returning [] is correct
                if (fullPath.length > 1) return fullPath.slice(1);
                return fullPath.length === 1 ? [] : fullPath;
            }
            
            // 8 Directions: N, S, E, W, NE, NW, SE, SW
            const dirs = [
                [0,1], [0,-1], [1,0], [-1,0],
                [1,1], [1,-1], [-1,1], [-1,-1]
            ];
            
            for(let d of dirs) {
                const nx = x + d[0]; 
                const nz = z + d[1]; 
                const key = `${nx},${nz}`;
                
                if (nx>=0 && nx<GRID && nz>=0 && nz<GRID && !visited.has(key)) {
                    if (gridRef.current[nz*GRID + nx] === 0) { 
                        visited.add(key); 
                        queue.push({x: nx, z: nz, path: [...path, {x, z}]}); 
                    }
                }
            }
        }
        return null; 
    };

    const init = (scene: THREE.Scene) => {
        if (gridRef.current.length === 0) { 
            gridRef.current = Array(GRID*GRID).fill(0); 
            for(let i=1; i<GRID*GRID; i++) { 
                if(Math.random() < settings.mapComplexity/100) gridRef.current[i] = 1; 
            }
        }
        gridRef.current[0] = 0;

        const geo = new THREE.BoxGeometry(0.9, 0.2, 0.9); const mesh = new THREE.InstancedMesh(geo, MAT.base, GRID*GRID); mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh);
        // @ts-ignore
        meshRef.current = mesh;
        const planeMat = new THREE.MeshBasicMaterial({ visible: false }); const plane = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), planeMat); plane.rotation.x = -Math.PI/2; plane.visible = true; scene.add(plane);
        // @ts-ignore
        planeRef.current = plane;
        const robot = buildRobot(); scene.add(robot);
        // @ts-ignore
        robotRef.current = robot;
        
        const chargerGrp = new THREE.Group();
        const offset = GRID/2;
        chargerGrp.position.set(-offset + 0.5, 0, -offset + 0.5);
        
        const cBase = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.2 }));
        cBase.position.y = 0.05;
        chargerGrp.add(cBase);
        
        const cCrystal = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.25), 
            new THREE.MeshStandardMaterial({ 
                color: 0xfacc15, 
                emissive: 0xfacc15, 
                emissiveIntensity: 0.8,
                transparent: true,
                opacity: 0.9
            })
        );
        cCrystal.position.y = 0.6;
        cCrystal.name = 'crystal';
        chargerGrp.add(cCrystal);
        
        const cRing = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.7, 32), new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
        cRing.rotation.x = -Math.PI/2;
        cRing.position.y = 0.02;
        chargerGrp.add(cRing);

        scene.add(chargerGrp);
        // @ts-ignore
        chargerRef.current = chargerGrp;


        const lineGeo = new THREE.BufferGeometry(); 
        const lineMat = new THREE.LineBasicMaterial({ color: 0xf472b6, transparent: true, opacity: 0.6 }); 
        const lines = new THREE.LineSegments(lineGeo, lineMat); scene.add(lines);
        // @ts-ignore
        lidarLinesRef.current = lines;
        
        // Path Visualizer
        const pathGeo = new THREE.BufferGeometry();
        const pathMat = new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.8 });
        const pathLine = new THREE.Line(pathGeo, pathMat);
        scene.add(pathLine);
        // @ts-ignore
        pathLinesRef.current = pathLine;
        
        const tGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5); 
        const tMat = new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.6 }); 
        const target = new THREE.Mesh(tGeo, tMat); target.visible = false; scene.add(target);
        // @ts-ignore
        targetRef.current = target;
        
        const cur = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1), MAT.hover); cur.visible = false; scene.add(cur);
        // @ts-ignore
        cursorRef.current = cur;
        const cmGeo = new THREE.RingGeometry(0.3, 0.4, 16); const cmMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide }); const cm = new THREE.Mesh(cmGeo, cmMat); cm.rotation.x = -Math.PI/2; cm.position.y = 0.6; scene.add(cm);
        // @ts-ignore
        clickMarkerRef.current = cm;
    };

    const animate = (scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, frame: number, mouse: THREE.Vector2, raycaster: THREE.Raycaster) => {
        if (!meshRef.current || !robotRef.current) return;
        const mesh = meshRef.current; const robot = robotRef.current; const state = stateRef.current; const dummy = new THREE.Object3D(); const color = new THREE.Color(); const offset = GRID/2;
        
        // --- BATTERY & DEATH LOGIC ---
        const drainRate = (settings.batteryDrain / 500); 
        if (state.status === 'MOVING' || state.status === 'WORKING' || state.status === 'RETURNING') {
            state.battery = Math.max(0, state.battery - drainRate);
        }

        if (state.battery <= 0 && state.status !== 'CHARGING') {
            state.status = 'DEAD';
            state.battery = 0;
            if (!isDeadRef.current) { isDeadRef.current = true; setIsDead(true); }
        }

        if (state.status !== 'DEAD' && state.battery < 10 && !state.isGoingToCharge && state.status !== 'CHARGING') {
             const chargerPos = new THREE.Vector3(-offset + 0.5, 0, -offset + 0.5);
             const path = findPath(state.pos, chargerPos);
             if (path) {
                 state.isGoingToCharge = true; state.status = 'RETURNING'; state.target.copy(chargerPos); state.path = path; state.pathIdx = 0;
                 if (targetRef.current) targetRef.current.visible = false;
             } else {
                 state.status = 'BLOCKED';
             }
        }

        // Render Cursor
        if (clickMarkerRef.current) { const mat = clickMarkerRef.current.material as THREE.MeshBasicMaterial; if (mat.opacity > 0) { mat.opacity -= 0.05; clickMarkerRef.current.scale.multiplyScalar(1.05); } else { clickMarkerRef.current.visible = false; } }
        raycaster.setFromCamera(mouse, camera); let cx = 0, cz = 0, hoverIdx = -1;
        if (planeRef.current) { const ints = raycaster.intersectObject(planeRef.current); if (ints.length > 0) { const pt = ints[0].point; const gx = Math.floor(pt.x + offset); const gz = Math.floor(pt.z + offset); if (gx >= 0 && gx < GRID && gz >= 0 && gz < GRID) { hoverIdx = gz * GRID + gx; cx = gx - offset + 0.5; cz = gz - offset + 0.5; } } }
        if (cursorRef.current) { if (hoverIdx !== -1) { cursorRef.current.position.set(cx, 0.5, cz); cursorRef.current.visible = true; const curMat = cursorRef.current.material as THREE.MeshBasicMaterial; const tool = activeToolRef.current; if (tool === 'wall') curMat.color.setHex(0x334155); else if (tool === 'target') curMat.color.setHex(0x10b981); else if (tool === 'clear') curMat.color.setHex(0xe2e8f0); else curMat.color.setHex(0xffffff); } else { cursorRef.current.visible = false; } }
        if (onHover && frame % 5 === 0) { if (hoverIdx !== -1) { const isWall = gridRef.current[hoverIdx] === 1; const isTarget = Math.abs(state.target.x - cx) < 0.1 && Math.abs(state.target.z - cz) < 0.1; const isCharger = hoverIdx === 0; onHover({ x: mouse.x, y: mouse.y, visible: true, label: isCharger ? 'Charging Station' : (isTarget ? 'Target Goal' : (isWall ? 'Obstacle' : 'Empty Space')), data: [`Pos: [${Math.floor(cx+offset)}, ${Math.floor(cz+offset)}]`] }); } else { onHover({x:0, y:0, visible: false, label: ''}); } }
        
        // Render Floor
        for(let i=0; i<GRID*GRID; i++) { 
            const x = (i % GRID) - offset + 0.5; const z = Math.floor(i / GRID) - offset + 0.5; 
            dummy.position.set(x, 0, z); const isWall = gridRef.current[i] === 1; 
            dummy.scale.y = isWall ? 5 : 1; dummy.position.y = isWall ? 0.5 : 0; 
            if (isWall) {
                const seed = Math.abs(Math.sin(i * 12.9898) * 43758.5453); const variant = Math.floor((seed * 100) % 6);
                switch(variant) { case 0: color.setHex(0x8b4513); break; case 1: color.setHex(0xa0522d); break; case 2: color.setHex(0xcd853f); break; case 3: color.setHex(0xd2b48c); break; case 4: color.setHex(0xbc8f8f); break; case 5: color.setHex(0x654321); break; default: color.setHex(0x8b4513); }
            } else { const isCheck = (Math.floor(x+offset) + Math.floor(z+offset)) % 2 === 0; color.setHex(isCheck ? 0xf8fafc : 0xe2e8f0); }
            dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, color); 
        } 
        mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        
        // Update Charger
        if (chargerRef.current) {
             const crystal = chargerRef.current.getObjectByName('crystal');
             if (crystal) {
                 crystal.rotation.y += 0.05; crystal.position.y = 0.6 + Math.sin(frame * 0.1) * 0.1;
                 if (state.status === 'CHARGING') { (crystal.material as THREE.MeshStandardMaterial).emissiveIntensity = 1 + Math.sin(frame * 0.5) * 0.5; } else { (crystal.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5; }
             }
        }

        // --- STATE MACHINE ---
        if (state.status !== 'DEAD') {
            if (state.status === 'IDLE' && autoTaskTimer.current > -1000) { 
                autoTaskTimer.current++; 
                if (autoTaskTimer.current > 60) { 
                    let tx = 0, tz = 0, found = false; 
                    for(let k=0; k<20; k++){ 
                        tx = Math.floor(Math.random()*GRID) - offset + 0.5; tz = Math.floor(Math.random()*GRID) - offset + 0.5; 
                        const idx = (Math.floor(tz + offset - 0.5) * GRID) + Math.floor(tx + offset - 0.5); 
                        if (gridRef.current[idx] === 0 && idx !== 0) { found = true; break; } 
                    } 
                    if (found) { 
                        const target = new THREE.Vector3(tx, 0, tz); const path = findPath(state.pos, target);
                        if (path) { state.target.copy(target); state.path = path; state.pathIdx = 0; state.status = 'MOVING'; }
                    } 
                    autoTaskTimer.current = 0; 
                } 
            }
            
            if (state.status === 'MOVING' || state.status === 'RETURNING') { 
                const currentTarget = state.path[state.pathIdx] || state.target;
                const ctx = Math.floor(currentTarget.x + offset); const ctz = Math.floor(currentTarget.z + offset);
                
                // Blocked check
                const isBlocked = (ctx >= 0 && ctx < GRID && ctz >= 0 && ctz < GRID && gridRef.current[ctz*GRID + ctx] === 1);
                
                if (isBlocked) {
                    const newPath = findPath(state.pos, state.target);
                    if (newPath) { state.path = newPath; state.pathIdx = 0; } 
                    else { state.status = 'BLOCKED'; state.blockedRetries = 0; }
                } else {
                    const dx = currentTarget.x - state.pos.x; const dz = currentTarget.z - state.pos.z; const dist = Math.sqrt(dx*dx + dz*dz); 
                    const moveSpeed = settings.robotSpeed / 300; 
                    if (dist < 0.15) { 
                        state.pathIdx++; 
                        if (state.pathIdx >= state.path.length) { 
                            if (state.isGoingToCharge) { state.status = 'CHARGING'; } 
                            else { state.status = 'WORKING'; state.workTimer = 0; }
                        } 
                    } else { 
                        const targetAngle = Math.atan2(dx, dz); let angleDiff = targetAngle - state.angle; 
                        while (angleDiff > Math.PI) angleDiff -= Math.PI*2; while (angleDiff < -Math.PI) angleDiff += Math.PI*2; 
                        state.angle += angleDiff * 0.15; 
                        const isTurning = Math.abs(angleDiff) > 0.3; const currentSpeed = isTurning ? 0 : moveSpeed; 
                        state.pos.x += Math.sin(state.angle) * currentSpeed; state.pos.z += Math.cos(state.angle) * currentSpeed; 
                    } 
                }
            } 
            else if (state.status === 'BLOCKED') { 
                // Nudge towards center of tile to fix edge cases
                const tileCenter = new THREE.Vector3(
                    Math.floor(state.pos.x + offset) - offset + 0.5,
                    0,
                    Math.floor(state.pos.z + offset) - offset + 0.5
                );
                state.pos.lerp(tileCenter, 0.1);
                
                state.workTimer++; 
                if (state.workTimer > 30) { 
                    state.workTimer = 0; state.blockedRetries++;
                    const path = findPath(state.pos, state.target);
                    if (path) { state.path = path; state.pathIdx = 0; state.status = state.isGoingToCharge ? 'RETURNING' : 'MOVING'; } 
                    else {
                        // If manually blocked or stuck too long, reset to IDLE immediately to allow new tasks or user correction
                        if (state.blockedRetries > 3 || !state.isGoingToCharge) { state.status = 'IDLE'; autoTaskTimer.current = 0; }
                    }
                } 
            } 
            else if (state.status === 'WORKING') { 
                state.workTimer++; 
                if (state.workTimer > 60) { state.status = 'IDLE'; autoTaskTimer.current = 0; if (targetRef.current) targetRef.current.visible = false; } 
            }
            else if (state.status === 'CHARGING') {
                state.battery = Math.min(100, state.battery + 1.5); 
                if (state.battery >= 100) { state.status = 'IDLE'; state.isGoingToCharge = false; state.battery = 100; autoTaskTimer.current = 0; }
            }
        }

        // Update Path Visualization
        if (pathLinesRef.current) {
            if (state.status === 'MOVING' || state.status === 'RETURNING') {
                const pts = [state.pos.clone()];
                // Add remaining path points
                for(let i=state.pathIdx; i<state.path.length; i++) {
                    pts.push(state.path[i].clone());
                }
                // Raise slightly above floor
                pts.forEach(p => p.y = 0.05);
                pathLinesRef.current.geometry.setFromPoints(pts);
                pathLinesRef.current.visible = true;
            } else {
                pathLinesRef.current.visible = false;
            }
        }

        robot.position.copy(state.pos); robot.rotation.y = state.angle;
        // @ts-ignore
        const leftArm = robot.userData.leftArm; const rightArm = robot.userData.rightArm; const leftLeg = robot.userData.leftLeg; const rightLeg = robot.userData.rightLeg; const torso = robot.userData.torso; const head = robot.userData.head; const visor = head.children[1]; const visorMat = visor.material;
        if (state.status === 'BLOCKED') visorMat.emissive.setHex(frame % 10 < 5 ? 0xff0000 : 0x000000); 
        else if (state.status === 'WORKING') visorMat.emissive.setHex(0x10b981); 
        else if (state.status === 'CHARGING') visorMat.emissive.setHex(0xfacc15);
        else if (state.status === 'RETURNING') visorMat.emissive.setHex(0xf59e0b); 
        else if (state.status === 'DEAD') visorMat.emissive.setHex(0x000000); 
        else visorMat.emissive.setHex(0x06b6d4);

        // Robot Animation
        if (state.status === 'DEAD') {
            leftArm.rotation.x = THREE.MathUtils.lerp(leftArm.rotation.x, 0, 0.1); rightArm.rotation.x = THREE.MathUtils.lerp(rightArm.rotation.x, 0, 0.1); leftArm.rotation.z = THREE.MathUtils.lerp(leftArm.rotation.z, 0.1, 0.1); rightArm.rotation.z = THREE.MathUtils.lerp(rightArm.rotation.z, -0.1, 0.1); torso.rotation.x = THREE.MathUtils.lerp(torso.rotation.x, 0.4, 0.1); head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, 0.5, 0.1); robot.position.y = 0;
        }
        else if (state.status === 'MOVING' || state.status === 'RETURNING') { 
            const speed = 0.3; const swing = Math.sin(frame * speed); leftArm.rotation.x = swing * 0.6; rightArm.rotation.x = -swing * 0.6; leftLeg.rotation.x = -swing * 0.8; rightLeg.rotation.x = swing * 0.8; leftLeg.children[1].rotation.x = swing > 0 ? swing * 0.5 : 0; rightLeg.children[1].rotation.x = swing < 0 ? -swing * 0.5 : 0; robot.position.y = Math.abs(Math.cos(frame * speed * 2)) * 0.08; torso.rotation.x = 0.1; head.rotation.y = Math.sin(frame * 0.05) * 0.2; 
        } else if (state.status === 'WORKING') { 
            const progress = Math.min(1, state.workTimer / 30); const squat = Math.sin(progress * Math.PI); robot.position.y = -squat * 0.3; torso.rotation.x = squat * 0.5; leftArm.rotation.x = -squat * 1.5; rightArm.rotation.x = -squat * 1.5; head.rotation.y = Math.sin(frame * 0.5); 
        } else if (state.status === 'CHARGING') {
            robot.position.y = 0; head.rotation.x = -0.5; leftArm.rotation.z = 0.5; rightArm.rotation.z = -0.5; robot.position.y = Math.sin(frame * 0.2) * 0.05;
        } else { 
            const breath = Math.sin(frame * 0.05) * 0.05; leftArm.rotation.x = THREE.MathUtils.lerp(leftArm.rotation.x, 0, 0.1); rightArm.rotation.x = THREE.MathUtils.lerp(rightArm.rotation.x, 0, 0.1); leftLeg.rotation.x = THREE.MathUtils.lerp(leftLeg.rotation.x, 0, 0.1); rightLeg.rotation.x = THREE.MathUtils.lerp(rightLeg.rotation.x, 0, 0.1); leftLeg.children[1].rotation.x = 0; rightLeg.children[1].rotation.x = 0; torso.rotation.x = 0; leftArm.rotation.z = 0.1 + breath * 0.1; rightArm.rotation.z = -0.1 - breath * 0.1; robot.position.y = 0; head.rotation.y = Math.sin(frame * 0.02) * 0.5; head.rotation.x = 0; 
        }
        
        const rays = 32; const linePos: number[] = []; const range = settings.sensorRange || 5; const headPos = state.pos.clone().add(new THREE.Vector3(0, 1.4, 0)); 
        if (state.status !== 'CHARGING' && state.status !== 'DEAD') {
            for(let i=0; i<rays; i++) { const angle = (i / rays) * Math.PI * 2 + frame * 0.05 + state.angle + head.rotation.y; const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)); let hitDist = range; for(let d=0.5; d<range; d+=0.5) { const checkX = state.pos.x + dir.x * d; const checkZ = state.pos.z + dir.z * d; const gx = Math.floor(checkX + offset); const gz = Math.floor(checkZ + offset); if (gx>=0 && gx<GRID && gz>=0 && gz<GRID) { if (gridRef.current[gz*GRID + gx] === 1) { hitDist = d; break; } } } if (Math.random()*50 < settings.sensorNoise) hitDist *= (0.8 + Math.random()*0.4); const end = headPos.clone().add(dir.multiplyScalar(hitDist)); end.y = Math.max(0, end.y - hitDist * 0.2); linePos.push(headPos.x, headPos.y, headPos.z); linePos.push(end.x, end.y, end.z); }
        }
        if (lidarLinesRef.current) lidarLinesRef.current.geometry.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
        
        if (targetRef.current) { 
            if (state.status === 'CHARGING' || state.status === 'RETURNING' || state.status === 'DEAD') { targetRef.current.visible = false; }
            else if (state.status !== 'IDLE' && (state.status === 'MOVING' || state.status === 'WORKING')) { targetRef.current.visible = true; targetRef.current.position.set(state.target.x, 0.5, state.target.z); targetRef.current.rotation.y += 0.05; } else { targetRef.current.visible = false; } 
        }

        if (frame === 1 || frame % 30 === 0) {
             onUpdateMetrics([ 
                 { label: 'Battery', value: state.battery.toFixed(0), unit: '%', status: state.status === 'DEAD' || state.battery < 20 ? 'critical' : 'good' }, 
                 { label: 'Status', value: state.status, status: state.status === 'DEAD' ? 'critical' : (state.status === 'BLOCKED' || state.status === 'RETURNING' ? 'warning' : state.status === 'CHARGING' ? 'good' : 'neutral') }, 
                 { label: 'Task', value: state.status === 'WORKING' ? 'EXECUTING' : (state.status === 'CHARGING' ? 'RECHARGING' : (state.status === 'DEAD' ? 'SYSTEM FAIL' : 'SEARCHING')), status: 'neutral' } 
             ]);
        }
    };
    const onClick = (s:THREE.Scene, c:THREE.Camera, m:THREE.Vector2, r:THREE.Raycaster) => {
        if (stateRef.current.status === 'DEAD') return;
        r.setFromCamera(m, c); const tool = activeToolRef.current; const offset = GRID/2; let idx = -1;
        if (planeRef.current) { const ints = r.intersectObject(planeRef.current); if (ints.length > 0) { const pt = ints[0].point; const gx = Math.floor(pt.x + offset); const gz = Math.floor(pt.z + offset); if (gx >= 0 && gx < GRID && gz >= 0 && gz < GRID) { idx = gz * GRID + gx; } if (clickMarkerRef.current) { clickMarkerRef.current.position.set(pt.x, 0.6, pt.z); clickMarkerRef.current.scale.set(1, 1, 1); (clickMarkerRef.current.material as THREE.MeshBasicMaterial).opacity = 1.0; clickMarkerRef.current.visible = true; } } }
        if (idx !== -1 && idx !== 0) { 
             const x = (idx % GRID) - offset + 0.5; const z = Math.floor(idx / GRID) - offset + 0.5; 
             if (tool === 'target') { 
                 const tgt = new THREE.Vector3(x, 0, z); 
                 const path = findPath(stateRef.current.pos, tgt); 
                 if (path) {
                    stateRef.current.target.copy(tgt); stateRef.current.path = path; stateRef.current.pathIdx = 0; stateRef.current.status = 'MOVING'; stateRef.current.workTimer = 0; autoTaskTimer.current = -99999; stateRef.current.isGoingToCharge = false; 
                    if (targetRef.current) { targetRef.current.position.set(x, 0.5, z); targetRef.current.visible = true; } 
                 } else { stateRef.current.status = 'BLOCKED'; }
             } else if (tool === 'wall') { gridRef.current[idx] = 1; } else if (tool === 'clear') { gridRef.current[idx] = 0; } 
        }
    };

    const handleReboot = () => {
        stateRef.current.battery = 100; stateRef.current.status = 'IDLE'; stateRef.current.isGoingToCharge = false; isDeadRef.current = false; setIsDead(false); autoTaskTimer.current = 0;
    };

    const mount = useThreeSim(init, animate, onClick, active, zoom);
    
    return (
        <div className="relative w-full h-full">
            <div ref={mount} className="w-full h-full" />
            
            {isDead && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-slate-950 border border-red-500/50 p-8 rounded-2xl shadow-2xl flex flex-col items-center text-center max-w-sm mx-4 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent"></div>
                        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mb-6 ring-1 ring-red-500/40 animate-pulse">
                            <BatteryWarning className="text-red-500 w-8 h-8" />
                        </div>
                        <h2 className="text-2xl font-bold text-red-500 tracking-widest mb-2">SYSTEM FAILURE</h2>
                        <p className="text-slate-400 text-sm mb-8 leading-relaxed">
                            Critical power loss detected. Autonomous core has shut down to prevent hardware damage.
                        </p>
                        <button onClick={handleReboot} className="group relative px-6 py-3 bg-red-600 hover:bg-red-500 text-white font-bold tracking-wider uppercase text-xs rounded-lg transition-all duration-200 shadow-[0_0_20px_rgba(220,38,38,0.4)] hover:shadow-[0_0_30px_rgba(220,38,38,0.6)] flex items-center gap-3">
                            <RotateCcw size={16} className="group-hover:rotate-180 transition-transform duration-500" />
                            Reboot System
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
});


import React, { useRef } from 'react';
import * as THREE from 'three';
import { useThreeSim } from '../../hooks/useThreeSim';
import { SimProps } from '../../types';

const MAT = {
    road: new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.5 }), // Lighter asphalt (Slate-600)
    line: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    stopLine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    walk: new THREE.MeshBasicMaterial({ color: 0xe2e8f0 }),
    grass: new THREE.MeshStandardMaterial({ color: 0x86efac }), // Bright sunny grass (Green-300)
    pole: new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.2, metalness: 0.8 }),
};

export const AutonomySim: React.FC<SimProps> = React.memo(({ settings, active, zoom, onUpdateMetrics }) => {
    // State Tracking
    const carsRef = useRef<{
        id: number,
        pos: THREE.Vector3, 
        vel: number, 
        acc: number, 
        dir: number, // 0=N, 1=S, 2=E, 3=W
        axis: string, 
        dist: number, // Distance from center (starts positive, goes negative)
        crashed: boolean,
        remove: boolean, // New flag for cleanup
        braking: boolean,
        color: THREE.Color, 
        model: THREE.Group | null,
        box: THREE.Box3 // For precise physics
    }[]>([]);
    
    const lightsRef = useRef<'red'|'green'>('red');
    const timerRef = useRef(0);
    const lightMeshRef = useRef<THREE.Group>(null);
    const carGroupRef = useRef<THREE.Group>(null);
    const collisionCountRef = useRef(0);
    
    // Enhanced Particle System
    const particlesRef = useRef<{
        pos: THREE.Vector3, 
        vel: THREE.Vector3, 
        life: number, 
        maxLife: number,
        type: 'fire'|'smoke'|'flash'|'debris'|'shockwave',
        scale: number,
        rot?: THREE.Vector3 
    }[]>([]);
    
    const particleMeshRef = useRef<THREE.InstancedMesh>(null); // Fire
    const smokeMeshRef = useRef<THREE.InstancedMesh>(null);   // Smoke
    const flashMeshRef = useRef<THREE.InstancedMesh>(null);   // Impact Flash
    const debrisMeshRef = useRef<THREE.InstancedMesh>(null);  // Flying parts
    const shockwaveMeshRef = useRef<THREE.InstancedMesh>(null); // Ground Ring
    
    // Constants
    const LANE_OFFSET = 2.0;
    const CAR_LENGTH = 2.2;
    const CAR_WIDTH = 1.1;
    const CAR_HEIGHT = 0.8;
    const STOP_LINE = 6.0;

    const init = (scene: THREE.Scene) => {
        const roadW = 8;
        const groundSize = 100;

        // Environment
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), MAT.grass); 
        ground.rotation.x = -Math.PI/2; ground.position.y = -0.15; ground.receiveShadow = true; scene.add(ground);
        
        // Roads
        const roadH = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, roadW), MAT.road); roadH.rotation.x = -Math.PI/2; roadH.receiveShadow = true; scene.add(roadH);
        const roadV = new THREE.Mesh(new THREE.PlaneGeometry(roadW, groundSize), MAT.road); roadV.rotation.x = -Math.PI/2; roadV.position.y = 0.01; roadV.receiveShadow = true; scene.add(roadV);
        
        // Markings
        const markings = new THREE.Group();
        // Center Lines (Dashed)
        const dashGeo = new THREE.PlaneGeometry(1, 0.15);
        for(let i=10; i<45; i+=2) {
             const d1 = new THREE.Mesh(dashGeo, MAT.line); d1.rotation.x = -Math.PI/2; d1.position.set(i, 0.02, 0); markings.add(d1);
             const d2 = new THREE.Mesh(dashGeo, MAT.line); d2.rotation.x = -Math.PI/2; d2.position.set(-i, 0.02, 0); markings.add(d2);
             const d3 = new THREE.Mesh(dashGeo, MAT.line); d3.rotation.x = -Math.PI/2; d3.rotation.z = Math.PI/2; d3.position.set(0, 0.02, i); markings.add(d3);
             const d4 = new THREE.Mesh(dashGeo, MAT.line); d4.rotation.x = -Math.PI/2; d4.rotation.z = Math.PI/2; d4.position.set(0, 0.02, -i); markings.add(d4);
        }
        // Stop Lines
        const stopGeo = new THREE.PlaneGeometry(0.6, 3.8);
        const s1 = new THREE.Mesh(stopGeo, MAT.stopLine); s1.rotation.x = -Math.PI/2; s1.position.set(-STOP_LINE, 0.02, LANE_OFFSET); markings.add(s1);
        const s2 = new THREE.Mesh(stopGeo, MAT.stopLine); s2.rotation.x = -Math.PI/2; s2.position.set(STOP_LINE, 0.02, -LANE_OFFSET); markings.add(s2);
        const s3 = new THREE.Mesh(stopGeo, MAT.stopLine); s3.rotation.x = -Math.PI/2; s3.rotation.z = Math.PI/2; s3.position.set(-LANE_OFFSET, 0.02, -STOP_LINE); markings.add(s3);
        const s4 = new THREE.Mesh(stopGeo, MAT.stopLine); s4.rotation.x = -Math.PI/2; s4.rotation.z = Math.PI/2; s4.position.set(LANE_OFFSET, 0.02, STOP_LINE); markings.add(s4);
        
        // Crosswalks
        const walkGeo = new THREE.PlaneGeometry(0.5, 3.8);
        for(let i=0; i<3; i++) {
            const offset = 4.5 + (i*0.8);
            const w1 = new THREE.Mesh(walkGeo, MAT.walk); w1.rotation.x = -Math.PI/2; w1.position.set(-offset, 0.02, -LANE_OFFSET); markings.add(w1);
            const w2 = new THREE.Mesh(walkGeo, MAT.walk); w2.rotation.x = -Math.PI/2; w2.position.set(offset, 0.02, LANE_OFFSET); markings.add(w2);
            const w3 = new THREE.Mesh(walkGeo, MAT.walk); w3.rotation.x = -Math.PI/2; w3.rotation.z = Math.PI/2; w3.position.set(LANE_OFFSET, 0.02, -offset); markings.add(w3);
            const w4 = new THREE.Mesh(walkGeo, MAT.walk); w4.rotation.x = -Math.PI/2; w4.rotation.z = Math.PI/2; w4.position.set(-LANE_OFFSET, 0.02, offset); markings.add(w4);
        }

        scene.add(markings);

        // Lights & Poles
        const lightsGroup = new THREE.Group();
        const poleGeo = new THREE.CylinderGeometry(0.1, 0.15, 5);
        const armGeo = new THREE.BoxGeometry(3.5, 0.15, 0.15);
        // Larger Signal Box that glows entirely
        const signalBoxGeo = new THREE.BoxGeometry(0.8, 1.5, 0.6);
        
        const createLight = (x: number, z: number, rot: number) => {
            const grp = new THREE.Group();
            grp.position.set(x, 0, z);
            grp.rotation.y = rot;
            
            // Pole
            const p = new THREE.Mesh(poleGeo, MAT.pole); 
            p.position.y = 2.5; 
            p.castShadow = true; 
            grp.add(p);
            
            // Arm
            const a = new THREE.Mesh(armGeo, MAT.pole); 
            a.position.set(1.0, 4.8, 0); 
            grp.add(a);
            
            // Signal Head - The main visual indicator
            const sig = new THREE.Mesh(signalBoxGeo, new THREE.MeshStandardMaterial({ 
                color: 0x333333, 
                emissive: 0x000000,
                roughness: 0.2
            }));
            sig.position.set(2.5, 4.6, 0);
            sig.name = "signalHead";
            grp.add(sig);

            // Add a point light to the signal so it illuminates the road
            const lamp = new THREE.PointLight(0x000000, 2, 10);
            lamp.position.set(2.5, 4.0, 0);
            lamp.name = "signalLight";
            grp.add(lamp);
            
            return grp;
        };

        // Positioning lights at corners
        lightsGroup.add(createLight(6, 6, -Math.PI/2));  // NE
        lightsGroup.add(createLight(-6, 6, Math.PI));    // NW
        lightsGroup.add(createLight(-6, -6, Math.PI/2)); // SW
        lightsGroup.add(createLight(6, -6, 0));          // SE
        
        scene.add(lightsGroup);
        // @ts-ignore
        lightMeshRef.current = lightsGroup;

        // Cars Container
        const carGroup = new THREE.Group();
        scene.add(carGroup);
        // @ts-ignore
        carGroupRef.current = carGroup;
        
        // --- Particle Systems for Explosions ---
        
        // 1. Fire (Dodecahedrons) - Additive Blending for Glow
        const pGeo = new THREE.DodecahedronGeometry(0.8); 
        const pMat = new THREE.MeshBasicMaterial({ 
            color: 0xff4500, // OrangeRed
            transparent: true, 
            opacity: 0.6, // Very Subtle
            blending: THREE.AdditiveBlending,
            depthWrite: false
        }); 
        const pMesh = new THREE.InstancedMesh(pGeo, pMat, 2000);
        pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        pMesh.frustumCulled = false;
        scene.add(pMesh);
        // @ts-ignore
        particleMeshRef.current = pMesh;

        // 2. Smoke (Spheres)
        const sGeo = new THREE.IcosahedronGeometry(1.0, 1);
        const sMat = new THREE.MeshBasicMaterial({ 
            color: 0x888888, 
            transparent: true, 
            opacity: 0.3, // Very Subtle
            depthWrite: false
        });
        const sMesh = new THREE.InstancedMesh(sGeo, sMat, 2000);
        sMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        sMesh.frustumCulled = false;
        scene.add(sMesh);
        // @ts-ignore
        smokeMeshRef.current = sMesh;

        // 3. Debris (Chunks)
        const dGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
        const dMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.8 });
        const dMesh = new THREE.InstancedMesh(dGeo, dMat, 500);
        dMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        dMesh.frustumCulled = false;
        scene.add(dMesh);
        // @ts-ignore
        debrisMeshRef.current = dMesh;

        // 4. Flash (Big Sphere)
        const fGeo = new THREE.SphereGeometry(1.0, 16, 16);
        const fMat = new THREE.MeshBasicMaterial({ 
            color: 0xffffff, 
            transparent: true, 
            opacity: 0.4, // Very Subtle
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const fMesh = new THREE.InstancedMesh(fGeo, fMat, 50);
        fMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        fMesh.frustumCulled = false;
        scene.add(fMesh);
        // @ts-ignore
        flashMeshRef.current = fMesh;

        // 5. Shockwave (Ring)
        const swGeo = new THREE.RingGeometry(0.5, 1.0, 32);
        const swMat = new THREE.MeshBasicMaterial({
            color: 0xffaa00,
            transparent: true,
            opacity: 0.2, // Very Subtle
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const swMesh = new THREE.InstancedMesh(swGeo, swMat, 50);
        swMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        swMesh.frustumCulled = false;
        scene.add(swMesh);
        // @ts-ignore
        shockwaveMeshRef.current = swMesh;

        carsRef.current = [];
        particlesRef.current = [];
        collisionCountRef.current = 0;
    };

    const createCarModel = (color: THREE.Color) => {
        const car = new THREE.Group();
        // Chassis
        const chassis = new THREE.Mesh(new THREE.BoxGeometry(CAR_WIDTH, 0.6, CAR_LENGTH), new THREE.MeshStandardMaterial({ color: color, roughness: 0.2, metalness: 0.4 }));
        chassis.position.y = 0.5; chassis.castShadow = true;
        car.add(chassis);
        
        // Cabin
        const cabin = new THREE.Mesh(new THREE.BoxGeometry(CAR_WIDTH - 0.1, 0.5, 1.3), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.1, metalness: 0.8 }));
        cabin.position.set(0, 1.0, -0.1);
        car.add(cabin);

        // Brake Lights
        const brakeGeo = new THREE.PlaneGeometry(0.4, 0.2);
        const brakeMat = new THREE.MeshBasicMaterial({ color: 0x330000 }); // Off state
        const bl = new THREE.Mesh(brakeGeo, brakeMat.clone()); bl.position.set(0.3, 0.6, CAR_LENGTH/2 + 0.01); bl.name = 'brakeRight'; car.add(bl);
        const br = new THREE.Mesh(brakeGeo, brakeMat.clone()); br.position.set(-0.3, 0.6, CAR_LENGTH/2 + 0.01); br.name = 'brakeLeft'; car.add(br);
        
        // Headlights
        const headGeo = new THREE.PlaneGeometry(0.3, 0.2);
        const headMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
        const hl = new THREE.Mesh(headGeo, headMat); hl.position.set(0.35, 0.5, -CAR_LENGTH/2 - 0.01); hl.rotation.y = Math.PI; car.add(hl);
        const hr = new THREE.Mesh(headGeo, headMat); hr.position.set(-0.35, 0.5, -CAR_LENGTH/2 - 0.01); hr.rotation.y = Math.PI; car.add(hr);

        // Wheels
        const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 16);
        wheelGeo.rotateZ(Math.PI / 2);
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a });
        const positions = [ { x: 0.55, z: 0.7 }, { x: 0.55, z: -0.7 }, { x: -0.55, z: 0.7 }, { x: -0.55, z: -0.7 } ];
        positions.forEach(p => { const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(p.x, 0.35, p.z); car.add(w); });
        
        return car;
    };

    const spawnCar = () => {
        const dir = Math.floor(Math.random()*4); 
        const pos = new THREE.Vector3(); 
        const SPAWN_DIST = 45;
        
        if (dir===0) { pos.set(-LANE_OFFSET, 0, -SPAWN_DIST); } 
        if (dir===1) { pos.set(LANE_OFFSET, 0, SPAWN_DIST); } 
        if (dir===2) { pos.set(-SPAWN_DIST, 0, LANE_OFFSET); } 
        if (dir===3) { pos.set(SPAWN_DIST, 0, -LANE_OFFSET); }

        // Start with realistic highway speed entrance
        const initSpeed = (settings.speedLimit / 250); 

        carsRef.current.push({ 
            id: Math.random(),
            pos, 
            vel: initSpeed, 
            acc: 0,
            dir, 
            axis: dir < 2 ? 'NS' : 'EW', 
            dist: SPAWN_DIST, 
            crashed: false,
            remove: false,
            braking: false,
            color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5), 
            model: null,
            box: new THREE.Box3()
        });
    };

    const animate = (scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, frame: number) => {
        if (!lightMeshRef.current || !carGroupRef.current) return;
        
        // --- Traffic Light Logic ---
        timerRef.current++; 
        const greenDuration = settings.greenLightDuration * 60;
        const yellowDuration = 90; 
        
        if (timerRef.current > greenDuration + yellowDuration) { 
            lightsRef.current = lightsRef.current === 'red' ? 'green' : 'red'; 
            timerRef.current = 0; 
        }

        const isYellow = timerRef.current > greenDuration;

        // Visual Colors
        const GREEN_COLOR = 0x22c55e;
        const RED_COLOR = 0xef4444;
        const YELLOW_COLOR = 0xeab308;

        const nsColor = lightsRef.current === 'green' ? (isYellow ? YELLOW_COLOR : GREEN_COLOR) : RED_COLOR;
        const ewColor = lightsRef.current === 'red' ? GREEN_COLOR : RED_COLOR; // Simplified 
        
        const updateSignal = (idx: number, col: number) => {
             const grp = lightMeshRef.current!.children[idx] as THREE.Group;
             const mesh = grp.getObjectByName('signalHead') as THREE.Mesh;
             const light = grp.getObjectByName('signalLight') as THREE.PointLight;
             if(mesh) {
                 (mesh.material as THREE.MeshStandardMaterial).color.setHex(col);
                 (mesh.material as THREE.MeshStandardMaterial).emissive.setHex(col);
             }
             if(light) light.color.setHex(col);
        };
        
        // NS Green -> Light 1 and 3 are Green.
        // EW Green -> Light 0 and 2 are Green.

        updateSignal(1, nsColor); updateSignal(3, nsColor); // North/South Lights
        updateSignal(0, ewColor); updateSignal(2, ewColor); // East/West Lights

        // --- Car Physics & Logic ---
        // Convert settings to Physics Constants
        const frictionCoeff = 0.05 + (settings.roadFriction / 100) * 0.25; 
        const maxSpeed = settings.speedLimit / 180; 
        const aggression = settings.driverAggression / 100;
        
        let activeCarsCount = 0;
        let avgSpeedSum = 0;

        // 1. Update Physics State
        carsRef.current.forEach(c => {
            if (c.crashed || c.remove) return; 

            // A. Environmental Awareness
            let targetDist = 999;
            const distToStopLine = c.dist - STOP_LINE - (CAR_LENGTH/2); 
            const isNS = c.dir < 2;
            const isGreen = isNS ? lightsRef.current === 'green' : lightsRef.current === 'red';
            
            // Check Stop Lights
            if (distToStopLine > 0 && distToStopLine < 40) { 
                 if (!isGreen && !isYellow) { 
                     // Red Light
                     if (distToStopLine < 5 && c.vel > maxSpeed * 0.8 && aggression > 0.8) {
                         // Run red light
                     } else {
                         targetDist = distToStopLine;
                     }
                 } else if (isYellow) {
                     if (distToStopLine > 10 || aggression < 0.3) {
                        targetDist = distToStopLine;
                     }
                 }
            }

            // Check Car Ahead
            carsRef.current.forEach(other => {
                if (c === other || other.dir !== c.dir || other.remove) return;
                const gap = c.dist - other.dist - CAR_LENGTH * 1.5; 
                if (gap > 0 && gap < 50) {
                    if (gap < targetDist) targetDist = gap;
                }
            });

            // B. Physics Calc
            const requiredBrakingDist = (c.vel * c.vel) / (2 * frictionCoeff * 0.5); 
            
            if (targetDist < requiredBrakingDist + 1.0) {
                c.braking = true;
                c.acc = -frictionCoeff * (targetDist < 2 ? 1.0 : 0.5); 
            } else {
                c.braking = false;
                const speedRatio = c.vel / maxSpeed;
                if (speedRatio < 1.0) {
                    c.acc = 0.005 * (1 + aggression); 
                } else {
                    c.acc = 0; 
                }
            }

            c.vel += c.acc;
            if (c.vel < 0) c.vel = 0; 
            
            c.dist -= c.vel;
            
            if (c.dir === 0) c.pos.z = -c.dist;
            if (c.dir === 1) c.pos.z = c.dist;
            if (c.dir === 2) c.pos.x = -c.dist;
            if (c.dir === 3) c.pos.x = c.dist;
            
            const halfW = c.axis === 'NS' ? CAR_WIDTH/2 : CAR_LENGTH/2;
            const halfL = c.axis === 'NS' ? CAR_LENGTH/2 : CAR_WIDTH/2;
            c.box.min.set(c.pos.x - halfW + 0.1, 0, c.pos.z - halfL + 0.1);
            c.box.max.set(c.pos.x + halfW - 0.1, CAR_HEIGHT, c.pos.z + halfL - 0.1);

            avgSpeedSum += c.vel;
            
            if (c.dist < -55) {
                c.remove = true;
            }
        });

        // 2. Collision Detection
        for (let i = 0; i < carsRef.current.length; i++) {
            const c1 = carsRef.current[i];
            if (!c1.model || c1.crashed || c1.remove) continue;
            
            for (let j = i + 1; j < carsRef.current.length; j++) {
                const c2 = carsRef.current[j];
                if (!c2.model || c2.remove) continue; 

                if (c1.box.intersectsBox(c2.box)) {
                     c1.crashed = true; 
                     c2.crashed = true;
                     c1.remove = true; 
                     c2.remove = true; 
                     collisionCountRef.current++;
                     
                     // Use mid point and higher up for visibility
                     const mid = c1.pos.clone().add(c2.pos).multiplyScalar(0.5);
                     mid.y += 0.5; // Lower
                     spawnExplosion(mid);
                }
            }
        }

        // 3. Render Updates & Cleanup
        const survivingCars: typeof carsRef.current = [];
        
        carsRef.current.forEach(c => {
            if (c.remove) {
                if (c.model && carGroupRef.current) {
                    carGroupRef.current.remove(c.model);
                }
                return; 
            }

            if (!c.model && carGroupRef.current) {
                c.model = createCarModel(c.color);
                carGroupRef.current.add(c.model);
            }
            
            if (c.model) {
                c.model.position.copy(c.pos);
                if (c.dir === 0) c.model.rotation.y = Math.PI;
                if (c.dir === 1) c.model.rotation.y = 0;
                if (c.dir === 2) c.model.rotation.y = -Math.PI/2;
                if (c.dir === 3) c.model.rotation.y = Math.PI/2;
                
                const bl = c.model.getObjectByName('brakeLeft') as THREE.Mesh;
                const br = c.model.getObjectByName('brakeRight') as THREE.Mesh;
                if (bl && br) {
                    const bColor = c.braking ? 0xff0000 : 0x330000;
                    (bl.material as THREE.MeshBasicMaterial).color.setHex(bColor);
                    (br.material as THREE.MeshBasicMaterial).color.setHex(bColor);
                }
            }
            survivingCars.push(c);
            activeCarsCount++;
        });
        carsRef.current = survivingCars;

        // 4. Spawner
        const targetDensity = settings.trafficDensity; 
        if (activeCarsCount < targetDensity / 2) {
            if (Math.random() < 0.05) spawnCar();
        }

        // 5. Particles
        updateParticles();

        // 6. Metrics
        if (frame % 30 === 0) {
            const avgSpeed = activeCarsCount > 0 ? (avgSpeedSum / activeCarsCount) * 400 : 0;
            const nsStatus = lightsRef.current === 'green' ? (isYellow ? 'YEL' : 'GRN') : 'RED';
            const nsHealth = nsStatus === 'GRN' ? 'good' : (nsStatus === 'YEL' ? 'warning' : 'critical');
            
            const ewStatus = lightsRef.current === 'red' ? 'GRN' : 'RED'; // Simplified
            const ewHealth = ewStatus === 'GRN' ? 'good' : 'critical';

            onUpdateMetrics([
                { label: 'Vehicles', value: activeCarsCount, status: 'neutral' },
                { label: 'Avg Speed', value: Math.floor(avgSpeed), unit: 'km/h', status: avgSpeed < 20 ? 'warning' : 'neutral' },
                { label: 'Collisions', value: collisionCountRef.current, status: collisionCountRef.current > 0 ? 'critical' : 'good' },
                // Split Lights into 4
                { label: 'Light N', value: nsStatus, status: nsHealth },
                { label: 'Light S', value: nsStatus, status: nsHealth },
                { label: 'Light E', value: ewStatus, status: ewHealth },
                { label: 'Light W', value: ewStatus, status: ewHealth }
            ]);
        }
    };

    const spawnExplosion = (pos: THREE.Vector3) => {
        // Very subtle localized effects
        
        // 1. Tiny Fireball
        for(let i=0; i<8; i++) { 
            particlesRef.current.push({
                pos: pos.clone().add(new THREE.Vector3((Math.random()-0.5)*0.5, Math.random()*0.3, (Math.random()-0.5)*0.5)),
                vel: new THREE.Vector3((Math.random()-0.5)*0.1, 0.1 + Math.random()*0.2, (Math.random()-0.5)*0.1),
                life: 1.0 + Math.random() * 1.0, 
                maxLife: 2.0,
                type: 'fire',
                scale: 0.2 + Math.random() * 0.3
            });
        }
        
        // 2. Tiny Puff of Smoke
        for(let i=0; i<6; i++) {
            particlesRef.current.push({
                pos: pos.clone().add(new THREE.Vector3((Math.random()-0.5)*0.5, 0.5, (Math.random()-0.5)*0.5)),
                vel: new THREE.Vector3((Math.random()-0.5)*0.05, 0.2 + Math.random()*0.1, (Math.random()-0.5)*0.05),
                life: 2.0 + Math.random() * 2.0, 
                maxLife: 4.0,
                type: 'smoke',
                scale: 0.4 + Math.random() * 0.4
            });
        }
        
        // 3. Very Few Debris
        for(let i=0; i<4; i++) {
            particlesRef.current.push({
                pos: pos.clone(),
                vel: new THREE.Vector3((Math.random()-0.5)*1.5, 1.5 + Math.random()*1, (Math.random()-0.5)*1.5),
                rot: new THREE.Vector3(Math.random(), Math.random(), Math.random()),
                life: 2.0, 
                maxLife: 2.0,
                type: 'debris',
                scale: 0.1 + Math.random() * 0.1
            });
        }
        
        // 4. Faint Flash
        particlesRef.current.push({
            pos: pos.clone(),
            vel: new THREE.Vector3(0,0,0),
            life: 0.2, 
            maxLife: 0.2,
            type: 'flash',
            scale: 0.5
        });

        // 5. Subtle Shockwave
        particlesRef.current.push({
            pos: new THREE.Vector3(pos.x, 0.1, pos.z),
            vel: new THREE.Vector3(0,0,0),
            life: 0.5, 
            maxLife: 0.5,
            type: 'shockwave',
            scale: 0.1
        });
    };

    const updateParticles = () => {
        const dummy = new THREE.Object3D();
        const nextParticles: typeof particlesRef.current = [];
        
        let fireIdx = 0;
        let smokeIdx = 0;
        let debrisIdx = 0;
        let flashIdx = 0;
        let shockwaveIdx = 0;
        
        particlesRef.current.forEach(p => {
            p.life -= 0.02;
            p.pos.add(p.vel);
            
            if (p.type === 'fire') {
                p.vel.multiplyScalar(0.95); 
                p.vel.y += 0.002; 
                const scale = (p.life / p.maxLife) * p.scale;
                
                dummy.position.copy(p.pos);
                dummy.scale.setScalar(scale);
                dummy.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
                dummy.updateMatrix();
                
                if (particleMeshRef.current && fireIdx < 2000) {
                    particleMeshRef.current.setMatrixAt(fireIdx, dummy.matrix);
                    fireIdx++;
                }

            } else if (p.type === 'smoke') {
                p.vel.multiplyScalar(0.98); 
                p.vel.y += 0.002; 
                const lifeRatio = p.life / p.maxLife;
                const scale = p.scale * (1 + (1-lifeRatio)*0.5); 
                
                dummy.position.copy(p.pos);
                dummy.scale.setScalar(scale * Math.min(1, lifeRatio*4));
                dummy.updateMatrix();
                
                if (smokeMeshRef.current && smokeIdx < 2000) {
                    smokeMeshRef.current.setMatrixAt(smokeIdx++, dummy.matrix);
                }

            } else if (p.type === 'debris') {
                p.vel.y -= 0.1; // Stronger Gravity
                if (p.pos.y < 0.2) { 
                    p.pos.y = 0.2; 
                    p.vel.y *= -0.4; // Bounce
                    p.vel.x *= 0.6; p.vel.z *= 0.6; // Friction
                }
                
                if (p.rot) {
                    dummy.rotation.x += p.rot.x;
                    dummy.rotation.y += p.rot.y;
                }
                
                dummy.position.copy(p.pos);
                dummy.scale.setScalar(p.scale);
                dummy.updateMatrix();
                
                if (debrisMeshRef.current && debrisIdx < 500) {
                    debrisMeshRef.current.setMatrixAt(debrisIdx++, dummy.matrix);
                }

            } else if (p.type === 'flash') {
                p.scale += 0.1; // Slower expansion
                dummy.position.copy(p.pos);
                dummy.scale.setScalar(p.scale);
                dummy.updateMatrix();
                if (flashMeshRef.current && flashIdx < 50) {
                    flashMeshRef.current.setMatrixAt(flashIdx++, dummy.matrix);
                }
            } else if (p.type === 'shockwave') {
                p.scale += 0.05; // Very slow expansion
                dummy.position.copy(p.pos);
                dummy.scale.set(p.scale, p.scale, 1);
                dummy.rotation.x = -Math.PI/2;
                dummy.updateMatrix();
                if (shockwaveMeshRef.current && shockwaveIdx < 50) {
                    shockwaveMeshRef.current.setMatrixAt(shockwaveIdx++, dummy.matrix);
                }
            }

            if (p.life > 0) nextParticles.push(p);
        });
        particlesRef.current = nextParticles;

        const hide = (mesh: THREE.InstancedMesh | null, startIdx: number, max: number) => {
            if (!mesh) return;
            dummy.position.set(0, -500, 0); dummy.scale.set(0,0,0); dummy.updateMatrix();
            for(let i=startIdx; i<max; i++) mesh.setMatrixAt(i, dummy.matrix);
            mesh.instanceMatrix.needsUpdate = true;
        }

        hide(particleMeshRef.current, fireIdx, 2000);
        hide(smokeMeshRef.current, smokeIdx, 2000);
        hide(debrisMeshRef.current, debrisIdx, 500);
        hide(flashMeshRef.current, flashIdx, 50);
        hide(shockwaveMeshRef.current, shockwaveIdx, 50);
    };

    const onClick = () => {};
    const mount = useThreeSim(init, animate, onClick, active, zoom);
    return <div ref={mount} className="w-full h-full" />;
});

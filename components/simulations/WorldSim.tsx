
import React, { useRef } from 'react';
import * as THREE from 'three';
import { useThreeSim } from '../../hooks/useThreeSim';
import { SimProps } from '../../types';

const MAT = {
    base: new THREE.MeshStandardMaterial({ color: 0xffffff }), 
    person: new THREE.MeshStandardMaterial({ color: 0xffffff }), 
    head: new THREE.MeshStandardMaterial({ color: 0xffccaa }), // Default skin tone base
    hover: new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true, transparent: true, opacity: 0.5 })
};

export const WorldSim: React.FC<SimProps> = React.memo(({ settings, activeTool, active, zoom, onUpdateMetrics, onHover }) => {
    const SIZE = 50; 
    const MAX_PEOPLE = 4000; // Increased max people
    
    const gridRef = useRef<{type:number, level:number, value:number, happiness:number, safety: number, offset: number, popAnim: number}[]>([]);
    
    // Meshes
    const terrainMeshRef = useRef<THREE.InstancedMesh>(null);
    const buildingMeshRef = useRef<THREE.InstancedMesh>(null);
    const roofMeshRef = useRef<THREE.InstancedMesh>(null);
    const treeMeshRef = useRef<THREE.InstancedMesh>(null);
    const peopleMeshRef = useRef<THREE.InstancedMesh>(null);
    const headMeshRef = useRef<THREE.InstancedMesh>(null); // New head mesh
    
    const cursorRef = useRef<THREE.Mesh>(null);
    const peopleRef = useRef<{
        x: number, z: number, 
        tx: number, tz: number, 
        active: boolean, 
        speed: number, 
        color: THREE.Color,
        skinColor: THREE.Color,
        waddleOffset: number 
    }[]>([]);
    const planeRef = useRef<THREE.Mesh>(null);

    const init = (scene: THREE.Scene) => {
        if (gridRef.current.length === 0) {
             gridRef.current = Array(SIZE*SIZE).fill(0).map((_, i) => {
                 const x = (i % SIZE) - SIZE/2;
                 const z = Math.floor(i / SIZE) - SIZE/2;
                 const dist = Math.sqrt(x*x + z*z);
                 const noise = Math.sin(x*0.25) * Math.cos(z*0.25); 
                 
                 // River
                 if (Math.abs(x + Math.sin(z*0.2)*4) < 2.5) return { type: 4, level: 0, value: 50, happiness: 100, safety: 100, offset: Math.random(), popAnim: 0 };
                 
                 // Initial Town
                 if (dist < 12) {
                     if (dist < 4) return { type: 2, level: 2 + Math.random(), value: 80, happiness: 80, safety: 90, offset: Math.random(), popAnim: 1 };
                     if (dist < 9) if (Math.random() > 0.2) return { type: 1, level: 1 + Math.random(), value: 70, happiness: 80, safety: 90, offset: Math.random(), popAnim: 1 };
                     if (dist < 12 && x > 0) if (Math.random() > 0.4) return { type: 3, level: 1, value: 60, happiness: 60, safety: 70, offset: Math.random(), popAnim: 1 };
                 }
                 if (dist > 22 || noise > 0.6) return { type: 5, level: 1 + Math.random(), value: 60, happiness: 100, safety: 100, offset: Math.random(), popAnim: 1 };
                 return { type: 0, level: 0, value: 50, happiness: 50, safety: 50, offset: Math.random(), popAnim: 0 };
             });
        }

        const tGeo = new THREE.BoxGeometry(0.95, 0.1, 0.95); tGeo.translate(0, -0.05, 0);
        const tMesh = new THREE.InstancedMesh(tGeo, MAT.base, SIZE*SIZE); tMesh.receiveShadow = true; scene.add(tMesh);
        // @ts-ignore
        terrainMeshRef.current = tMesh;

        const bGeo = new THREE.BoxGeometry(0.8, 1, 0.8); bGeo.translate(0, 0.5, 0); 
        const bMesh = new THREE.InstancedMesh(bGeo, MAT.base, SIZE*SIZE); bMesh.castShadow = true; bMesh.receiveShadow = true; scene.add(bMesh);
        // @ts-ignore
        buildingMeshRef.current = bMesh;

        const rGeo = new THREE.ConeGeometry(0.6, 0.4, 4); rGeo.translate(0, 0.2, 0); rGeo.rotateY(Math.PI / 4); 
        const rMesh = new THREE.InstancedMesh(rGeo, new THREE.MeshStandardMaterial({ color: 0xaa4a44 }), SIZE*SIZE); rMesh.castShadow = true; scene.add(rMesh);
        // @ts-ignore
        roofMeshRef.current = rMesh;

        const treeGeo = new THREE.CylinderGeometry(0, 0.3, 0.8, 5); treeGeo.translate(0, 0.4, 0);
        const treeMesh = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ color: 0x15803d }), SIZE*SIZE); treeMesh.castShadow = true; scene.add(treeMesh);
        // @ts-ignore
        treeMeshRef.current = treeMesh;

        const planeMat = new THREE.MeshBasicMaterial({ visible: false }); 
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), planeMat); plane.rotation.x = -Math.PI/2; plane.visible = true; scene.add(plane);
        // @ts-ignore
        planeRef.current = plane;

        // People - Body
        const pGeo = new THREE.CapsuleGeometry(0.12, 0.4, 4, 8); pGeo.translate(0, 0.32, 0); 
        const pMesh = new THREE.InstancedMesh(pGeo, MAT.person, MAX_PEOPLE); 
        pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); 
        pMesh.castShadow = true;
        scene.add(pMesh);
        // @ts-ignore
        peopleMeshRef.current = pMesh;

        // People - Head
        const hGeo = new THREE.SphereGeometry(0.12, 8, 8); hGeo.translate(0, 0.65, 0);
        const hMesh = new THREE.InstancedMesh(hGeo, MAT.head, MAX_PEOPLE);
        hMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        hMesh.castShadow = true;
        scene.add(hMesh);
        // @ts-ignore
        headMeshRef.current = hMesh;
        
        const clothesColors = [ 
            new THREE.Color(0xf43f5e), new THREE.Color(0x3b82f6), new THREE.Color(0x10b981), 
            new THREE.Color(0xf59e0b), new THREE.Color(0x8b5cf6), new THREE.Color(0x14b8a6),
            new THREE.Color(0x0f172a), new THREE.Color(0xffffff), new THREE.Color(0xe11d48)
        ];
        const skinColors = [
            new THREE.Color(0xfadbc5), new THREE.Color(0xe0ac69), new THREE.Color(0x8d5524), 
            new THREE.Color(0xc68642), new THREE.Color(0xffccaa)
        ];

        if (peopleRef.current.length === 0) {
             peopleRef.current = Array(MAX_PEOPLE).fill(0).map(() => ({ 
                 x: 0, z: 0, tx: 0, tz: 0, active: false, 
                 speed: 0.05 + Math.random() * 0.1, 
                 color: clothesColors[Math.floor(Math.random() * clothesColors.length)],
                 skinColor: skinColors[Math.floor(Math.random() * skinColors.length)],
                 waddleOffset: Math.random() * 100
             }));
        }
        
        const cur = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 1), MAT.hover); cur.visible = false; scene.add(cur);
        // @ts-ignore
        cursorRef.current = cur;
    };

    const animate = (scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, frame: number, mouse: THREE.Vector2, raycaster: THREE.Raycaster) => {
        if (!terrainMeshRef.current) return;
        
        const tMesh = terrainMeshRef.current;
        const bMesh = buildingMeshRef.current;
        const rMesh = roofMeshRef.current;
        const trMesh = treeMeshRef.current;
        const pMesh = peopleMeshRef.current;
        const hMesh = headMeshRef.current;
        
        const dummy = new THREE.Object3D();
        const offset = SIZE/2;
        let totalPop = 0;
        let totalJobs = 0;
        let totalHappiness = 0;
        let totalValue = 0;
        let occupiedCells = 0;

        // Unpack Settings 
        const { taxRate, policeFunding, publicServices, indDemand, comDemand, growthSpeed, amenityDensity } = settings;
        
        const simSpeed = Math.max(0, growthSpeed / 50); 
        
        // Impact Calculations
        const taxVal = (20 - taxRate); // Lower tax = higher happiness
        const policeVal = (policeFunding - 50) * 0.3; 
        const serviceVal = (publicServices - 50) * 0.4;
        const amenityBoost = amenityDensity / 20;

        if (frame === 1 || frame % 2 === 0) {
            gridRef.current.forEach((cell, i) => {
                if (cell.type === 4) return; 
                if (cell.type > 0 && cell.popAnim < 1) cell.popAnim += 0.1;

                // Neighbor Logic 
                const nIndices = [i-1, i+1, i-SIZE, i+SIZE];
                let neighborValueBonus = 0;
                let happinessBonus = 0;
                let safetyBonus = 0;

                nIndices.forEach(n => { 
                    const nb = gridRef.current[n]; 
                    if (nb) { 
                        // Water and Parks boost value AND happiness
                        if (nb.type === 5 || nb.type === 4) {
                            neighborValueBonus += 5 * amenityBoost; 
                            happinessBonus += 2 * amenityBoost;
                        }
                        // Industry reduces neighbors happiness slightly
                        if (nb.type === 3) happinessBonus -= 3; 
                        // Commerce boosts neighbors value
                        if (nb.type === 2) neighborValueBonus += 2; 

                        if (nb.type > 0) safetyBonus += 1;
                    } 
                });
                
                // Happiness Calculation
                // Base 50 + Policies + Environment
                let happy = 50 + taxVal + policeVal + serviceVal + happinessBonus;
                happy = Math.max(0, Math.min(100, happy));
                cell.happiness = happy;

                let safety = 50 + policeVal + (safetyBonus * 2);
                cell.safety = Math.max(0, Math.min(100, safety));

                // Land Value Logic
                cell.value = 50 + neighborValueBonus + (happy * 0.5) + (cell.safety * 0.2);

                // Growth & Abandonment Logic
                const rnd = Math.random();
                const growthChance = 0.05 * simSpeed;
                
                // Demand Multipliers
                const iMult = indDemand / 50; 
                const cMult = comDemand / 50;

                // Growth
                if (cell.type === 1 && cell.value > 30 && rnd < growthChance) cell.level = Math.min(12, cell.level + 0.5);
                if (cell.type === 3 && cell.value > 20 && rnd < growthChance * iMult) cell.level = Math.min(6, cell.level + 0.5);
                if (cell.type === 2 && cell.value > 40 && rnd < growthChance * cMult) cell.level = Math.min(10, cell.level + 0.5);
                
                // Decay
                if (cell.type > 0 && cell.type !== 5) {
                    let decayChance = 0.01 * simSpeed;
                    if (cell.value < 10) decayChance += 0.1; 
                    if (cell.happiness < 20) decayChance += 0.05;
                    
                    if (rnd < decayChance) {
                        cell.level = Math.max(0.1, cell.level - 0.5);
                    }
                }

                if (cell.type === 1) { 
                    totalPop += Math.floor(cell.level * 100); 
                    occupiedCells++; 
                    totalHappiness += cell.happiness; 
                }
                if (cell.type === 3) totalJobs += Math.floor(cell.level * 50); 
                if (cell.type === 2) totalJobs += Math.floor(cell.level * 30); 
                
                if (cell.type > 0) totalValue += cell.value;
            });
        }

        // People Logic - Make them move and look busy
        // Base crowd + Population based crowd
        const targetPedestrians = Math.min(MAX_PEOPLE, Math.floor(totalPop) + 300); 
        
        if(pMesh && hMesh && peopleRef.current) {
             peopleRef.current.forEach((p, i) => {
                if (i > targetPedestrians) {
                    p.active = false;
                    dummy.position.set(0, -500, 0);
                    pMesh.setMatrixAt(i, dummy.matrix);
                    hMesh.setMatrixAt(i, dummy.matrix);
                } else if (!p.active) {
                    if (Math.random() < 0.1) { // Respawn
                        const resIndices = gridRef.current.map((c, idx) => c.type === 1 || c.type === 2 ? idx : -1).filter(idx => idx !== -1);
                        if (resIndices.length > 0) {
                            const startIdx = resIndices[Math.floor(Math.random() * resIndices.length)];
                            p.x = (startIdx % SIZE) - offset + 0.5;
                            p.z = Math.floor(startIdx / SIZE) - offset + 0.5;
                            // Pick random destination
                            p.tx = (Math.random()*SIZE) - offset;
                            p.tz = (Math.random()*SIZE) - offset;
                            p.active = true;
                        }
                    }
                    dummy.position.set(0, -500, 0); 
                    pMesh.setMatrixAt(i, dummy.matrix);
                    hMesh.setMatrixAt(i, dummy.matrix);
                } else {
                    const dx = p.tx - p.x; const dz = p.tz - p.z;
                    if (Math.abs(dx) > 0.1) p.x += Math.sign(dx) * p.speed; 
                    else if (Math.abs(dz) > 0.1) p.z += Math.sign(dz) * p.speed; 
                    else p.active = false; 
                    
                    // Waddle / Bob animation
                    const walkCycle = Math.sin((frame * 0.8) + p.waddleOffset);
                    const yPos = Math.abs(walkCycle) * 0.1;
                    const wobble = walkCycle * 0.1; // Rotate slightly left/right

                    dummy.position.set(p.x, yPos, p.z); 
                    dummy.rotation.set(0, 0, wobble);
                    dummy.scale.set(1, 1, 1); 
                    dummy.updateMatrix(); 
                    pMesh.setMatrixAt(i, dummy.matrix); 
                    pMesh.setColorAt(i, p.color);

                    // Head
                    dummy.rotation.set(0, 0, 0); // Keep head relatively steady
                    dummy.position.set(p.x, yPos, p.z);
                    dummy.updateMatrix();
                    hMesh.setMatrixAt(i, dummy.matrix);
                    hMesh.setColorAt(i, p.skinColor);
                }
            });
            pMesh.instanceMatrix.needsUpdate = true;
            if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
            hMesh.instanceMatrix.needsUpdate = true;
            if (hMesh.instanceColor) hMesh.instanceColor.needsUpdate = true;
        }


        gridRef.current.forEach((cell, i) => {
            const x = (i % SIZE) - offset + 0.5; const z = Math.floor(i / SIZE) - offset + 0.5;
            
            // TERRAIN
            dummy.position.set(x, 0, z); dummy.rotation.set(0,0,0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); tMesh.setMatrixAt(i, dummy.matrix);
            
            // Vibrant Colors
            let tileColor = new THREE.Color(0x86efac); // Vibrant Green-300 Base
            
            if (cell.type === 4) tileColor.setHex(0x0ea5e9); // Ocean Blue-500
            else if (cell.type === 5) tileColor.setHex(0x16a34a); // Deep Forest Green
            else if (cell.type !== 0) tileColor.setHex(0xf1f5f9); // Slate-100 Pavement for built areas

            // Highlight special conditions
            if (cell.happiness > 90 && cell.type > 0 && cell.type < 4) {
                tileColor.lerp(new THREE.Color(0xfde047), 0.3); // Gold tint
            } else if (cell.value < 20 && cell.type > 0 && cell.type < 4) {
                tileColor.lerp(new THREE.Color(0xfca5a5), 0.3); // Red tint
            }

            tMesh.setColorAt(i, tileColor);

            dummy.position.set(0, -500, 0); dummy.scale.set(0,0,0); dummy.updateMatrix();
            if (bMesh) bMesh.setMatrixAt(i, dummy.matrix); if (rMesh) rMesh.setMatrixAt(i, dummy.matrix); if (trMesh) trMesh.setMatrixAt(i, dummy.matrix);

            if (cell.type === 1) { 
                // Residential - White/Light aesthetic
                const height = Math.max(0.1, cell.level);
                dummy.position.set(x, 0.3 * height * cell.popAnim * 0.5, z); dummy.scale.set(1, height * 0.5 * cell.popAnim, 1); dummy.updateMatrix();
                if (bMesh) { bMesh.setMatrixAt(i, dummy.matrix); bMesh.setColorAt(i, new THREE.Color(0xffffff)); }
                dummy.position.set(x, (height * 0.5 * cell.popAnim) + 0.2, z); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
                if (rMesh) rMesh.setMatrixAt(i, dummy.matrix);
            } else if (cell.type === 2) { 
                // Commercial - Cyan/Blue glass aesthetic
                const height = Math.max(0.1, cell.level);
                dummy.position.set(x, 0.5 * height * cell.popAnim, z); dummy.scale.set(1, height * cell.popAnim, 1); dummy.updateMatrix();
                if (bMesh) { bMesh.setMatrixAt(i, dummy.matrix); bMesh.setColorAt(i, new THREE.Color(0x67e8f9)); }
            } else if (cell.type === 3) {
                // Industrial - Clean Orange/Gray
                const height = Math.max(0.1, cell.level);
                dummy.position.set(x, 0.25 * height * cell.popAnim, z); dummy.scale.set(1.1, height * 0.5 * cell.popAnim, 1.1); dummy.updateMatrix();
                if (bMesh) { bMesh.setMatrixAt(i, dummy.matrix); bMesh.setColorAt(i, new THREE.Color(0xfdba74)); }
            } else if (cell.type === 5) {
                // Forest
                dummy.position.set(x, 0.4 * cell.level, z); dummy.scale.set(1 + cell.offset, cell.level + cell.offset, 1 + cell.offset); dummy.updateMatrix();
                if (trMesh) trMesh.setMatrixAt(i, dummy.matrix);
            }
        });

        if (tMesh) { tMesh.instanceMatrix.needsUpdate = true; tMesh.instanceColor!.needsUpdate = true; }
        if (bMesh) { bMesh.instanceMatrix.needsUpdate = true; bMesh.instanceColor!.needsUpdate = true; }
        if (rMesh) rMesh.instanceMatrix.needsUpdate = true;
        if (trMesh) trMesh.instanceMatrix.needsUpdate = true;

        raycaster.setFromCamera(mouse, camera); let hoverIdx = -1;
        if (planeRef.current) { const ints = raycaster.intersectObject(planeRef.current); if (ints.length > 0) { const pt = ints[0].point; const gx = Math.floor(pt.x + offset); const gz = Math.floor(pt.z + offset); if (gx >= 0 && gx < SIZE && gz >= 0 && gz < SIZE) { hoverIdx = gz * SIZE + gx; } } }
        
        if (cursorRef.current && hoverIdx !== -1) {
            const x = (hoverIdx % SIZE) - offset + 0.5; const z = Math.floor(hoverIdx / SIZE) - offset + 0.5;
            cursorRef.current.position.set(x, 0.5, z); cursorRef.current.visible = true;
        } else if (cursorRef.current) { cursorRef.current.visible = false; }

        if (onHover && hoverIdx !== -1 && frame % 5 === 0) { 
            const c = gridRef.current[hoverIdx]; 
            const typeStr = ['Empty Lot', 'Residential', 'Commercial', 'Industrial', 'River', 'Forest'][c.type]; 
            onHover({ 
                x: mouse.x, y: mouse.y, visible: true, label: typeStr, 
                data: c.type > 0 && c.type !== 4 ? [
                    `Level: ${c.level.toFixed(1)}`, 
                    `Land Value: ${Math.floor(c.value)}`, 
                    `Happiness: ${Math.floor(c.happiness)}%`,
                    `Safety: ${Math.floor(c.safety)}%`
                ] : [] 
            }); 
        } else if (onHover && hoverIdx === -1) { onHover({x:0, y:0, visible:false, label:''}); }
        
        if (frame === 1 || frame % 30 === 0) {
            const avgHappiness = occupiedCells > 0 ? Math.floor(totalHappiness / occupiedCells) : 100;
            const avgValue = occupiedCells > 0 ? Math.floor(totalValue / occupiedCells) : 50;
            
            onUpdateMetrics([ 
                { label: 'Population', value: totalPop.toLocaleString(), status: totalPop > 2000 ? 'good' : 'neutral' }, 
                { label: 'Active Jobs', value: totalJobs.toLocaleString(), status: 'neutral' }, 
                { label: 'Pedestrians', value: peopleRef.current.filter(p => p.active).length, status: 'good' },
                { label: 'Happiness', value: avgHappiness, unit: '%', status: avgHappiness > 75 ? 'good' : avgHappiness < 40 ? 'critical' : 'neutral'},
                { label: 'Land Value', value: avgValue, unit: '$', status: avgValue > 80 ? 'good' : 'neutral'},
                { label: 'Safety', value: Math.floor(50 + (policeFunding-50)*0.5 + (avgHappiness*0.3)), unit: '%', status: 'neutral'}
            ]);
        }
    };

    const onClick = (s:THREE.Scene, c:THREE.Camera, m:THREE.Vector2, r:THREE.Raycaster) => {
        r.setFromCamera(m, c); let idx = -1; const offset = SIZE/2;
        if (planeRef.current) { const ints = r.intersectObject(planeRef.current); if (ints.length > 0) { const pt = ints[0].point; const gx = Math.floor(pt.x + offset); const gz = Math.floor(pt.z + offset); if (gx >= 0 && gx < SIZE && gz >= 0 && gz < SIZE) { idx = gz * SIZE + gx; } } }
        if (idx !== -1) { const cell = gridRef.current[idx]; if (cell.type === 4) return; let newType = cell.type; if (activeTool === 'res') newType = 1; else if (activeTool === 'com') newType = 2; else if (activeTool === 'ind') newType = 3; else if (activeTool === 'clear') newType = 0; if (newType !== cell.type) { gridRef.current[idx] = { type: newType, level: 1, value: 60, happiness: 50, safety: 60, offset: Math.random(), popAnim: 0 }; } }
    };

    const mount = useThreeSim(init, animate, onClick, active, zoom, 'orthographic');
    return <div ref={mount} className="w-full h-full" />;
});

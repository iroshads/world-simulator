
import React, { useRef } from 'react';
import * as THREE from 'three';
import { useThreeSim } from '../../hooks/useThreeSim';
import { SimProps } from '../../types';

// --- Materials ---
const MAT = {
    // Glassy, premium look for nodes
    nodeBlue: new THREE.MeshPhysicalMaterial({ 
        color: 0x0ea5e9, // Sky Blue
        metalness: 0.2, 
        roughness: 0.1, 
        transmission: 0.6, // Glass-like
        thickness: 1.5,
        emissive: 0x0284c7,
        emissiveIntensity: 0.4,
        clearcoat: 1.0
    }),
    nodeOrange: new THREE.MeshPhysicalMaterial({ 
        color: 0xf97316, // Orange
        metalness: 0.2, 
        roughness: 0.1, 
        transmission: 0.6,
        thickness: 1.5,
        emissive: 0xea580c,
        emissiveIntensity: 0.4,
        clearcoat: 1.0
    }),
    // Halo Ring for Influencers
    halo: new THREE.MeshBasicMaterial({ 
        color: 0xffffff, 
        transparent: true, 
        opacity: 0.15, 
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
    }),
    // Connections
    link: new THREE.LineBasicMaterial({ 
        color: 0x94a3b8, // Slate 400
        transparent: true, 
        opacity: 0.2, 
        blending: THREE.AdditiveBlending 
    }),
    // Particles
    particleGood: new THREE.MeshBasicMaterial({ color: 0x4ade80, blending: THREE.AdditiveBlending }), // Green
    particleBad: new THREE.MeshBasicMaterial({ color: 0xf43f5e, blending: THREE.AdditiveBlending })   // Red
};

export const SocialSim: React.FC<SimProps> = React.memo(({ settings, active, zoom, onUpdateMetrics, onHover }) => {
    const NODE_COUNT = 50;
    
    // Data Refs
    const nodesRef = useRef<{
        id: number,
        pos: THREE.Vector3,
        vel: THREE.Vector3,
        tribe: 'blue' | 'orange',
        influence: number, // Scale factor
        radius: number
    }[]>([]);

    const edgesRef = useRef<{a: number, b: number, type: 'agree'|'argue'}[]>([]);
    
    const particlesRef = useRef<{
        pos: THREE.Vector3,
        vel: THREE.Vector3,
        life: number,
        type: 'good'|'bad'
    }[]>([]);

    // Mesh Refs
    const blueMeshRef = useRef<THREE.InstancedMesh>(null);
    const orangeMeshRef = useRef<THREE.InstancedMesh>(null);
    const haloMeshRef = useRef<THREE.InstancedMesh>(null);
    
    const goodParticleMeshRef = useRef<THREE.InstancedMesh>(null);
    const badParticleMeshRef = useRef<THREE.InstancedMesh>(null);
    
    const lineGeoRef = useRef<THREE.BufferGeometry>(null);
    
    // Helpers
    const dummy = new THREE.Object3D();
    const targetVec = new THREE.Vector3(); 

    // We need to access current settings inside non-react callbacks if they aren't refreshed
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    const init = (scene: THREE.Scene) => {
        // Nodes (Spheres)
        const geo = new THREE.SphereGeometry(0.4, 32, 32);
        
        const bMesh = new THREE.InstancedMesh(geo, MAT.nodeBlue, NODE_COUNT);
        bMesh.castShadow = true; bMesh.receiveShadow = true;
        scene.add(bMesh);
        // @ts-ignore
        blueMeshRef.current = bMesh;

        const oMesh = new THREE.InstancedMesh(geo, MAT.nodeOrange, NODE_COUNT);
        oMesh.castShadow = true; oMesh.receiveShadow = true;
        scene.add(oMesh);
        // @ts-ignore
        orangeMeshRef.current = oMesh;

        // Influencer Halos (Rings)
        const ringGeo = new THREE.RingGeometry(0.6, 0.7, 32);
        const hMesh = new THREE.InstancedMesh(ringGeo, MAT.halo, NODE_COUNT);
        hMesh.rotation.x = -Math.PI/2; // Initial orientation
        scene.add(hMesh);
        // @ts-ignore
        haloMeshRef.current = hMesh;

        // Particles
        const pGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const gpMesh = new THREE.InstancedMesh(pGeo, MAT.particleGood, 200);
        gpMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(gpMesh);
        // @ts-ignore
        goodParticleMeshRef.current = gpMesh;

        const bpMesh = new THREE.InstancedMesh(pGeo, MAT.particleBad, 200);
        bpMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(bpMesh);
        // @ts-ignore
        badParticleMeshRef.current = bpMesh;

        // Edges
        const geometry = new THREE.BufferGeometry();
        // Max possible edges: NODE_COUNT * (NODE_COUNT-1) / 2
        const positions = new Float32Array(NODE_COUNT * NODE_COUNT * 3); 
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const lines = new THREE.LineSegments(geometry, MAT.link);
        lines.frustumCulled = false; // Always render lines
        scene.add(lines);
        // @ts-ignore
        lineGeoRef.current = geometry;

        // Interaction Plane
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({visible:false}));
        scene.add(plane);

        // Initialize Node Data
        nodesRef.current = [];
        for(let i=0; i<NODE_COUNT; i++) {
            const tribe = i < NODE_COUNT/2 ? 'blue' : 'orange';
            
            // Initial Cluster Separation
            const xOffset = tribe === 'blue' ? -6 : 6;
            const pos = new THREE.Vector3(
                xOffset + (Math.random()-0.5)*12, 
                (Math.random()-0.5)*12, 
                (Math.random()-0.5)*8
            );

            // Random Influence (Size)
            const influence = 1.0 + Math.pow(Math.random(), 3) * 2.0; // Skewed towards smaller, few big ones

            nodesRef.current.push({
                id: i,
                pos,
                vel: new THREE.Vector3(),
                tribe,
                influence,
                radius: 0.4 * influence
            });
        }
        recalculateEdges();
    };

    const recalculateEdges = () => {
        edgesRef.current = [];
        const nodes = nodesRef.current;
        const s = settingsRef.current;
        
        const density = s.connectionDensity || 40;
        const homophily = s.homophily || 70;
        
        // Base distance threshold modified by density
        const baseDist = 4 + (density / 10);

        for(let i=0; i<nodes.length; i++) {
            for(let j=i+1; j<nodes.length; j++) {
                const dist = nodes[i].pos.distanceTo(nodes[j].pos);
                const sameTribe = nodes[i].tribe === nodes[j].tribe;
                
                // Homophily Effect:
                // High homophily = easier to connect with same tribe, harder with different
                let threshold = baseDist;
                
                if (sameTribe) {
                    threshold += (homophily / 40); // Bonus range for same tribe
                } else {
                    threshold -= (homophily / 40); // Penalty range for diff tribe
                }

                if (dist < threshold) {
                    edgesRef.current.push({
                        a: i, b: j, 
                        type: sameTribe ? 'agree' : 'argue'
                    });
                }
            }
        }
    };

    const spawnParticles = (pos: THREE.Vector3, type: 'good'|'bad', count: number) => {
        for(let i=0; i<count; i++) {
            particlesRef.current.push({
                pos: pos.clone(),
                vel: new THREE.Vector3((Math.random()-0.5)*0.5, (Math.random()-0.5)*0.5, (Math.random()-0.5)*0.5),
                life: 1.0 + Math.random()*0.5,
                type
            });
        }
    };

    const animate = (scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, frame: number, mouse: THREE.Vector2, raycaster: THREE.Raycaster) => {
        const nodes = nodesRef.current;
        const edges = edgesRef.current;
        const s = settingsRef.current;
        
        // Parameter: Influence Strength (affects repulsion force)
        const influenceMult = (s.influenceStrength || 30) / 30; 
        
        // Parameter: Radicalization (pushes tribes apart)
        const radicalization = (s.radicalizationRate || 10) / 100;

        // --- 1. Physics Engine (Force Directed) ---
        
        // A. Repulsion
        for(let i=0; i<nodes.length; i++) {
            // Tribe Separation Force (Radicalization)
            if (nodes[i].tribe === 'blue') nodes[i].vel.x -= 0.01 * radicalization;
            else nodes[i].vel.x += 0.01 * radicalization;

            for(let j=i+1; j<nodes.length; j++) {
                const n1 = nodes[i]; const n2 = nodes[j];
                const d = n1.pos.clone().sub(n2.pos);
                let dist = d.length();
                if(dist === 0) { dist = 0.01; d.set(0.01, 0, 0); }

                const minDist = (n1.radius + n2.radius + 1.0) * influenceMult; 
                
                if(dist < minDist * 2) {
                    const forceStrength = 0.2 * (1 - (dist / (minDist * 2))) * influenceMult;
                    const force = d.normalize().multiplyScalar(forceStrength);
                    n1.vel.add(force);
                    n2.vel.sub(force);
                }
            }
            // Center Gravity (Keep them in frame)
            nodes[i].vel.sub(nodes[i].pos.clone().multiplyScalar(0.002));
        }

        // B. Spring Forces (Edges)
        edges.forEach(e => {
            const na = nodes[e.a];
            const nb = nodes[e.b];
            const diff = nb.pos.clone().sub(na.pos);
            const dist = diff.length();
            
            // "Homophily" also visualized here: Agreements pull tighter than Arguments
            const targetDist = e.type === 'agree' ? 3.0 : 6.0; 
            const strength = e.type === 'agree' ? 0.03 : 0.01;

            const force = diff.normalize().multiplyScalar((dist - targetDist) * strength);
            na.vel.add(force);
            nb.vel.sub(force);
            
            // Random Data Flow
            if(Math.random() < 0.003) {
                const mid = na.pos.clone().add(nb.pos).multiplyScalar(0.5);
                spawnParticles(mid, e.type === 'agree' ? 'good' : 'bad', 1);
            }
        });

        // --- 2. Update Positions & Meshes ---
        
        let bIdx = 0;
        let oIdx = 0;
        let hIdx = 0;

        // Hide all initially
        dummy.position.set(0,-1000,0); dummy.scale.set(0,0,0); dummy.updateMatrix();
        
        nodes.forEach(n => {
            n.vel.multiplyScalar(0.92); // Friction
            n.pos.add(n.vel);
            
            // Bounds check
            n.pos.clamp(new THREE.Vector3(-30,-20,-15), new THREE.Vector3(30,20,15));

            dummy.position.copy(n.pos);
            dummy.scale.setScalar(n.influence);
            dummy.rotation.set(0,0,0);
            dummy.updateMatrix();

            if (n.tribe === 'blue' && blueMeshRef.current) {
                blueMeshRef.current.setMatrixAt(bIdx++, dummy.matrix);
            } else if (n.tribe === 'orange' && orangeMeshRef.current) {
                orangeMeshRef.current.setMatrixAt(oIdx++, dummy.matrix);
            }

            // Halo for influencers
            if (n.influence > 1.8 && haloMeshRef.current) {
                dummy.scale.setScalar(n.influence * 1.5);
                // Slowly rotate halo
                dummy.rotation.set(frame * 0.01 + n.id, frame * 0.01, 0); 
                dummy.updateMatrix();
                haloMeshRef.current.setMatrixAt(hIdx++, dummy.matrix);
            }
        });

        // Cleanup unused instances
        if (blueMeshRef.current) {
             for(let i=bIdx; i<NODE_COUNT; i++) blueMeshRef.current.setMatrixAt(i, new THREE.Matrix4().makeScale(0,0,0));
             blueMeshRef.current.instanceMatrix.needsUpdate = true;
        }
        if (orangeMeshRef.current) {
             for(let i=oIdx; i<NODE_COUNT; i++) orangeMeshRef.current.setMatrixAt(i, new THREE.Matrix4().makeScale(0,0,0));
             orangeMeshRef.current.instanceMatrix.needsUpdate = true;
        }
        if (haloMeshRef.current) {
             for(let i=hIdx; i<NODE_COUNT; i++) haloMeshRef.current.setMatrixAt(i, new THREE.Matrix4().makeScale(0,0,0));
             haloMeshRef.current.instanceMatrix.needsUpdate = true;
        }

        // --- 3. Update Lines ---
        if (lineGeoRef.current) {
            const positions = (lineGeoRef.current.attributes.position as THREE.BufferAttribute).array as Float32Array;
            let idx = 0;
            edges.forEach(e => {
                const na = nodes[e.a];
                const nb = nodes[e.b];
                positions[idx++] = na.pos.x; positions[idx++] = na.pos.y; positions[idx++] = na.pos.z;
                positions[idx++] = nb.pos.x; positions[idx++] = nb.pos.y; positions[idx++] = nb.pos.z;
            });
            // Zero out rest
            for(let i=idx; i<positions.length; i++) positions[i] = 0;
            lineGeoRef.current.attributes.position.needsUpdate = true;
            
            // Periodically rewire based on settings and movement
            if (frame % 30 === 0) recalculateEdges();
        }

        // --- 4. Update Particles ---
        const nextParticles: typeof particlesRef.current = [];
        let gP = 0;
        let bP = 0;

        particlesRef.current.forEach(p => {
            p.life -= 0.02;
            p.pos.add(p.vel);
            
            if (p.life > 0) {
                dummy.position.copy(p.pos);
                const scale = Math.sin(p.life * Math.PI) * 1.5; // Pulse size
                dummy.scale.setScalar(scale);
                dummy.updateMatrix();

                if (p.type === 'good' && goodParticleMeshRef.current) {
                    goodParticleMeshRef.current.setMatrixAt(gP++, dummy.matrix);
                } else if (p.type === 'bad' && badParticleMeshRef.current) {
                    badParticleMeshRef.current.setMatrixAt(bP++, dummy.matrix);
                }
                nextParticles.push(p);
            }
        });
        particlesRef.current = nextParticles;

        // Cleanup particles
        if (goodParticleMeshRef.current) {
            for(let i=gP; i<200; i++) goodParticleMeshRef.current.setMatrixAt(i, new THREE.Matrix4().makeScale(0,0,0));
            goodParticleMeshRef.current.instanceMatrix.needsUpdate = true;
        }
        if (badParticleMeshRef.current) {
            for(let i=bP; i<200; i++) badParticleMeshRef.current.setMatrixAt(i, new THREE.Matrix4().makeScale(0,0,0));
            badParticleMeshRef.current.instanceMatrix.needsUpdate = true;
        }

        // --- 5. Hover & Metrics ---
        if (onHover && frame % 5 === 0) {
            const checkIntersects = (mesh: THREE.InstancedMesh, tribe: string) => {
                const intersects = raycaster.intersectObject(mesh);
                if (intersects.length > 0) {
                    const pt = intersects[0].point;
                    let bestDist = 1.0;
                    let bestNode = null;
                    nodes.forEach(n => {
                        if (n.tribe === tribe) {
                            const d = n.pos.distanceTo(pt);
                            if (d < bestDist) { bestDist = d; bestNode = n; }
                        }
                    });
                    return bestNode;
                }
                return null;
            };

            const blueNode = blueMeshRef.current ? checkIntersects(blueMeshRef.current, 'blue') : null;
            const orangeNode = !blueNode && orangeMeshRef.current ? checkIntersects(orangeMeshRef.current, 'orange') : null;
            const node = blueNode || orangeNode;

            if (node) {
                onHover({
                    x: mouse.x, y: mouse.y, visible: true, 
                    label: node.tribe === 'blue' ? 'Blue Node' : 'Orange Node',
                    data: [
                        `Influence: ${(node.influence * 10).toFixed(1)}`,
                        node.influence > 1.8 ? 'Status: INFLUENCER' : 'Status: USER'
                    ]
                });
            } else {
                onHover({x:0, y:0, visible: false, label: ''});
            }
        }

        if (frame % 30 === 0) {
            const blueCount = nodes.filter(n => n.tribe === 'blue').length;
            const orangeCount = nodes.length - blueCount;
            // Echo chamber definition depends on homophily and radicalization
            const echoChamber = s.homophily > 60 && s.radicalizationRate > 50 && edges.filter(e => e.type === 'argue').length < 5;
            
            onUpdateMetrics([
                { label: 'Blue Team', value: blueCount, status: blueCount > orangeCount ? 'good' : 'neutral' },
                { label: 'Orange Team', value: orangeCount, status: orangeCount > blueCount ? 'good' : 'neutral' },
                { label: 'Signals', value: particlesRef.current.length * 42, unit: '/m', status: 'good' },
                { label: 'Echo Chambers', value: echoChamber ? 'Formed' : 'None', status: echoChamber ? 'critical' : 'good' }
            ]);
        }
    };

    const onClick = (s:THREE.Scene, c:THREE.Camera, m:THREE.Vector2, r:THREE.Raycaster) => {
        // Simplified click check: closest node to ray
        r.setFromCamera(m, c);
        const nodes = nodesRef.current;
        let closest = null;
        let minDist = 1.5; // Click radius
        
        // Parameter: Openness (Chance to convert)
        const openness = settingsRef.current.openness || 20;

        nodes.forEach(n => {
            r.ray.closestPointToPoint(n.pos, targetVec);
            const d = targetVec.distanceTo(n.pos);
            if (d < minDist) {
                const distToCam = n.pos.distanceTo(c.position);
                if (distToCam < 100) { 
                    minDist = d;
                    closest = n;
                }
            }
        });

        if (closest) {
            const node = closest as typeof nodesRef.current[0];
            
            // VIRAL EXPLOSION
            spawnParticles(node.pos, 'good', 12);
            spawnParticles(node.pos, 'bad', 8);

            // Shockwave Physics
            nodes.forEach(n => {
                const d = n.pos.distanceTo(node.pos);
                if(d < 12 && d > 0.1) {
                    const push = n.pos.clone().sub(node.pos).normalize().multiplyScalar(4.0 / d);
                    n.vel.add(push);
                }
            });

            // Convert Neighbors?
            edgesRef.current.forEach(e => {
                if (nodes[e.a] === node || nodes[e.b] === node) {
                    const other = nodes[e.a] === node ? nodes[e.b] : nodes[e.a];
                    
                    // Openness determines if neighbors are swayed
                    if (Math.random() < (openness / 100)) {
                        other.tribe = node.tribe;
                        // Visual feedback for conversion
                        spawnParticles(other.pos, 'good', 5);
                    }
                }
            });
        }
    };

    const mount = useThreeSim(init, animate, onClick, active, zoom, 'perspective');
    return (
        <div className="relative w-full h-full">
            <div ref={mount} className="w-full h-full" />
            <div className="absolute bottom-4 left-4 pointer-events-none opacity-60 text-[10px] text-slate-400 font-mono bg-slate-900/50 backdrop-blur px-2 py-1 rounded border border-slate-700">
                CLICK NODE TO TRIGGER SIGNAL BURST
            </div>
        </div>
    );
});

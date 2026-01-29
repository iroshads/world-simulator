
import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const useThreeSim = (
    init: (scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer) => void,
    animate: (scene: THREE.Scene, camera: THREE.Camera, renderer: THREE.WebGLRenderer, frame: number, mouse: THREE.Vector2, raycaster: THREE.Raycaster) => void,
    onClick: (scene: THREE.Scene, camera: THREE.Camera, mouse: THREE.Vector2, raycaster: THREE.Raycaster, button: number) => void,
    active: boolean,
    zoom: number = 1,
    cameraType: 'perspective' | 'orthographic' = 'perspective'
) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const contextRef = useRef<any>(null);
    
    const animateRef = useRef(animate);
    const onClickRef = useRef(onClick);
    const initRef = useRef(init);

    // Keep refs fresh without triggering re-initialization
    useEffect(() => {
        animateRef.current = animate;
        onClickRef.current = onClick;
        initRef.current = init;
    }, [animate, onClick, init]);

    // Handle Zoom Updates efficiently
    useEffect(() => {
        if (contextRef.current && contextRef.current.camera) {
            contextRef.current.camera.zoom = zoom;
            contextRef.current.camera.updateProjectionMatrix();
        }
    }, [zoom]);

    useEffect(() => {
        if (!active || !mountRef.current) return;

        // Cleanup previous instance if exists
        if (mountRef.current.children.length > 0) {
            mountRef.current.innerHTML = '';
        }

        const width = mountRef.current.clientWidth;
        const height = mountRef.current.clientHeight;

        const scene = new THREE.Scene();

        let camera;
        if (cameraType === 'orthographic') {
            const aspect = width / height;
            const D = 35; 
            camera = new THREE.OrthographicCamera(-D * aspect, D * aspect, D, -D, 1, 1000);
            camera.position.set(40, 40, 40);
            camera.zoom = zoom;
            camera.updateProjectionMatrix();
        } else {
            camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 1000);
            camera.position.set(20, 20, 20);
        }
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        mountRef.current.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.maxPolarAngle = Math.PI / 2 - 0.1;

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(-999, -999);

        // Lighting Setup
        const amb = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.9);
        scene.add(amb);
        const dir = new THREE.DirectionalLight(0xffffff, 2.0);
        dir.position.set(30, 50, 20);
        dir.castShadow = true;
        dir.shadow.mapSize.width = 2048;
        dir.shadow.mapSize.height = 2048;
        dir.shadow.camera.left = -50;
        dir.shadow.camera.right = 50;
        dir.shadow.camera.top = 50;
        dir.shadow.camera.bottom = -50;
        scene.add(dir);

        const spot = new THREE.SpotLight(0xffffff, 0.8);
        spot.position.set(-20, 50, -20);
        scene.add(spot);

        // Initialize Scene Content
        initRef.current(scene, camera, renderer);
        
        contextRef.current = { scene, camera, renderer, controls, raycaster, mouse, frame: 0 };

        let animationFrameId: number;

        const loop = () => {
            if (!contextRef.current) return;
            contextRef.current.frame++;
            contextRef.current.controls.update();
            
            animateRef.current(
                contextRef.current.scene, 
                contextRef.current.camera, 
                contextRef.current.renderer, 
                contextRef.current.frame, 
                contextRef.current.mouse, 
                contextRef.current.raycaster
            );
            
            renderer.render(scene, camera);
            animationFrameId = requestAnimationFrame(loop);
        };
        loop();

        const handleResize = () => {
            if (!mountRef.current) return;
            const w = mountRef.current.clientWidth;
            const h = mountRef.current.clientHeight;
            
            if (cameraType === 'perspective') {
                const cam = camera as THREE.PerspectiveCamera;
                cam.aspect = w/h;
                cam.updateProjectionMatrix();
            } else {
                 const cam = camera as THREE.OrthographicCamera;
                 const D = 35; const a = w/h;
                 cam.left = -D*a; cam.right = D*a;
                 cam.top = D; cam.bottom = -D;
                 cam.updateProjectionMatrix();
            }
            renderer.setSize(w, h);
        };

        const onMouseMove = (e: MouseEvent) => {
            const r = mountRef.current!.getBoundingClientRect();
            contextRef.current.mouse.x = ((e.clientX - r.left)/r.width)*2 - 1;
            contextRef.current.mouse.y = -((e.clientY - r.top)/r.height)*2 + 1;
        };

        const onMouseDown = (e: MouseEvent) => {
            onClickRef.current(scene, camera, contextRef.current.mouse, contextRef.current.raycaster, e.button);
        };

        window.addEventListener('resize', handleResize);
        mountRef.current.addEventListener('mousemove', onMouseMove);
        mountRef.current.addEventListener('mousedown', onMouseDown);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (mountRef.current) {
                mountRef.current.removeEventListener('mousemove', onMouseMove);
                mountRef.current.removeEventListener('mousedown', onMouseDown);
                mountRef.current.innerHTML = '';
            }
            cancelAnimationFrame(animationFrameId);
            contextRef.current = null;
        };
    }, [active, cameraType]); 

    return mountRef;
};

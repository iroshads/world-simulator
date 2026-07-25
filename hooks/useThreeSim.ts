import { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface SimContext {
    scene: THREE.Scene;
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    raycaster: THREE.Raycaster;
    mouse: THREE.Vector2;
    /** true while primary (left) button is held over the canvas */
    pointerDown: boolean;
    /** scaled sim time in seconds (respects timeScale, freezes on pause) */
    time: number;
    /** scaled frame counter (advances timeScale ticks per real frame) */
    frame: number;
    /** scaled delta seconds for this real frame */
    dt: number;
    /** raw wall-clock seconds — for UI-ish animations that run when paused */
    wallTime: number;
    lights: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight };
}

interface UseThreeSimOptions {
    init: (ctx: SimContext) => void;
    animate: (ctx: SimContext) => void;
    /** discrete click (fires on pointer-up if pointer didn't orbit) */
    onClick?: (ctx: SimContext, button: number) => void;
    /** fires every frame the primary button is held (for drag-painting) */
    onPaint?: (ctx: SimContext) => void;
    active: boolean;
    zoom: number;
    timeScale: number;
    cameraType?: 'perspective' | 'orthographic';
    cameraPos?: [number, number, number];
    /** orbit with LEFT button too (when no paint tool is active) */
    leftOrbits?: boolean;
    background?: number | null;
}

export const useThreeSim = (opts: UseThreeSimOptions) => {
    const mountRef = useRef<HTMLDivElement>(null);
    const ctxRef = useRef<SimContext | null>(null);

    const optsRef = useRef(opts);
    optsRef.current = opts;

    // zoom updates without re-init
    useEffect(() => {
        const ctx = ctxRef.current;
        if (ctx?.camera) {
            (ctx.camera as THREE.OrthographicCamera | THREE.PerspectiveCamera).zoom = opts.zoom;
            (ctx.camera as THREE.OrthographicCamera | THREE.PerspectiveCamera).updateProjectionMatrix();
        }
    }, [opts.zoom]);

    // left button behavior: paint vs orbit
    useEffect(() => {
        const ctx = ctxRef.current;
        if (ctx?.controls) {
            ctx.controls.mouseButtons = {
                LEFT: opts.leftOrbits ? THREE.MOUSE.ROTATE : (null as any),
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.ROTATE,
            };
        }
    }, [opts.leftOrbits, opts.active]);

    useEffect(() => {
        const mountEl = mountRef.current;
        if (!opts.active || !mountEl) return;
        mountEl.innerHTML = '';

        const width = mountEl.clientWidth || 800;
        const height = mountEl.clientHeight || 600;

        const scene = new THREE.Scene();
        const o = optsRef.current;
        if (o.background !== null) scene.background = new THREE.Color(o.background ?? 0x0b1120);

        const camType = o.cameraType ?? 'perspective';
        const camPos = o.cameraPos ?? [40, 40, 40];
        let camera: THREE.Camera;
        if (camType === 'orthographic') {
            const aspect = width / height;
            const D = 35;
            camera = new THREE.OrthographicCamera(-D * aspect, D * aspect, D, -D, -100, 1000);
        } else {
            camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 2000);
        }
        camera.position.set(...camPos);
        (camera as any).zoom = o.zoom;
        (camera as any).updateProjectionMatrix();
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        mountEl.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;
        controls.maxPolarAngle = Math.PI / 2 - 0.05;
        controls.minZoom = 0.4; controls.maxZoom = 6;
        controls.minDistance = 8; controls.maxDistance = 220;
        controls.mouseButtons = {
            LEFT: o.leftOrbits ? THREE.MOUSE.ROTATE : (null as any),
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE,
        };

        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2(-999, -999);

        // Lighting rig (sims may re-color / animate these for day-night)
        const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x283044, 0.9);
        scene.add(hemi);
        const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
        sun.position.set(35, 60, 25);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
        sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
        sun.shadow.bias = -0.0004;
        scene.add(sun);
        scene.add(sun.target);

        const ctx: SimContext = {
            scene, camera, renderer, controls, raycaster, mouse,
            pointerDown: false, time: 0, frame: 0, dt: 0, wallTime: 0,
            lights: { sun, hemi },
        };
        ctxRef.current = ctx;

        optsRef.current.init(ctx);

        let rafId = 0;
        let lastT = performance.now();
        let downPos = { x: 0, y: 0 };
        let moved = false;

        const loop = () => {
            const now = performance.now();
            let rawDt = (now - lastT) / 1000;
            lastT = now;
            if (rawDt > 0.1) rawDt = 0.1; // clamp tab-switch spikes

            const ts = optsRef.current.timeScale;
            ctx.wallTime += rawDt;
            ctx.dt = rawDt * ts;
            ctx.time += ctx.dt;
            ctx.frame += ts; // fractional "sim frames" — sims use Math.floor deltas or time

            controls.update();
            raycaster.setFromCamera(mouse, camera);

            if (ctx.pointerDown && optsRef.current.onPaint) optsRef.current.onPaint(ctx);
            optsRef.current.animate(ctx);

            renderer.render(scene, camera);
            rafId = requestAnimationFrame(loop);
        };
        loop();

        const setMouse = (e: PointerEvent) => {
            const r = mountEl.getBoundingClientRect();
            mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
            mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
        };

        const onPointerMove = (e: PointerEvent) => {
            setMouse(e);
            if (Math.abs(e.clientX - downPos.x) + Math.abs(e.clientY - downPos.y) > 6) moved = true;
        };
        const onPointerDown = (e: PointerEvent) => {
            setMouse(e);
            downPos = { x: e.clientX, y: e.clientY };
            moved = false;
            if (e.button === 0) ctx.pointerDown = true;
        };
        const onPointerUp = (e: PointerEvent) => {
            if (e.button === 0) {
                ctx.pointerDown = false;
                if (!moved && optsRef.current.onClick) {
                    raycaster.setFromCamera(mouse, camera);
                    optsRef.current.onClick(ctx, e.button);
                }
            }
        };
        const onPointerLeave = () => {
            ctx.pointerDown = false;
            mouse.set(-999, -999);
        };
        const onContextMenu = (e: Event) => e.preventDefault();

        const handleResize = () => {
            const w = mountEl.clientWidth, h = mountEl.clientHeight;
            if (!w || !h) return;
            if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
                (camera as THREE.PerspectiveCamera).aspect = w / h;
            } else {
                const cam = camera as THREE.OrthographicCamera;
                const D = 35, a = w / h;
                cam.left = -D * a; cam.right = D * a; cam.top = D; cam.bottom = -D;
            }
            (camera as any).updateProjectionMatrix();
            renderer.setSize(w, h);
        };
        const ro = new ResizeObserver(handleResize);
        ro.observe(mountEl);

        mountEl.addEventListener('pointermove', onPointerMove);
        mountEl.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointerup', onPointerUp);
        mountEl.addEventListener('pointerleave', onPointerLeave);
        mountEl.addEventListener('contextmenu', onContextMenu);

        return () => {
            cancelAnimationFrame(rafId);
            ro.disconnect();
            mountEl.removeEventListener('pointermove', onPointerMove);
            mountEl.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointerup', onPointerUp);
            mountEl.removeEventListener('pointerleave', onPointerLeave);
            mountEl.removeEventListener('contextmenu', onContextMenu);
            controls.dispose();
            renderer.dispose();
            scene.traverse((obj: any) => {
                if (obj.geometry) obj.geometry.dispose?.();
                if (obj.material) {
                    (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m: any) => m.dispose?.());
                }
            });
            mountEl.innerHTML = '';
            ctxRef.current = null;
        };
    }, [opts.active]);

    return mountRef;
};

'use client';
import { Suspense, useRef, useState } from 'react';
import { PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, Vignette, Noise, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode, BlendFunction } from 'postprocessing';
import * as THREE from 'three';
import Surroundings from './Surroundings';
import Logs from './Logs';
import Fire from './Fire';
import FireVolume from './FireVolume';
import { HeatHaze } from './HeatHaze';
import HandLog from './HandLog';
import HonourLogs from './HonourLogs';
import Labels from './Labels';
import { shared, setZoom } from '@/lib/bus';
import { useEffect } from 'react';
import { sceneNow } from '@/lib/clock';

function useZoomControls() {
  const { gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const wheel = (e) => {
      e.preventDefault();
      setZoom(shared.zoom * Math.exp(e.deltaY * 0.0012));
    };
    const touches = new Map();
    let pinch0 = 0;
    let zoom0 = 1;
    const dist = () => {
      const [a, b] = [...touches.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const down = (e) => {
      if (e.pointerType !== 'touch') return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        pinch0 = dist();
        zoom0 = shared.zoom;
        shared.pinching = true;
      }
    };
    const move = (e) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && pinch0 > 0) setZoom(zoom0 * (pinch0 / Math.max(10, dist())));
    };
    const up = (e) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) {
        pinch0 = 0;
        shared.pinching = false;
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [gl]);
}

function CameraRig() {
  const { camera, size } = useThree();
  useZoomControls();
  const zoomS = useRef(1);
  const spotS = useRef(0);
  const pointer = useRef(new THREE.Vector2());
  const look = useRef(new THREE.Vector3(0, 1.2, 0));
  useFrame((state, dt) => {
    pointer.current.lerp(state.pointer, 1 - Math.exp(-dt * 1.5));
    const t = sceneNow();
    const portrait = size.width / size.height < 0.9;
    const I = shared.intensity || 0;
    // during a leader's moment, ease in closer, then back out
    const sp = shared.spotlight;
    const spotK = sp ? Math.sin(Math.min(1, sp.t / 9) * Math.PI) : 0;
    spotS.current += (spotK - spotS.current) * (1 - Math.exp(-dt * 2));
    const zTarget = shared.zoom * (1 - 0.38 * spotS.current);
    zoomS.current += (zTarget - zoomS.current) * (1 - Math.exp(-dt * 3));
    const z = zoomS.current;
    const dist = ((portrait ? 13.5 : 10.2) - Math.min(I, 1.2) * 0.3) * z;
    const x = (Math.sin(t * 0.045) * 0.6 + pointer.current.x * 0.6) * Math.min(1, z);
    // closer = lower and looking at the flames; further = higher, more valley
    const y = 1.2 + 2.1 * z + Math.sin(t * 0.083) * 0.08 + pointer.current.y * 0.2;
    camera.position.lerp(new THREE.Vector3(x, y, dist), 1 - Math.exp(-dt * 4));
    look.current.set(0, 1.05 + 0.4 * Math.min(z, 1.2) + Math.min(I, 1.2) * 0.1 + spotS.current * 0.7, -2 * Math.min(1, z));
    camera.lookAt(look.current);
    const fov = portrait ? 60 : 42;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

export default function Scene({ quality = 'high', handActive, onThrow, mySeed }) {
  const hi = quality === 'high';
  const [dpr, setDpr] = useState(() => Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, hi ? 1.25 : 0.85));
  return (
    <Canvas
      flat
      shadows={false}
      dpr={dpr}
      camera={{ position: [0, 2.55, 10.2], fov: 42, near: 0.15, far: 12000 }}
      gl={{ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor('#04060a');
        scene.fog = new THREE.FogExp2('#070a12', 0.018);
      }}
    >
      <PerformanceMonitor onDecline={() => setDpr((d) => Math.max(0.6, d - 0.2))} flipflops={4} />
      <CameraRig />
      <Suspense fallback={null}>
        <Surroundings />
        <Logs />
        <HonourLogs />
        <Fire quality={quality} />
        <FireVolume quality={quality} />
        <HandLog active={handActive} onThrow={onThrow} seed={mySeed} />
        <Labels embersOfNames={false} />
      </Suspense>
      <EffectComposer multisampling={0} disableNormalPass>
        <HeatHaze />
        <Bloom mipmapBlur intensity={0.7} luminanceThreshold={0.75} luminanceSmoothing={0.2} radius={0.7} />
        <Vignette offset={0.28} darkness={0.78} />
        <Noise premultiply blendFunction={BlendFunction.ADD} opacity={0.18} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      </EffectComposer>
    </Canvas>
  );
}

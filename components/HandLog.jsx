'use client';
// The log in your hands. Drag it up toward the fire (or press the button) to lay it.
import { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { makeLogMaterial } from './logMaterial';
import { shared, on } from '@/lib/bus';

export default function HandLog({ active, onThrow, seed = 7 }) {
  const ref = useRef();
  const { camera, gl, size } = useThree();
  const mat = useMemo(() => {
    const m = makeLogMaterial({ instanced: false });
    m.userData.single = {
      aIgnite: { value: 1e9 },
      aSeed: { value: seed },
      aLen: { value: 0.8 },
      aRad: { value: 0.07 },
    };
    return m;
  }, [seed]);
  const st = useRef({ drag: false, ndc: new THREE.Vector2(0.12, -0.6), rest: new THREE.Vector2(0.12, -0.6), thrown: 0, appear: 0, vel: new THREE.Vector2() });

  useEffect(() => {
    const el = gl.domElement;
    const toNdc = (e) => {
      const r = el.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    const move = (e) => {
      const s = st.current;
      if (!s.drag) return;
      if (shared.pinching) {
        s.drag = false;
        return;
      }
      const n = toNdc(e);
      s.vel.copy(n).sub(s.ndc);
      s.ndc.copy(n);
    };
    const upH = () => {
      const s = st.current;
      if (!s.drag) return;
      s.drag = false;
      el.style.cursor = '';
      if (s.ndc.y > -0.38) doThrow();
    };
    el.addEventListener('pointermove', move);
    window.addEventListener('pointerup', upH);
    const off = on('throw-log', () => doThrow());
    return () => {
      el.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', upH);
      off();
    };
  }, [gl]);

  function doThrow() {
    const s = st.current;
    if (s.thrown || !ref.current) return;
    s.thrown = performance.now();
    shared.hand = { position: ref.current.position.clone(), quaternion: ref.current.quaternion.clone() };
    onThrow?.();
  }

  useEffect(() => {
    if (active) {
      st.current.thrown = 0;
      st.current.appear = performance.now();
      st.current.ndc.copy(st.current.rest);
    }
  }, [active]);

  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const s = st.current;
    g.visible = active && (!s.thrown || shared.hand !== null);
    if (!g.visible) return;
    const t = performance.now() / 1000;
    if (s.thrown) {
      // keep flying toward the fire until the pile takes over
      const p = g.position;
      const target = new THREE.Vector3(0, 1.2, 0);
      p.lerp(target, 1 - Math.exp(-dt * 2.2));
      p.y += dt * 0.6;
      g.rotateX(dt * 1.5);
      shared.hand = { position: p.clone(), quaternion: g.quaternion.clone() };
      return;
    }
    if (!s.drag) s.ndc.lerp(s.rest, 1 - Math.exp(-dt * 6));
    const appear = Math.min(1, (performance.now() - s.appear) / 900);
    const depth = 2.4;
    const v = new THREE.Vector3(s.ndc.x, s.ndc.y - (1 - easeOut(appear)) * 0.6, 0.5).unproject(camera);
    const dir = v.sub(camera.position).normalize();
    const pos = camera.position.clone().addScaledVector(dir, depth + Math.max(0, s.ndc.y + 0.6) * 1.2);
    pos.y += Math.sin(t * 1.6) * 0.012;
    g.position.copy(pos);
    // lie across the view, slight tilt, gentle sway
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.35 + Math.sin(t * 0.9) * 0.04 + s.vel.y * 2, -0.25, Math.PI / 2 - 0.32 + Math.sin(t * 0.7) * 0.05 - s.vel.x * 3),
    );
    q.premultiply(camera.quaternion);
    g.quaternion.slerp(q, 1 - Math.exp(-dt * 10));
    s.vel.multiplyScalar(Math.exp(-dt * 8));
  });

  return (
    <group>
      <mesh
        ref={ref}
        material={mat}
        scale={[0.066, 0.8, 0.066]}
        visible={false}
        onPointerDown={(e) => {
          e.stopPropagation();
          st.current.drag = true;
          gl.domElement.style.cursor = 'grabbing';
        }}
        onPointerOver={() => (gl.domElement.style.cursor = 'grab')}
        onPointerOut={() => !st.current.drag && (gl.domElement.style.cursor = '')}
      >
        <cylinderGeometry args={[1, 1, 1, 18, 12]} />
        {/* generous invisible grab area */}
        <mesh scale={[3.2, 1.15, 3.2]}>
          <cylinderGeometry args={[1, 1, 1, 8, 1]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </mesh>
      {/* a soft lantern-like fill so your log is readable in the dark */}
      <HandFill target={ref} active={active} />
    </group>
  );
}

function HandFill({ target, active }) {
  const l = useRef();
  useFrame(() => {
    if (!l.current || !target.current) return;
    l.current.intensity = active && target.current.visible ? 0.35 : 0;
    l.current.position.copy(target.current.position).add(new THREE.Vector3(0.4, 0.5, 0.6));
  });
  return <pointLight ref={l} color="#c9b08a" intensity={0} distance={2.5} decay={2} />;
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

'use client';
// The 5 leaders' honour logs: tall birch poles lashed with gold scout rope,
// forming the frame at the heart of the fire. Each one descends in a slow,
// golden "spotlight" moment when that leader lays it.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/lib/store';
import { sceneNow, toScene } from '@/lib/clock';
import { shared, emit } from '@/lib/bus';
import { makeLogMaterial } from './logMaterial';
import { playDrum, playThud } from '@/lib/audio';

export const SPOT_LEN = 9; // seconds the spotlight lasts
const LAND_AT = 5.2; // seconds into the spotlight when the log settles
const NEVER = 1e9;
const up = new THREE.Vector3(0, 1, 0);

// Five poles on a pentagon, meeting (and crossing) above the pile.
export const POLES = (() => {
  const apex = new THREE.Vector3(0, 2.75, 0);
  return [0, 1, 2, 3, 4].map((i) => {
    const a = Math.PI / 2 + Math.PI / 5 + (i * 2 * Math.PI) / 5;
    const base = new THREE.Vector3(Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55);
    const toApex = apex.clone().sub(base);
    const len = toApex.length() * 1.13;
    const dir = toApex.normalize();
    const radius = 0.078;
    const center = base.clone().addScaledVector(dir, len / 2);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    return { i, base, dir, len, radius, center, quat };
  });
})();

const goldMat = new THREE.MeshStandardMaterial({
  color: '#c9a24c',
  metalness: 0.55,
  roughness: 0.42,
  emissive: '#4a3008',
  emissiveIntensity: 0.7,
});

function Pole({ p, mat }) {
  return (
    <group>
      <mesh material={mat} scale={[p.radius, p.len, p.radius]}>
        <cylinderGeometry args={[1, 1, 1, 18, 14]} />
      </mesh>
      {/* gold rope lashing near the top */}
      {[0, 1, 2].map((k) => (
        <mesh key={k} material={goldMat} position={[0, p.len * 0.3 - k * 0.032, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[p.radius * 1.12, 0.014, 6, 20]} />
        </mesh>
      ))}
    </group>
  );
}

export default function HonourLogs() {
  const groups = useRef([]);
  const lashing = useRef();
  const mats = useMemo(
    () =>
      POLES.map((p) => {
        const m = makeLogMaterial({ instanced: false });
        m.userData.single = {
          aIgnite: { value: NEVER },
          aSeed: { value: 70 + p.i * 13 },
          aLen: { value: p.len },
          aRad: { value: p.radius },
          uBirch: { value: 1 },
          uSelfGlow: { value: 0 },
        };
        return m;
      }),
    [],
  );

  // golden ember trail
  const N = 260;
  const ember = useMemo(() => {
    const pos = new Float32Array(N * 3);
    const vel = new Float32Array(N * 3);
    const age = new Float32Array(N).fill(1);
    const life = new Float32Array(N).fill(1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAge', new THREE.BufferAttribute(age, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uPx: { value: 1 } },
      vertexShader: `attribute float aAge; uniform float uPx; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; vA = aAge;
        gl_PointSize = aAge >= 1.0 ? 0.0 : max(1.5, 60.0 * uPx / -mv.z * (1.0 - aAge * 0.7)); }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float c = 1.0 - smoothstep(0.0, 0.5, d); c *= c;
        gl_FragColor = vec4(vec3(1.0, 0.78, 0.35) * c * (1.0 - vA) * 2.2, 1.0); }`,
    });
    return { g, m, pos, vel, age, life, cur: 0 };
  }, []);

  const st = useRef({ landedFor: {}, drummedFor: {} });

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 20);
    const now = sceneNow();
    const s = useStore.getState();
    const ig = s.fire.ignite_at ? toScene(s.fire.ignite_at) : NEVER;
    ember.m.uniforms.uPx.value = state.gl.getPixelRatio() * (state.size.height / 800);
    const honour = [];
    let spot = null;
    let laidCount = 0;

    POLES.forEach((p, i) => {
      const g = groups.current[i];
      if (!g) return;
      const L = s.leaders.find((l) => l.slot === i);
      const laid = L && L.laid_at ? toScene(L.laid_at) : null;
      if (laid === null) {
        g.visible = false;
        return;
      }
      const t = now - laid;
      if (t >= 0 && t < SPOT_LEN) spot = { slot: i, t, name: L.name, title: L.title };
      // descent
      g.visible = t >= 0.8 || t < 0;
      if (t >= 0 && t < LAND_AT) {
        const u = Math.max(0, (t - 0.8) / (LAND_AT - 0.8));
        const e = 1 - Math.pow(1 - u, 3);
        const from = p.center.clone().add(new THREE.Vector3(0.8, 4.2, 2.4));
        g.position.lerpVectors(from, p.center, e);
        const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), (1 - e) * 1.2);
        g.quaternion.copy(p.quat).multiply(spin);
        if (u > 0) for (let k = 0; k < 3; k++) spawn(ember, g.position, 0.6);
        if (!st.current.drummedFor[L.laid_at]) {
          st.current.drummedFor[L.laid_at] = true;
          if (t < 2) playDrum();
        }
      } else {
        g.position.copy(p.center);
        g.quaternion.copy(p.quat);
        if (t >= LAND_AT && t < LAND_AT + 2.5 && Math.random() < 0.5) spawn(ember, p.center, 0.9);
        if (t >= LAND_AT && t < LAND_AT + 1 && !st.current.landedFor[L.laid_at]) {
          st.current.landedFor[L.laid_at] = true;
          playThud(1.2);
          emit('honour-landed', { at: p.base.clone().setY(0.6) });
        }
      }
      laidCount++;
      const landT = laid + LAND_AT;
      const ign = ig === NEVER ? NEVER : Math.max(ig + 0.35 + i * 0.22, landT + 1);
      mats[i].userData.single.aIgnite.value = ign;
      // a soft golden glow while the spotlight is on it
      const glow = t >= 0 && t < SPOT_LEN ? Math.sin(Math.min(1, t / SPOT_LEN) * Math.PI) * 0.22 : 0;
      mats[i].userData.single.uSelfGlow.value = glow;
      if (t >= LAND_AT || t < 0) honour.push({ ...p, ign });
    });

    if (lashing.current) lashing.current.visible = laidCount === 5;
    shared.honour = honour;
    shared.spotlight = spot;

    // update embers
    for (let i = 0; i < N; i++) {
      if (ember.age[i] >= 1) continue;
      ember.age[i] += dt / ember.life[i];
      const k = i * 3;
      ember.vel[k + 1] += 0.4 * dt;
      ember.pos[k] += ember.vel[k] * dt;
      ember.pos[k + 1] += ember.vel[k + 1] * dt;
      ember.pos[k + 2] += ember.vel[k + 2] * dt;
    }
    ember.g.attributes.position.needsUpdate = true;
    ember.g.attributes.aAge.needsUpdate = true;
  });

  return (
    <group>
      {POLES.map((p, i) => (
        <group key={i} ref={(el) => (groups.current[i] = el)} visible={false}>
          <Pole p={p} mat={mats[i]} />
        </group>
      ))}
      {/* rope binding where the five poles meet, once all five are in */}
      <group ref={lashing} visible={false} position={[0, 2.66, 0]}>
        {[0, 1, 2, 3].map((k) => (
          <mesh key={k} material={goldMat} position={[0, k * 0.035, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.15 - k * 0.012, 0.016, 6, 28]} />
          </mesh>
        ))}
      </group>
      <points geometry={ember.g} material={ember.m} frustumCulled={false} renderOrder={5} />
    </group>
  );
}

function spawn(E, at, spread) {
  for (let n = 0; n < E.age.length; n++) {
    const i = (E.cur + n) % E.age.length;
    if (E.age[i] < 1) continue;
    E.cur = (i + 1) % E.age.length;
    const k = i * 3;
    E.pos[k] = at.x + (Math.random() - 0.5) * spread;
    E.pos[k + 1] = at.y + (Math.random() - 0.5) * spread * 1.6;
    E.pos[k + 2] = at.z + (Math.random() - 0.5) * spread;
    E.vel[k] = (Math.random() - 0.5) * 0.4;
    E.vel[k + 1] = 0.2 + Math.random() * 0.5;
    E.vel[k + 2] = (Math.random() - 0.5) * 0.4;
    E.age[i] = 0;
    E.life[i] = 1.2 + Math.random() * 1.6;
    return;
  }
}

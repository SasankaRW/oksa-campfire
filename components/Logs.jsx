'use client';
import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/lib/store';
import { slotFor, kindling, igniteDelay, hash } from '@/lib/layout';
import { sceneNow, toScene } from '@/lib/clock';
import { emit, on, shared } from '@/lib/bus';
import { makeLogMaterial, logUniforms } from './logMaterial';
import { playThud } from '@/lib/audio';

const MAX = 560;
const NEVER = 1e9;
const slots = [];
const getSlot = (i) => slots[i] || (slots[i] = slotFor(i));

const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const spinQ = new THREE.Quaternion();
const axisX = new THREE.Vector3(1, 0, 0);
const up = new THREE.Vector3(0, 1, 0);

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}
function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Where someone "walks up" from with their log: the dark edge on the same
// side as the slot, carried at hip height.
function spawnFor(slot) {
  const a = Math.atan2(slot.base.z, slot.base.x) + (hash(slot.index + 2) - 0.5) * 0.6;
  const r = 4.2 + hash(slot.index + 4) * 1.2;
  const p = new THREE.Vector3(Math.cos(a) * r, 0.85, Math.sin(a) * r);
  const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
  const q = new THREE.Quaternion().setFromUnitVectors(up, tangent);
  return { p, q };
}

export function igniteTimeFor(i, landT) {
  const f = useStore.getState().fire;
  if (!f.ignite_at) return NEVER;
  const ig = toScene(f.ignite_at);
  const late = landT > -1e8 ? landT + 1.0 + hash(i + 11) * 1.5 : -NEVER;
  return Math.max(ig + igniteDelay(i), late);
}

export default function Logs() {
  const mesh = useRef();
  const kMesh = useRef();
  const material = useMemo(() => makeLogMaterial(), []);
  const geometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 14, 10, false);
    g.setAttribute('aIgnite', new THREE.InstancedBufferAttribute(new Float32Array(MAX).fill(NEVER), 1));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1));
    g.setAttribute('aLen', new THREE.InstancedBufferAttribute(new Float32Array(MAX).fill(1), 1));
    g.setAttribute('aRad', new THREE.InstancedBufferAttribute(new Float32Array(MAX).fill(0.06), 1));
    return g;
  }, []);

  const kind = useMemo(() => kindling(), []);
  const kGeometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(1, 1, 1, 6, 4, false);
    const n = kind.length;
    g.setAttribute('aIgnite', new THREE.InstancedBufferAttribute(new Float32Array(n).fill(NEVER), 1));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(Float32Array.from(kind.map((k) => k.seed)), 1));
    g.setAttribute('aLen', new THREE.InstancedBufferAttribute(Float32Array.from(kind.map((k) => k.len)), 1));
    g.setAttribute('aRad', new THREE.InstancedBufferAttribute(Float32Array.from(kind.map((k) => k.radius)), 1));
    return g;
  }, [kind]);

  const known = useRef(new Map());
  const initial = useRef(true);
  const highlight = useRef({ until: 0 });
  const kIgnFor = useRef(null);

  useEffect(() => {
    const m = kMesh.current;
    kind.forEach((k, i) => {
      tmpM.compose(k.position, k.quaternion, k.scale);
      m.setMatrixAt(i, tmpM);
    });
    m.instanceMatrix.needsUpdate = true;
    return on('focus-mine', () => (highlight.current.until = sceneNow() + 6));
  }, [kind]);

  useFrame(() => {
    const now = sceneNow();
    logUniforms.uTime.value = now;
    const st = useStore.getState();
    if (!st.ready) return;
    const logs = st.logs;
    const m = mesh.current;
    const aIgn = geometry.attributes.aIgnite.array;
    const aSeed = geometry.attributes.aSeed.array;
    const aLen = geometry.attributes.aLen.array;
    const aRad = geometry.attributes.aRad.array;
    const map = known.current;
    const firstLoad = initial.current;
    initial.current = false;

    // forget removed logs
    if (map.size > logs.length) {
      const ids = new Set(logs.map((l) => l.id));
      for (const id of map.keys()) if (!ids.has(id)) map.delete(id);
    }

    let mineIdx = -1;
    let matDirty = false;
    let ignDirty = false;
    let attrDirty = false;
    const n = Math.min(logs.length, MAX);
    for (let i = 0; i < n; i++) {
      const log = logs[i];
      const slot = getSlot(i);
      let s = map.get(log.id);
      const mine = log.device_id === st.deviceId;
      if (mine) mineIdx = i;
      if (!s) {
        if (firstLoad) {
          s = { idx: i, landed: true, landT: -NEVER };
        } else {
          const arr = st.arrivals[log.id] || (mine && shared.hand ? shared.hand : null);
          const from = arr
            ? { p: arr.position.clone(), q: arr.quaternion.clone() }
            : spawnFor(slot);
          s = {
            idx: i,
            landed: false,
            startT: Math.max(now, toScene(log.created_at)),
            from,
            dur: arr ? 1.15 : 1.7,
            arc: arr ? 0.9 : 0.75,
            spin: arr ? 0.6 : 1.4,
            mine,
            landT: -NEVER,
          };
          if (mine) shared.hand = null;
        }
        map.set(log.id, s);
      }
      if (s.idx !== i) {
        // order changed (rare): glide to the new slot
        tmpM.fromArray(m.instanceMatrix.array, s.idx * 16);
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        tmpM.decompose(p, q, tmpS);
        s.from = { p, q };
        s.startT = now;
        s.dur = 0.6;
        s.arc = 0.1;
        s.spin = 0;
        s.landed = false;
        s.quiet = true;
        s.idx = i;
        s.written = -1;
        s.wroteOnce = false;
      }

      if (!s.landed) {
        const u = (now - s.startT) / s.dur;
        if (u < 0) {
          tmpS.set(0, 0, 0);
          tmpM.compose(slot.position, slot.quaternion, tmpS);
        } else if (u >= 1) {
          s.landed = true;
          s.landT = now;
          tmpM.compose(slot.position, slot.quaternion, slot.scale);
          if (!s.quiet) {
            emit('landed', { index: i, log, mine: s.mine, top: slot.top, base: slot.base, center: slot.position });
            playThud(0.5 + Math.min(slot.ring, 6) * 0.05);
          }
          s.quiet = false;
        } else {
          const e = easeInOut(u);
          tmpP.lerpVectors(s.from.p, slot.position, e);
          tmpP.y += Math.sin(Math.PI * Math.min(1, u * 1.05)) * s.arc;
          tmpQ.slerpQuaternions(s.from.q, slot.quaternion, easeOut(u));
          spinQ.setFromAxisAngle(axisX, Math.sin(u * Math.PI) * s.spin);
          tmpQ.multiply(spinQ);
          tmpM.compose(tmpP, tmpQ, slot.scale);
        }
      } else if (s.written === i) {
        // resting log already in the buffer: nothing to do
      } else {
        // settle: a short damped wobble after landing
        const t = now - s.landT;
        if (t < 0.6 && t >= 0) {
          const w = Math.sin(t * 28) * Math.exp(-t * 7) * 0.05;
          spinQ.setFromAxisAngle(axisX, w);
          tmpQ.copy(slot.quaternion).multiply(spinQ);
          tmpP.copy(slot.position);
          tmpP.y += Math.abs(Math.sin(t * 14)) * Math.exp(-t * 9) * 0.05;
          tmpM.compose(tmpP, tmpQ, slot.scale);
        } else {
          tmpM.compose(slot.position, slot.quaternion, slot.scale);
          s.written = i;
        }
      }
      if (!(s.landed && s.written === i && s.wroteOnce)) {
        m.setMatrixAt(i, tmpM);
        matDirty = true;
        if (s.written === i) s.wroteOnce = true;
      }
      if (aSeed[i] !== slot.seed || aLen[i] !== slot.len) {
        aSeed[i] = slot.seed;
        aLen[i] = slot.len;
        aRad[i] = slot.radius;
        attrDirty = true;
      }
      const ign = s.landed || s.landT > -NEVER ? igniteTimeFor(i, s.landT) : NEVER;
      if (Math.abs(aIgn[i] - ign) > 0.001) {
        aIgn[i] = ign;
        ignDirty = true;
      }
    }
    if (m.count !== n) {
      m.count = n;
      matDirty = true;
    }
    // only upload what changed (saves a lot with hundreds of logs)
    if (matDirty) m.instanceMatrix.needsUpdate = true;
    if (ignDirty) geometry.attributes.aIgnite.needsUpdate = true;
    if (attrDirty) {
      geometry.attributes.aSeed.needsUpdate = true;
      geometry.attributes.aLen.needsUpdate = true;
      geometry.attributes.aRad.needsUpdate = true;
    }

    // kindling
    const f = st.fire;
    const kIgn = kGeometry.attributes.aIgnite.array;
    const ig = f.ignite_at ? toScene(f.ignite_at) : NEVER;
    if (kIgnFor.current !== ig) {
      kIgnFor.current = ig;
      for (let i = 0; i < kind.length; i++) kIgn[i] = ig === NEVER ? NEVER : ig + hash(i + 31) * 1.2;
      kGeometry.attributes.aIgnite.needsUpdate = true;
    }

    // ember glow is stronger once the fire dies down
    const target = f.mode === 'embers' ? 2.2 : 1.0;
    logUniforms.uGlow.value += (target - logUniforms.uGlow.value) * 0.01;

    // highlight your log on request
    logUniforms.uHighlight.value = mineIdx;
    const hl = highlight.current.until - now;
    logUniforms.uHighlightAmt.value = hl > 0 ? (0.5 + 0.5 * Math.sin(now * 5)) * Math.min(1, hl) : 0;

    // expose for the fire system
    shared.logState = { logs, n, map, getSlot, aIgn };
  });

  return (
    <group>
      <instancedMesh
        ref={mesh}
        args={[geometry, material, MAX]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
      <instancedMesh
        ref={kMesh}
        args={[kGeometry, material, kind.length]}
        castShadow
        frustumCulled={false}
        userData={{ kind }}
      />
    </group>
  );
}

export { getSlot };

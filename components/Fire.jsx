'use client';
import { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/lib/store';
import { sceneNow, toScene } from '@/lib/clock';
import { on, shared } from '@/lib/bus';
import { setFireLevel, playStrike, playWhoosh, playTwang } from '@/lib/audio';
import { pileRadius } from '@/lib/layout';

/* ---------------- shared noise texture (cheap fbm lookups) ---------------- */
let NOISE_TEX = null;
export function noiseTexture() {
  if (NOISE_TEX) return NOISE_TEX;
  const S = 128;
  const grid = (g) => {
    const a = new Float32Array(g * g);
    for (let i = 0; i < a.length; i++) a[i] = Math.random();
    return a;
  };
  const octs = [4, 8, 16, 32].map((g) => ({ g, v: grid(g) }));
  const data = new Uint8Array(S * S * 4);
  const sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let v = 0;
      let amp = 0.5;
      let tot = 0;
      for (const { g, v: arr } of octs) {
        const fx = (x / S) * g;
        const fy = (y / S) * g;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = sm(fx - x0);
        const ty = sm(fy - y0);
        const at = (i, j) => arr[((j + g) % g) * g + ((i + g) % g)];
        const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
        const b = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
        v += (a * (1 - ty) + b * ty) * amp;
        tot += amp;
        amp *= 0.5;
      }
      v /= tot;
      const i = (y * S + x) * 4;
      // R: fbm, G: offset fbm (for 2nd lookup), B/A unused
      data[i] = v * 255;
      data[i + 1] = (1 - v) * 255;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  NOISE_TEX = tex;
  return tex;
}

/* --------------------------------- shaders -------------------------------- */
const flameVert = /* glsl */ `
attribute vec3 iPos; attribute float iAge; attribute float iSize; attribute float iSeed; attribute float iHeat;
varying vec2 vUv; varying float vAge; varying float vSeed; varying float vHeat;
void main(){
  vUv = uv; vAge = iAge; vSeed = iSeed; vHeat = iHeat;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float grow = smoothstep(0.0, 0.2, iAge) * (1.0 - 0.55 * iAge);
  float s = iSize * (0.35 + 0.9 * grow);
  mv.xy += position.xy * vec2(s * 0.75, s * 1.55);
  mv.y += s * 0.45;
  gl_Position = projectionMatrix * mv;
  if (iAge >= 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const flameFrag = /* glsl */ `
uniform sampler2D uNoise; uniform float uTime; uniform float uBright;
varying vec2 vUv; varying float vAge; varying float vSeed; varying float vHeat;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float y01 = vUv.y;
  float n  = texture2D(uNoise, vec2(vUv.x * 0.45 + vSeed, vUv.y * 0.35 - uTime * 0.55 + vSeed * 1.7)).r;
  float n2 = texture2D(uNoise, vec2(vUv.x * 0.9 + vSeed * 2.3, vUv.y * 0.7 - uTime * 0.9)).r;
  p.x += (n - 0.5) * 1.1 * (0.25 + y01);
  float w = mix(1.0, 0.22, pow(y01, 0.9));
  float d = length(vec2(p.x / w, (p.y + 0.25) * 0.82));
  float body = 1.0 - smoothstep(0.3, 1.0, d);
  body *= smoothstep(0.25, 0.62, n2 + (1.0 - d) * 0.45 - y01 * 0.15);
  float fadeIn = smoothstep(0.0, 0.08, vAge);
  float fadeOut = 1.0 - smoothstep(0.45, 1.0, vAge);
  float edge = smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.8, vUv.y) * smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
  float a = body * fadeIn * fadeOut * edge;
  float heat = clamp(a * vHeat * (1.35 - vAge) + (1.0 - y01) * 0.2 * a, 0.0, 1.0);
  vec3 c = mix(vec3(0.30, 0.025, 0.0), vec3(1.0, 0.24, 0.02), smoothstep(0.0, 0.3, heat));
  c = mix(c, vec3(1.0, 0.55, 0.12), smoothstep(0.3, 0.65, heat));
  c = mix(c, vec3(1.0, 0.8, 0.45), smoothstep(0.75, 1.0, heat));
  gl_FragColor = vec4(c * a * uBright, 1.0);
}`;

const smokeFrag = /* glsl */ `
uniform sampler2D uNoise; uniform float uTime;
varying vec2 vUv; varying float vAge; varying float vSeed; varying float vHeat;
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float n = texture2D(uNoise, vUv * 0.6 + vec2(vSeed, vSeed * 0.7 - uTime * 0.03)).r;
  float d = length(p);
  float blob = (1.0 - smoothstep(0.2, 1.0, d)) * smoothstep(0.25, 0.7, n + (1.0 - d) * 0.3);
  float fade = smoothstep(0.0, 0.15, vAge) * (1.0 - smoothstep(0.5, 1.0, vAge));
  // vHeat: 0 = smoke, 1 = dust
  vec3 smoke = mix(vec3(0.22, 0.10, 0.045), vec3(0.04, 0.04, 0.045), smoothstep(0.0, 0.25, vAge));
  vec3 dust = vec3(0.16, 0.14, 0.12);
  vec3 c = mix(smoke, dust, vHeat);
  float alpha = blob * fade * mix(0.13, 0.12, vHeat);
  gl_FragColor = vec4(c, alpha);
}`;

const smokeVert = /* glsl */ `
attribute vec3 iPos; attribute float iAge; attribute float iSize; attribute float iSeed; attribute float iHeat;
varying vec2 vUv; varying float vAge; varying float vSeed; varying float vHeat;
void main(){
  vUv = uv; vAge = iAge; vSeed = iSeed; vHeat = iHeat;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float s = iSize * (0.5 + 1.2 * iAge);
  float r = iSeed * 6.28 + iAge * 0.8;
  vec2 q = mat2(cos(r), -sin(r), sin(r), cos(r)) * position.xy;
  mv.xy += q * s;
  gl_Position = projectionMatrix * mv;
  if (iAge >= 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const sparkVert = /* glsl */ `
attribute float aAge; attribute float aSize; attribute float aSeed;
uniform float uScale; uniform float uTime;
varying float vAge; varying float vFlick;
void main(){
  vAge = aAge;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vFlick = 0.55 + 0.45 * sin(uTime * (18.0 + aSeed * 25.0) + aSeed * 40.0);
  gl_PointSize = aAge >= 1.0 ? 0.0 : max(1.5, aSize * uScale / -mv.z * (1.0 - aAge * 0.6));
}`;
const sparkFrag = /* glsl */ `
varying float vAge; varying float vFlick;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float core = 1.0 - smoothstep(0.0, 0.5, d);
  core *= core;
  vec3 c = mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.85, 0.5), core);
  float a = core * (1.0 - smoothstep(0.6, 1.0, vAge)) * vFlick;
  gl_FragColor = vec4(c * a * 3.0, 1.0);
}`;

const emberVert = /* glsl */ `
varying vec2 vUv; varying vec3 vW;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const emberFrag = /* glsl */ `
uniform sampler2D uNoise; uniform float uTime; uniform float uHeat; uniform float uRadius; uniform float uLit;
varying vec2 vUv; varying vec3 vW;
void main(){
  float r = length(vW.xz) / uRadius;
  float n = texture2D(uNoise, vW.xz * 0.35).r;
  float n2 = texture2D(uNoise, vW.xz * 1.4 + vec2(uTime * 0.01)).r;
  float pulse = 0.6 + 0.4 * texture2D(uNoise, vW.xz * 0.5 + vec2(uTime * 0.05, 0.0)).r;
  float bed = 1.0 - smoothstep(0.25, 1.0, r + (n - 0.5) * 0.35);
  float coal = smoothstep(0.45, 0.72, n2) * bed;
  vec3 ash = mix(vec3(0.012, 0.011, 0.010), vec3(0.05, 0.047, 0.044), smoothstep(0.4, 0.8, n)) * (0.4 + uLit);
  vec3 glow = vec3(1.0, 0.25, 0.04) * coal * uHeat * pulse * 2.2 * (1.0 - smoothstep(0.0, 0.9, r));
  float a = smoothstep(1.0, 0.55, r + (n - 0.5) * 0.3);
  gl_FragColor = vec4(ash + glow, a * 0.92);
}`;

/* ------------------------------ particle pools ----------------------------- */
function makePool(n) {
  return {
    n,
    pos: new Float32Array(n * 3),
    vel: new Float32Array(n * 3),
    age: new Float32Array(n).fill(1),
    life: new Float32Array(n).fill(1),
    size: new Float32Array(n),
    seed: Float32Array.from({ length: n }, () => Math.random()),
    heat: new Float32Array(n),
    cursor: 0,
  };
}
function take(pool) {
  // find a dead particle starting from cursor
  for (let k = 0; k < pool.n; k++) {
    const i = (pool.cursor + k) % pool.n;
    if (pool.age[i] >= 1) {
      pool.cursor = (i + 1) % pool.n;
      return i;
    }
  }
  return -1;
}
function quadGeometry(pool) {
  const g = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  g.index = base.index;
  g.setAttribute('position', base.attributes.position);
  g.setAttribute('uv', base.attributes.uv);
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(pool.pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('iAge', new THREE.InstancedBufferAttribute(pool.age, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('iSize', new THREE.InstancedBufferAttribute(pool.size, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(pool.seed, 1));
  g.setAttribute('iHeat', new THREE.InstancedBufferAttribute(pool.heat, 1).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = pool.n;
  return g;
}
function markDirty(g) {
  g.attributes.iPos.needsUpdate = true;
  g.attributes.iAge.needsUpdate = true;
  g.attributes.iSize.needsUpdate = true;
  g.attributes.iHeat.needsUpdate = true;
}

const NEVER = 1e9;
const v3 = new THREE.Vector3();

export default function Fire({ quality = 'high' }) {
  const { size, gl } = useThree();
  const tex = useMemo(() => noiseTexture(), []);
  const hi = quality === 'high';
  const FL = useMemo(() => makePool(hi ? 1700 : 800), [hi]);
  const SM = useMemo(() => makePool(220), []);
  const SP = useMemo(() => makePool(hi ? 700 : 400), [hi]);

  const flameGeo = useMemo(() => quadGeometry(FL), [FL]);
  const smokeGeo = useMemo(() => quadGeometry(SM), [SM]);
  const sparkGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(SP.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAge', new THREE.BufferAttribute(SP.age, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(SP.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSeed', new THREE.BufferAttribute(SP.seed, 1));
    return g;
  }, [SP]);

  const flameMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: flameVert,
        fragmentShader: flameFrag,
        uniforms: { uNoise: { value: tex }, uTime: { value: 0 }, uBright: { value: 0.42 } },
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    [tex],
  );
  const smokeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: smokeVert,
        fragmentShader: smokeFrag,
        uniforms: { uNoise: { value: tex }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
      }),
    [tex],
  );
  const sparkMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: sparkVert,
        fragmentShader: sparkFrag,
        uniforms: { uScale: { value: 400 }, uTime: { value: 0 } },
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  const emberMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: emberVert,
        fragmentShader: emberFrag,
        uniforms: { uNoise: { value: tex }, uTime: { value: 0 }, uHeat: { value: 0 }, uRadius: { value: 1.6 }, uLit: { value: 0 } },
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    [tex],
  );

  const light1 = useRef();
  const light2 = useRef();
  const torchLight = useRef();
  const torch = useRef();
  const state = useRef({ I: 0, last: sceneNow(), strikeFor: null, whooshFor: null, stokeSeen: null, bursts: [] });

  // queued bursts from events
  useEffect(() => {
    const offLand = on('landed', ({ base, center, top }) => {
      state.current.bursts.push({ type: 'dust', at: base.clone(), n: 5 });
      if (shared.lit) state.current.bursts.push({ type: 'sparks', at: center.clone().setY(0.6), n: 30, flare: 0.12 });
    });
    return () => offLand();
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 1 / 20);
    const now = sceneNow();
    const S = state.current;
    const st = useStore.getState();
    const f = st.fire;
    const ig = f.ignite_at ? toScene(f.ignite_at) : NEVER;
    const lit = now >= ig;
    shared.lit = lit;

    flameMat.uniforms.uTime.value = now;
    smokeMat.uniforms.uTime.value = now;
    sparkMat.uniforms.uTime.value = now;
    emberMat.uniforms.uTime.value = now;
    sparkMat.uniforms.uScale.value = size.height * gl.getPixelRatio() * 0.9;

    /* ------- which logs are burning ------- */
    const ls = shared.logState;
    const burning = [];
    let maxRing = 0;
    if (ls && lit) {
      for (let i = 0; i < ls.n; i++) {
        if (ls.aIgn[i] <= now) {
          burning.push(i);
          const r = ls.getSlot(i).ring;
          if (r > maxRing) maxRing = r;
        }
      }
    }
    const kindlingLit = lit && now - ig > 0;
    const sinceIg = now - ig;

    const spawnSparkEarly = (p, dir) => {
      const i = take(SP);
      if (i < 0) return;
      const k = i * 3;
      SP.pos[k] = p.x;
      SP.pos[k + 1] = p.y;
      SP.pos[k + 2] = p.z;
      SP.vel[k] = -dir.x * 2 + (Math.random() - 0.5);
      SP.vel[k + 1] = -dir.y * 2 + Math.random() * 0.5;
      SP.vel[k + 2] = -dir.z * 2 + (Math.random() - 0.5);
      SP.age[i] = 0;
      SP.life[i] = 0.6 + Math.random() * 0.8;
      SP.size[i] = 0.025 + Math.random() * 0.03;
    };
    const spawnTrail = (p, dir) => {
      for (let q = 0; q < 6; q++) {
        const i = take(FL);
        if (i < 0) break;
        const k = i * 3;
        const back = Math.random() * 0.9;
        FL.pos[k] = p.x - dir.x * back + (Math.random() - 0.5) * 0.05;
        FL.pos[k + 1] = p.y - dir.y * back + (Math.random() - 0.5) * 0.05;
        FL.pos[k + 2] = p.z - dir.z * back + (Math.random() - 0.5) * 0.05;
        FL.vel[k] = -dir.x * 1.5;
        FL.vel[k + 1] = 0.4 - dir.y * 1.5;
        FL.vel[k + 2] = -dir.z * 1.5;
        FL.age[i] = 0;
        FL.life[i] = 0.25 + Math.random() * 0.25;
        FL.size[i] = 0.24 + Math.random() * 0.18;
        FL.heat[i] = 1.0;
      }
      for (let q = 0; q < 2; q++) spawnSparkEarly(p, dir);
    };

    /* ------- intensity ------- */
    let target = 0;
    if (lit) {
      const kin = Math.min(1, sinceIg / 2.5) * 0.28;
      const logsPart = 1 - Math.exp(-burning.length / 30);
      target = Math.max(kin, 0.28 + logsPart * 0.95);
      if (burning.length === 0) target = kin;
      target += Math.exp(-Math.pow(sinceIg - 3.2, 2) / 1.2) * 0.45; // the "whoomph"
      if (f.mode === 'embers') target *= 0.14;
    }
    if (f.stoke_at) {
      const s = now - toScene(f.stoke_at);
      if (s > 0 && s < 10) target += 0.55 * Math.exp(-s / 2.8) * Math.min(1, s * 3);
      if (S.stokeSeen !== f.stoke_at) {
        if (S.stokeSeen !== null && s < 3 && lit) {
          S.bursts.push({ type: 'sparks', at: new THREE.Vector3(0, 0.8, 0), n: 220, flare: 0 });
          playWhoosh(0.8);
        }
        S.stokeSeen = f.stoke_at;
      }
    }
    for (const b of S.bursts) if (b.flare) target += b.flare;
    S.I += (target - S.I) * (1 - Math.exp(-dt * (target > S.I ? 2.2 : 0.7)));
    const I = S.I;
    shared.intensity = I;
    setFireLevel(I);

    /* ------- fire arrow: the admin's shot lights the pile ------- */
    const FLIGHT = 2.1;
    const tStart = ig - FLIGHT;
    const tEnd = ig + 4;
    const torchOn = now >= tStart && now <= tEnd && sinceIg < 8;
    const tip = v3;
    const R = pileRadius(ls ? ls.n : 0);
    const C = new THREE.Vector3(0.1, 0.32 + Math.min(R, 1.2) * 0.25, Math.max(0.2, R - 0.05));
    if (f.ignite_at) S.touch = C;
    if (torch.current) {
      torch.current.visible = torchOn;
      if (torchOn) {
        const P0 = new THREE.Vector3(5.5, 9, 19);
        const arc = 3.2;
        const posAt = (u) => {
          const p = P0.clone().lerp(C, u);
          p.y += arc * 4 * u * (1 - u);
          return p;
        };
        let p;
        let dir;
        if (now < ig) {
          const u = Math.max(0, (now - tStart) / FLIGHT);
          p = posAt(u);
          dir = posAt(Math.min(1, u + 0.01)).sub(posAt(Math.max(0, u - 0.01))).normalize();
          S.arrowDir = dir.clone();
          // flame and spark trail
          if (Math.random() < 0.8) spawnTrail(p, dir);
        } else {
          // stuck in the pile, quivering, then burnt away
          const t = now - ig;
          p = C.clone().addScaledVector(S.arrowDir || new THREE.Vector3(0, -0.5, -1), 0.12);
          dir = (S.arrowDir || new THREE.Vector3(0, -0.5, -1)).clone();
          const q = Math.sin(t * 40) * Math.exp(-t * 6) * 0.06;
          dir.x += q;
          dir.normalize();
          const fade = 1 - smooth((t - 2.5) / 1.5);
          torch.current.scale.setScalar(Math.max(0.001, fade * 1.8));
        }
        if (now < ig) torch.current.scale.setScalar(1.8);
        torch.current.position.copy(p);
        torch.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        tip.copy(p).addScaledVector(dir, -0.16);
      }
    }
    if (S.strikeFor !== f.ignite_at && f.ignite_at && now >= tStart && now - tStart < 1) {
      S.strikeFor = f.ignite_at;
      playTwang();
    }
    if (S.hitFor !== f.ignite_at && f.ignite_at && sinceIg >= 0 && sinceIg < 1.5) {
      S.hitFor = f.ignite_at;
      playStrike();
      S.bursts.push({ type: 'sparks', at: C.clone(), n: 120, flare: 0.25 });
    }
    if (S.whooshFor !== f.ignite_at && f.ignite_at && sinceIg >= 2.6 && sinceIg < 4) {
      S.whooshFor = f.ignite_at;
      playWhoosh(1);
      S.bursts.push({ type: 'sparks', at: new THREE.Vector3(0, 0.6, 0), n: 260, flare: 0 });
    }

    /* ------- lights ------- */
    const flick =
      0.82 +
      0.1 * Math.sin(now * 13.1) +
      0.06 * Math.sin(now * 23.7 + 1.3) +
      0.05 * Math.sin(now * 7.3 + 0.4) +
      0.04 * (Math.random() - 0.5);
    if (light1.current) {
      light1.current.intensity = I * 26 * flick;
      light1.current.position.set(
        0.08 * Math.sin(now * 5.1),
        0.75 + I * 0.5 + 0.06 * Math.sin(now * 7.7),
        0.08 * Math.cos(now * 4.3),
      );
    }
    if (light2.current) light2.current.intensity = I * 9 * (0.9 + 0.1 * Math.sin(now * 17.3 + 2));
    if (torchLight.current) {
      torchLight.current.intensity = torchOn ? 5 * (0.85 + 0.15 * Math.sin(now * 21)) * Math.min(1, torch.current ? torch.current.scale.x : 1) : 0;
      if (torchOn) torchLight.current.position.copy(tip).add(new THREE.Vector3(0, 0.25, 0));
    }

    // ember bed heats up over the first minute
    const bedTarget = lit ? Math.min(1, sinceIg / 40) * (f.mode === 'embers' ? 1.6 : 1) : 0;
    emberMat.uniforms.uHeat.value += (bedTarget - emberMat.uniforms.uHeat.value) * dt * 0.5;
    emberMat.uniforms.uLit.value = Math.min(1.5, I * 1.2);
    emberMat.uniforms.uRadius.value = 0.9 + Math.min(maxRing, 9) * 0.12;

    /* ------- spawn flames ------- */
    let rate = 0;
    if (lit) rate = I * (hi ? 620 : 300) * (1 + maxRing * 0.1);
    S.flAcc = (S.flAcc || 0) + rate * dt;
    const spread = 0.3 + maxRing * 0.07;
    flameMat.uniforms.uBright.value = 0.22 / (1 + maxRing * 0.07);
    {
      const tv = burning.length
        ? { radius: 0.3 + maxRing * 0.13, top: 1.0 + 0.11 * maxRing, cx: 0, cz: 0 }
        : { radius: 0.22, top: 0.55, cx: S.touch ? S.touch.x : 0, cz: S.touch ? S.touch.z : 0 };
      const v = (shared.volume = shared.volume || { ...tv });
      const k = 1 - Math.exp(-dt * 1.2);
      v.radius += (tv.radius - v.radius) * k;
      v.top += (tv.top - v.top) * k;
      v.cx += (tv.cx - v.cx) * k;
      v.cz += (tv.cz - v.cz) * k;
    }
    while (S.flAcc >= 1) {
      S.flAcc -= 1;
      const i = take(FL);
      if (i < 0) break;
      const r = Math.random();
      let x, y, z;
      let sz = 0.22 + Math.random() * 0.26;
      if (burning.length === 0 || r < 0.3) {
        // central column / kindling
        const rr = Math.sqrt(Math.random()) * (burning.length ? 0.15 + maxRing * 0.04 : 0.14);
        const a = Math.random() * Math.PI * 2;
        const cx = burning.length || !S.touch ? 0 : S.touch.x;
        const cz = burning.length || !S.touch ? 0 : S.touch.z;
        x = cx + Math.cos(a) * rr;
        z = cz + Math.sin(a) * rr;
        if (burning.length) {
          const top = 1.0 + 0.11 * maxRing;
          y = top * (0.3 + 0.65 * Math.random());
          sz *= 1.1 + maxRing * 0.04;
        } else {
          y = Math.random() * Math.random() * 0.35;
          sz *= 0.6;
        }
      } else {
        // bias toward outer (visible) logs
        const a1 = burning[(Math.random() * burning.length) | 0];
        const a2 = burning[(Math.random() * burning.length) | 0];
        const s1 = ls.getSlot(a1);
        const s2 = ls.getSlot(a2);
        const s = s1.ring >= s2.ring ? s1 : s2;
        const t = 0.08 + Math.random() * 0.85;
        x = s.base.x + s.dir.x * s.len * t;
        y = s.base.y + s.dir.y * s.len * t + s.radius;
        z = s.base.z + s.dir.z * s.len * t;
        // flames lick the outer, upper surface
        const rl = Math.hypot(x, z) || 1;
        x += (x / rl) * s.radius * 1.3 + (Math.random() - 0.5) * s.radius * 2;
        z += (z / rl) * s.radius * 1.3 + (Math.random() - 0.5) * s.radius * 2;
        sz *= (0.85 + 0.35 * (1 - t)) * (1 + maxRing * 0.03);
      }
      const k = i * 3;
      FL.pos[k] = x;
      FL.pos[k + 1] = y;
      FL.pos[k + 2] = z;
      FL.vel[k] = (Math.random() - 0.5) * 0.25;
      FL.vel[k + 1] = 0.7 + Math.random() * 0.8 + I * 0.55;
      FL.vel[k + 2] = (Math.random() - 0.5) * 0.25;
      FL.age[i] = 0;
      FL.life[i] = (0.45 + Math.random() * 0.5) * (0.8 + I * 0.45);
      FL.size[i] = sz * (0.75 + I * 0.55);
      FL.heat[i] = 0.75 + Math.random() * 0.35;
    }
    // torch flames
    if (torchOn) {
      for (let q = 0; q < 4; q++) {
        const i = take(FL);
        if (i < 0) break;
        const k = i * 3;
        FL.pos[k] = tip.x + (Math.random() - 0.5) * 0.04;
        FL.pos[k + 1] = tip.y + 0.02;
        FL.pos[k + 2] = tip.z + (Math.random() - 0.5) * 0.04;
        FL.vel[k] = (Math.random() - 0.5) * 0.1;
        FL.vel[k + 1] = 0.5 + Math.random() * 0.4;
        FL.vel[k + 2] = (Math.random() - 0.5) * 0.1;
        FL.age[i] = 0;
        FL.life[i] = 0.35 + Math.random() * 0.3;
        FL.size[i] = 0.14 + Math.random() * 0.1;
        FL.heat[i] = 1.0;
      }
    }

    /* ------- update flames ------- */
    for (let i = 0; i < FL.n; i++) {
      if (FL.age[i] >= 1) continue;
      FL.age[i] += dt / FL.life[i];
      const k = i * 3;
      const px = FL.pos[k];
      const py = FL.pos[k + 1];
      const pz = FL.pos[k + 2];
      const sd = FL.seed[i] * 10;
      // turbulence + pull into a plume + light breeze
      FL.vel[k] += (Math.sin(py * 3.1 + now * 4.3 + sd) * 0.9 - px * 1.6 + 0.12) * dt;
      FL.vel[k + 2] += (Math.cos(py * 2.7 + now * 3.7 + sd * 1.3) * 0.9 - pz * 1.6) * dt;
      FL.vel[k + 1] += 1.1 * dt;
      FL.pos[k] = px + FL.vel[k] * dt;
      FL.pos[k + 1] = py + FL.vel[k + 1] * dt;
      FL.pos[k + 2] = pz + FL.vel[k + 2] * dt;
    }
    markDirty(flameGeo);

    /* ------- sparks ------- */
    const spawnSpark = (cx, cy, cz, spreadR, power) => {
      const i = take(SP);
      if (i < 0) return;
      const k = i * 3;
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * spreadR;
      SP.pos[k] = cx + Math.cos(a) * rr;
      SP.pos[k + 1] = cy + Math.random() * 0.3;
      SP.pos[k + 2] = cz + Math.sin(a) * rr;
      SP.vel[k] = (Math.random() - 0.5) * 1.4 * power;
      SP.vel[k + 1] = (1.6 + Math.random() * 2.8) * power;
      SP.vel[k + 2] = (Math.random() - 0.5) * 1.4 * power;
      SP.age[i] = 0;
      SP.life[i] = 1.2 + Math.random() * 2.6;
      SP.size[i] = 0.018 + Math.random() * 0.03;
    };
    S.spAcc = (S.spAcc || 0) + (lit ? 8 + 45 * I : 0) * dt;
    while (S.spAcc >= 1) {
      S.spAcc -= 1;
      spawnSpark(0, 0.5 + I * 0.5, 0, spread * 0.6, 0.8 + I * 0.4);
    }
    if (torchOn && Math.random() < 0.6) spawnSpark(tip.x, tip.y, tip.z, 0.03, 0.4);
    for (let i = 0; i < SP.n; i++) {
      if (SP.age[i] >= 1) continue;
      SP.age[i] += dt / SP.life[i];
      const k = i * 3;
      const sd = SP.seed[i] * 20;
      SP.vel[k] += Math.sin(now * 3.0 + sd + SP.pos[k + 1] * 2.0) * 2.6 * dt + 0.15 * dt;
      SP.vel[k + 2] += Math.cos(now * 2.6 + sd * 1.7 + SP.pos[k + 1] * 2.0) * 2.6 * dt;
      SP.vel[k + 1] += (0.25 - SP.age[i] * 0.9) * dt;
      const drag = Math.exp(-dt * 0.9);
      SP.vel[k] *= drag;
      SP.vel[k + 1] *= drag;
      SP.vel[k + 2] *= drag;
      SP.pos[k] += SP.vel[k] * dt;
      SP.pos[k + 1] += SP.vel[k + 1] * dt;
      SP.pos[k + 2] += SP.vel[k + 2] * dt;
    }

    /* ------- smoke ------- */
    S.smAcc = (S.smAcc || 0) + (lit ? 6 + 22 * I : 0) * dt;
    while (S.smAcc >= 1) {
      S.smAcc -= 1;
      const i = take(SM);
      if (i < 0) break;
      const k = i * 3;
      SM.pos[k] = (Math.random() - 0.5) * 0.5;
      SM.pos[k + 1] = 1.1 + I * 0.9 + Math.random() * 0.4;
      SM.pos[k + 2] = (Math.random() - 0.5) * 0.5;
      SM.vel[k] = 0.12 + (Math.random() - 0.5) * 0.2;
      SM.vel[k + 1] = 0.55 + Math.random() * 0.5;
      SM.vel[k + 2] = (Math.random() - 0.5) * 0.2;
      SM.age[i] = 0;
      SM.life[i] = 5 + Math.random() * 4;
      SM.size[i] = 0.7 + Math.random() * 0.6 + I * 0.5;
      SM.heat[i] = 0;
    }

    /* ------- event bursts ------- */
    for (const b of S.bursts) {
      if (b.type === 'dust') {
        for (let q = 0; q < b.n; q++) {
          const i = take(SM);
          if (i < 0) break;
          const k = i * 3;
          const a = Math.random() * Math.PI * 2;
          SM.pos[k] = b.at.x + Math.cos(a) * 0.1;
          SM.pos[k + 1] = 0.05 + Math.random() * 0.1;
          SM.pos[k + 2] = b.at.z + Math.sin(a) * 0.1;
          SM.vel[k] = Math.cos(a) * (0.3 + Math.random() * 0.5);
          SM.vel[k + 1] = 0.15 + Math.random() * 0.25;
          SM.vel[k + 2] = Math.sin(a) * (0.3 + Math.random() * 0.5);
          SM.age[i] = 0;
          SM.life[i] = 1.0 + Math.random() * 0.9;
          SM.size[i] = 0.18 + Math.random() * 0.2;
          SM.heat[i] = 1;
        }
      } else if (b.type === 'sparks') {
        for (let q = 0; q < b.n; q++) spawnSpark(b.at.x, b.at.y, b.at.z, 0.35, 1.25);
      }
      b.flare = b.flare ? b.flare * 0.9 : 0;
    }
    S.bursts = S.bursts.filter((b) => b.flare > 0.01).map((b) => ({ ...b, n: 0, type: 'flare' }));

    for (let i = 0; i < SM.n; i++) {
      if (SM.age[i] >= 1) continue;
      SM.age[i] += dt / SM.life[i];
      const k = i * 3;
      if (SM.heat[i] > 0.5) {
        const d = Math.exp(-dt * 2.5);
        SM.vel[k] *= d;
        SM.vel[k + 1] *= d;
        SM.vel[k + 2] *= d;
      } else {
        SM.vel[k] += Math.sin(now * 0.4 + SM.seed[i] * 9) * 0.05 * dt;
      }
      SM.pos[k] += SM.vel[k] * dt;
      SM.pos[k + 1] += SM.vel[k + 1] * dt;
      SM.pos[k + 2] += SM.vel[k + 2] * dt;
    }
    markDirty(smokeGeo);
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.aAge.needsUpdate = true;
    sparkGeo.attributes.aSize.needsUpdate = true;
  });

  return (
    <group>
      <pointLight
        ref={light1}
        color="#ff8a3a"
        intensity={0}
        decay={1.55}
        castShadow={false}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.004}
        shadow-radius={6}
        shadow-camera-near={0.1}
        shadow-camera-far={40}
      />
      <pointLight ref={light2} color="#ff6a1f" position={[0, 0.25, 0]} intensity={0} decay={1.8} />
      <pointLight ref={torchLight} color="#ffa04a" intensity={0} decay={1.8} />

      <mesh rotation-x={-Math.PI / 2} position-y={0.012} material={emberMat} renderOrder={1}>
        <circleGeometry args={[2.8, 64]} />
      </mesh>

      <mesh geometry={smokeGeo} material={smokeMat} frustumCulled={false} renderOrder={2} />
      <mesh geometry={flameGeo} material={flameMat} frustumCulled={false} renderOrder={3} />
      <points geometry={sparkGeo} material={sparkMat} frustumCulled={false} renderOrder={4} />

      <group ref={torch} visible={false}>
        {/* shaft */}
        <mesh position={[0, -0.42, 0]}>
          <cylinderGeometry args={[0.009, 0.009, 0.84, 6]} />
          <meshStandardMaterial color="#6b5236" roughness={0.8} />
        </mesh>
        {/* steel head */}
        <mesh position={[0, 0.05, 0]}>
          <coneGeometry args={[0.022, 0.09, 4]} />
          <meshStandardMaterial color="#3d3d40" metalness={0.8} roughness={0.35} />
        </mesh>
        {/* burning oil-soaked wrap */}
        <mesh position={[0, -0.08, 0]}>
          <sphereGeometry args={[0.03, 10, 8]} />
          <meshStandardMaterial color="#1a0d06" emissive="#ff6a18" emissiveIntensity={2.2} roughness={1} />
        </mesh>
        {/* fletching */}
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[0, -0.76, 0]} rotation={[0, (i * Math.PI * 2) / 3, 0]}>
            <boxGeometry args={[0.002, 0.12, 0.035]} />
            <meshStandardMaterial color="#d9cfc0" roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function smooth(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

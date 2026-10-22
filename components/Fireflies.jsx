'use client';
// Soft fireflies drift around the clearing during a sing-along.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/lib/store';
import { songBeat } from '@/lib/beat';
import { sceneNow } from '@/lib/clock';

const N = 140;

export default function Fireflies() {
  const amt = useRef(0);
  const pts = useRef();
  const { geo, mat } = useMemo(() => {
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 8;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 0.3 + Math.random() * 2.6;
      pos[i * 3 + 2] = Math.sin(a) * r - 1.5;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uPx: { value: 1 }, uBeat: { value: 0 } },
      vertexShader: `attribute float aSeed; uniform float uTime; uniform float uAmt; uniform float uPx; uniform float uBeat; varying float vB;
        void main(){
          vec3 p = position;
          // slowly circle the fire
          float ang = uTime * (0.04 + aSeed * 0.05);
          p.xz = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (p.xz + vec2(0.0, 1.5)) - vec2(0.0, 1.5);
          float t = uTime * (0.15 + aSeed * 0.2) + aSeed * 40.0;
          p += vec3(sin(t) * 0.9, sin(t * 1.7) * 0.35, cos(t * 0.8) * 0.9);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float blink = smoothstep(0.2, 1.0, sin(uTime * (0.8 + aSeed) + aSeed * 30.0));
          vB = (blink * 0.7 + 0.3) * uAmt * (0.55 + 0.9 * uBeat * step(0.5, fract(aSeed * 7.0)) + 0.3 * uBeat);
          gl_PointSize = vB <= 0.001 ? 0.0 : (55.0 * uPx) / -mv.z;
        }`,
      fragmentShader: `varying float vB; void main(){ float d = length(gl_PointCoord - 0.5); float c = 1.0 - smoothstep(0.0, 0.5, d); c *= c;
        gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * c * vB * 2.0, 1.0); }`,
    });
    return { geo, mat };
  }, []);
  useFrame((state, dt) => {
    const on = !!useStore.getState().fire.song_at;
    amt.current += ((on ? 1 : 0) - amt.current) * Math.min(1, dt * 0.6);
    mat.uniforms.uAmt.value = amt.current;
    if (pts.current) pts.current.visible = amt.current > 0.01; // no draw cost unless singing
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    const sb = songBeat(sceneNow());
    mat.uniforms.uBeat.value = sb ? Math.exp(-sb.phase * 5) : 0;
    mat.uniforms.uPx.value = state.gl.getPixelRatio() * (state.size.height / 800);
  });
  return <points ref={pts} geometry={geo} material={mat} frustumCulled={false} renderOrder={6} />;
}

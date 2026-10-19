'use client';
// Soft fireflies drift around the clearing during a sing-along.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/lib/store';

const N = 140;

export default function Fireflies() {
  const amt = useRef(0);
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
      uniforms: { uTime: { value: 0 }, uAmt: { value: 0 }, uPx: { value: 1 } },
      vertexShader: `attribute float aSeed; uniform float uTime; uniform float uAmt; uniform float uPx; varying float vB;
        void main(){
          vec3 p = position;
          float t = uTime * (0.15 + aSeed * 0.2) + aSeed * 40.0;
          p += vec3(sin(t) * 0.9, sin(t * 1.7) * 0.35, cos(t * 0.8) * 0.9);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float blink = smoothstep(0.2, 1.0, sin(uTime * (0.8 + aSeed) + aSeed * 30.0));
          vB = blink * uAmt;
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
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uPx.value = state.gl.getPixelRatio() * (state.size.height / 800);
  });
  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={6} />;
}

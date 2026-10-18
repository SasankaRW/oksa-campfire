'use client';
// Screen-space heat shimmer above the fire.
import { forwardRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Effect } from 'postprocessing';
import * as THREE from 'three';
import { shared } from '@/lib/bus';

const frag = /* glsl */ `
uniform vec2 uCenter;
uniform vec2 uSize;
uniform float uT;
uniform float uAmt;
void mainUv(inout vec2 uv){
  vec2 d = (uv - uCenter) / uSize;
  float m = (1.0 - smoothstep(0.35, 1.0, abs(d.x))) * smoothstep(-0.6, 0.1, d.y) * (1.0 - smoothstep(0.7, 1.6, d.y));
  float w = sin(uv.y * 160.0 - uT * 7.0 + sin(uv.x * 60.0 + uT) * 2.0) * 0.6
          + sin(uv.y * 95.0 - uT * 4.6 + uv.x * 45.0) * 0.4;
  uv.x += w * 0.0018 * m * uAmt;
  uv.y += cos(uv.x * 120.0 + uT * 6.0) * 0.0009 * m * uAmt;
}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){ outputColor = inputColor; }`;

class HeatHazeImpl extends Effect {
  constructor() {
    super('HeatHaze', frag, {
      uniforms: new Map([
        ['uCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
        ['uSize', new THREE.Uniform(new THREE.Vector2(0.1, 0.2))],
        ['uT', new THREE.Uniform(0)],
        ['uAmt', new THREE.Uniform(0)],
      ]),
    });
  }
}

const v = new THREE.Vector3();
export const HeatHaze = forwardRef(function HeatHaze(_, ref) {
  const effect = useMemo(() => new HeatHazeImpl(), []);
  const { camera } = useThree();
  useFrame((s) => {
    const vol = shared.volume || { radius: 0.4, top: 1 };
    const I = Math.min(1.3, shared.intensity || 0);
    v.set(0, vol.top * 1.05, 0).project(camera);
    const c = effect.uniforms.get('uCenter').value;
    c.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
    // projected size of the flame column
    const a = new THREE.Vector3(vol.radius, vol.top, 0).project(camera);
    const b = new THREE.Vector3(0, vol.top * 2.2, 0).project(camera);
    effect.uniforms.get('uSize').value.set(Math.max(0.03, Math.abs(a.x - v.x) * 0.5 * 1.2), Math.max(0.05, Math.abs(b.y - v.y) * 0.5));
    effect.uniforms.get('uT').value = s.clock.elapsedTime;
    effect.uniforms.get('uAmt').value = I;
  });
  return <primitive ref={ref} object={effect} dispose={null} />;
});

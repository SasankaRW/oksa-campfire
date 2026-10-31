'use client';
// Ray-marched volumetric flame body. Gives the fire a continuous, rolling
// core instead of a cluster of sprites. Particles add licks, sparks and smoke.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { shared } from '@/lib/bus';
import { sceneNow } from '@/lib/clock';
import { noise3D } from '@/lib/noise3d';

const vert = /* glsl */ `
out vec3 vLocal;
out vec3 vCam;
void main(){
  vLocal = position;
  vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const frag = /* glsl */ `
precision highp sampler3D;
uniform sampler3D uNoise;
uniform float uTime;
uniform float uI;
uniform float uBright;
uniform vec3 uSize;
in vec3 vLocal;
in vec3 vCam;
out vec4 outColor;

vec2 hitBox(vec3 o, vec3 d){
  vec3 inv = 1.0 / d;
  vec3 t0 = (vec3(-0.5) - o) * inv;
  vec3 t1 = (vec3(0.5) - o) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  return vec2(max(max(tmin.x, tmin.y), tmin.z), min(min(tmax.x, tmax.y), tmax.z));
}
// black-body style ramp: deep red tips -> orange -> yellow -> pale core
vec3 ramp(float t){
  vec3 c = mix(vec3(0.18, 0.01, 0.0), vec3(0.85, 0.12, 0.01), smoothstep(0.0, 0.25, t));
  c = mix(c, vec3(1.0, 0.38, 0.04), smoothstep(0.25, 0.5, t));
  c = mix(c, vec3(1.0, 0.66, 0.18), smoothstep(0.5, 0.75, t));
  c = mix(c, vec3(1.0, 0.86, 0.55), smoothstep(0.82, 1.0, t));
  return c;
}
void main(){
  vec3 ro = vCam;
  vec3 rd = normalize(vLocal - vCam);
  vec2 b = hitBox(ro, rd);
  b.x = max(b.x, 0.0);
  if (b.x >= b.y) discard;
  float dt = (b.y - b.x) / float(STEPS);
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float t = b.x + dt * jitter;
  vec3 col = vec3(0.0);
  float stepLen = dt * length(rd * uSize);
  for (int i = 0; i < STEPS; i++){
    vec3 p = ro + rd * t;
    vec3 w = p * uSize;
    float h = p.y + 0.5;
    vec3 q = vec3(w.x, w.y - uTime * 2.3, w.z) * 0.6;
    float n1 = texture(uNoise, q * 0.5).r;
    float n2 = texture(uNoise, q * 1.3 + vec3(0.37, -uTime * 0.35, 0.71)).r;
    float n = n1 * 0.62 + n2 * 0.38;
    vec2 xz = p.xz * 2.0;
    xz += (vec2(n2, n1) - 0.5) * (0.6 + 1.4 * h);
    xz.x -= h * h * 0.12; // slight lean in the breeze
    float r = length(xz);
    float width = mix(0.95, 0.06, pow(h, 0.7));
    float shape = 1.0 - smoothstep(width * 0.25, width, r);
    float vfade = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.42, 0.95, h + (n - 0.5) * 1.1));
    float d = shape * vfade;
    d = smoothstep(0.3, 0.85, d * (0.25 + n * 1.5));
    // fast, fine erosion breaks the upper flame into separate licking tongues
    float ero = texture(uNoise, q * 2.4 + vec3(0.0, -uTime * 1.3, 0.0)).r;
    d *= smoothstep(0.18, 0.55, ero + (1.0 - h) * 0.55);
    // hotter near the axis and the fuel, cooler and redder at the edges and tips
    float core = 1.0 - smoothstep(0.0, width * 0.7, r);
    float temp = clamp(d * (0.75 + core * 0.45) * (1.08 - h * 0.85), 0.0, 1.0);
    vec3 e = ramp(temp) * d;
    // faint blue where flame meets wood
    e += vec3(0.05, 0.09, 0.3) * d * (1.0 - smoothstep(0.03, 0.12, h)) * core;
    col += e * stepLen;
    t += dt;
  }
  outColor = vec4(col * uBright * uI, 1.0);
}`;

export default function FireVolume({ quality = 'high' }) {
  const mesh = useRef();
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: vert,
        fragmentShader: frag,
        defines: { STEPS: quality === 'high' ? 32 : 18 },
        uniforms: {
          uNoise: { value: noise3D() },
          uTime: { value: 0 },
          uI: { value: 0 },
          uBright: { value: 0.5 },
          uSize: { value: new THREE.Vector3(2, 3, 2) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
      }),
    [quality],
  );

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const I = shared.intensity || 0;
    const v = shared.volume || { radius: 0.4, top: 1.0, I: 0, cx: 0, cz: 0 };
    m.visible = I > 0.02;
    const W = Math.max(0.7, v.radius * 1.9) * (0.75 + Math.min(I, 1.3) * 0.3);
    const H = (v.top * 1.35 + 0.6) * (0.55 + Math.min(I, 1.4) * 0.5);
    const base = v.top * 0.18;
    m.scale.set(W, H, W);
    m.position.set(v.cx, base + H / 2, v.cz);
    mat.uniforms.uSize.value.set(W, H, W);
    mat.uniforms.uTime.value = sceneNow();
    mat.uniforms.uI.value = Math.min(1.3, I);
  });

  return (
    <mesh ref={mesh} material={mat} renderOrder={3} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  );
}

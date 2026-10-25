'use client';
// The mountain-edge setting: a real Milky Way sky, the moon, distant ridges
// fading into haze, a sea of cloud in the valleys and village lights below.
import { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { fbm, ridged } from '@/lib/noise';
import { noiseTexture } from './Fire';
import { getN3 } from '@/lib/noise3d';
import { shared } from '@/lib/bus';

export const MOON_DIR = new THREE.Vector3(-0.1, 0.2, -0.97).normalize();
const HAZE = new THREE.Color('#0d1424');
const MIST = new THREE.Color('#1a2233');

/* ------------------------------- sky ------------------------------- */
export function Sky() {
  const { scene } = useThree();
  const tex = useLoader(THREE.CubeTextureLoader, [
    ['px.jpg', 'nx.jpg', 'py.jpg', 'ny.jpg', 'pz.jpg', 'nz.jpg'].map((f) => '/textures/sky/' + f),
  ])[0];
  useEffect(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    scene.background = tex;
    scene.backgroundIntensity = 0.42;
    scene.backgroundRotation = new THREE.Euler(-1.05, 0.5, 0);
    return () => {
      scene.background = null;
    };
  }, [tex, scene]);

  // faint moon-glow and horizon airglow over the photo sky
  const glow = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: { uMoon: { value: MOON_DIR } },
        vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w * 0.99999; }`,
        fragmentShader: `uniform vec3 uMoon; varying vec3 vD; void main(){
          float h = vD.y;
          float m = max(dot(vD, uMoon), 0.0);
          vec3 c = vec3(0.10,0.13,0.20) * pow(m, 6.0) * 0.9 + vec3(0.35,0.4,0.5) * pow(m, 220.0);
          c += vec3(0.05,0.065,0.1) * (1.0 - smoothstep(-0.05, 0.25, h));
          float a = clamp(max(c.r, max(c.g, c.b)) * 3.0, 0.0, 1.0);
          gl_FragColor = vec4(c, 1.0);
        }`,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  return (
    <mesh material={glow} renderOrder={-20} frustumCulled={false}>
      <sphereGeometry args={[5000, 48, 24]} />
    </mesh>
  );
}

export function Moon() {
  const tex = useLoader(THREE.TextureLoader, '/textures/moon.jpg');
  tex.colorSpace = THREE.SRGBColorSpace;
  const D = 6000;
  const pos = MOON_DIR.clone().multiplyScalar(D);
  const halo = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(200,215,255,0.55)');
    gr.addColorStop(0.15, 'rgba(160,180,230,0.18)');
    gr.addColorStop(0.5, 'rgba(110,130,190,0.05)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  // the moon's glow fades while memory photos fill the sky
  const haloMat = useRef();
  useFrame(() => {
    if (haloMat.current) haloMat.current.opacity = 1 - (shared.memK || 0);
  });
  return (
    <group position={pos}>
      <mesh rotation={[0, Math.PI * 0.8, 0.3]} renderOrder={-15}>
        <sphereGeometry args={[D * 0.0105, 48, 24]} />
        <meshBasicMaterial map={tex} color={[2.4, 2.35, 2.2]} fog={false} toneMapped={false} />
      </mesh>
      <sprite scale={[D * 0.22, D * 0.22, 1]} renderOrder={-16}>
        <spriteMaterial ref={haloMat} map={halo} transparent depthWrite={false} fog={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </group>
  );
}

/* ---------------------------- mountains ---------------------------- */
function terrainHeight(x, z) {
  const d = Math.hypot(x, z);
  const base = -330 + fbm(x / 420 + 7, z / 420 + 3, 4) * 140;
  const m = THREE.MathUtils.smoothstep(d, 500, 2600);
  let h = base + ridged(x / 800 + 11, z / 800 + 5, 6) * (120 + 520 * m) * (0.3 + 0.7 * m);
  h += THREE.MathUtils.smoothstep(d, 2600, 4500) * ridged(x / 1500 + 3, z / 1500 + 9, 5) * 480;
  h += (fbm(x / 140, z / 140, 3) - 0.5) * 50;
  return h;
}

export function Mountains() {
  const geo = useMemo(() => {
    const R = 240;
    const C = 420;
    const d0 = 70;
    const d1 = 7500;
    const a0 = -1.9;
    const a1 = 1.9;
    const pos = new Float32Array((R + 1) * (C + 1) * 3);
    let k = 0;
    for (let i = 0; i <= R; i++) {
      const d = d0 * Math.pow(d1 / d0, i / R);
      for (let j = 0; j <= C; j++) {
        const a = a0 + (a1 - a0) * (j / C);
        const x = Math.sin(a) * d;
        const z = -Math.cos(a) * d;
        pos[k++] = x;
        pos[k++] = terrainHeight(x, z);
        pos[k++] = z;
      }
    }
    const idx = [];
    for (let i = 0; i < R; i++)
      for (let j = 0; j < C; j++) {
        const a = i * (C + 1) + j;
        const b = a + C + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // forest on gentle slopes, bare rock on steep ones
    const n = g.attributes.normal;
    const col = new Float32Array(pos.length);
    for (let v = 0; v < n.count; v++) {
      const slope = 1 - n.getY(v);
      const y = pos[v * 3 + 1];
      const rock = THREE.MathUtils.smoothstep(slope, 0.25, 0.55);
      const high = THREE.MathUtils.smoothstep(y, 150, 600);
      const t = Math.min(1, rock + high * 0.5);
      col[v * 3] = 0.035 + t * 0.09;
      col[v * 3 + 1] = 0.05 + t * 0.085;
      col[v * 3 + 2] = 0.04 + t * 0.09;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }, []);

  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, fog: false });
    m.onBeforeCompile = (s) => {
      s.uniforms.uHaze = { value: HAZE };
      s.uniforms.uMist = { value: MIST };
      s.uniforms.uMoon = { value: MOON_DIR };
      s.uniforms.uN3 = getN3();
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform vec3 uHaze; uniform vec3 uMist; uniform vec3 uMoon; uniform highp sampler3D uN3;')
        .replace('#include <color_fragment>', '#include <color_fragment>\nfloat tn = texture(uN3, vWP * 0.004).r * 0.6 + texture(uN3, vWP * 0.02).r * 0.4;\ndiffuseColor.rgb *= 0.55 + tn * 0.9;')
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          vec3 V = vWP - cameraPosition;
          float dist = length(V);
          V /= dist;
          vec3 hz = uHaze + vec3(0.07,0.09,0.13) * pow(max(dot(V, uMoon), 0.0), 6.0);
          float haze = 1.0 - exp(-dist * 0.00026);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, hz, clamp(haze, 0.0, 0.92));
          float mist = exp(-max(vWP.y + 290.0, 0.0) / 70.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uMist, clamp(mist * 0.8, 0.0, 0.8));`,
        );
    };
    return m;
  }, []);

  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={-10} />;
}

/* A sea of cloud resting in the valleys */
export function CloudSea() {
  const tex = useMemo(() => noiseTexture(), []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: { uNoise: { value: tex }, uTime: { value: 0 }, uMoon: { value: MOON_DIR }, uHaze: { value: HAZE } },
        vertexShader: `varying vec3 vWP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform sampler2D uNoise; uniform float uTime; uniform vec3 uMoon; uniform vec3 uHaze; varying vec3 vWP;
        void main(){
          vec2 p = vWP.xz;
          float n = texture2D(uNoise, p * 0.00055 + vec2(uTime * 0.0022, 0.0)).r * 0.6
                  + texture2D(uNoise, p * 0.0019 + vec2(-uTime * 0.004, uTime * 0.002)).r * 0.4;
          float d = length(vWP - cameraPosition);
          float a = smoothstep(0.42, 0.7, n) * smoothstep(150.0, 600.0, d) * (1.0 - smoothstep(5000.0, 7200.0, d));
          vec3 V = normalize(vWP - cameraPosition);
          float m = pow(max(dot(V, uMoon), 0.0), 4.0);
          vec3 c = mix(vec3(0.035, 0.045, 0.065), vec3(0.09, 0.105, 0.14), m) * (0.7 + n * 0.6);
          c = mix(c, uHaze, clamp(1.0 - exp(-d * 0.0003), 0.0, 0.6));
          gl_FragColor = vec4(c, a * 0.7);
        }`,
      }),
    [tex],
  );
  useFrame((s) => (mat.uniforms.uTime.value = s.clock.elapsedTime));
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -275, -2000]} material={mat} renderOrder={-9}>
      <planeGeometry args={[16000, 9000, 1, 1]} />
    </mesh>
  );
}

/* Warm specks of villages far below */
export function VillageLights() {
  const geo = useMemo(() => {
    const pts = [];
    const seeds = [];
    let i = 0;
    while (pts.length < 520 * 3 && i < 30000) {
      i++;
      const a = (Math.random() - 0.5) * 2.6;
      const d = 350 + Math.pow(Math.random(), 1.4) * 3200;
      const x = Math.sin(a) * d;
      const z = -Math.cos(a) * d;
      const h = terrainHeight(x, z);
      if (h > -250 && h < -60) {
        // cluster villages a little
        const cx = x + (Math.random() - 0.5) * 30;
        const cz = z + (Math.random() - 0.5) * 30;
        pts.push(cx, terrainHeight(cx, cz) + 2, cz);
        seeds.push(Math.random());
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
    return g;
  }, []);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
        vertexShader: `attribute float aSeed; uniform float uTime; uniform float uPx; varying float vA; varying float vS;
          void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          float d = -mv.z; vS = aSeed;
          vA = (0.55 + 0.45 * sin(uTime * (0.6 + aSeed * 2.0) + aSeed * 50.0)) * exp(-d * 0.00045);
          gl_PointSize = (1.4 + aSeed * 1.4) * uPx; }`,
        fragmentShader: `varying float vA; varying float vS; void main(){ float d = length(gl_PointCoord - 0.5); float c = 1.0 - smoothstep(0.0, 0.5, d);
          vec3 col = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.85, 0.6), vS);
          gl_FragColor = vec4(col * c * vA * 1.4, 1.0); }`,
      }),
    [],
  );
  const { gl } = useThree();
  useFrame((s) => {
    mat.uniforms.uTime.value = s.clock.elapsedTime;
    mat.uniforms.uPx.value = gl.getPixelRatio();
  });
  return <points geometry={geo} material={mat} frustumCulled={false} renderOrder={-8} />;
}

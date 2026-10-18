'use client';
import { useMemo, useRef, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader } from '@react-three/fiber';
import { fbm } from '@/lib/noise';
import { Sky, Moon, Mountains, CloudSea, VillageLights, MOON_DIR } from './Landscape';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shared } from '@/lib/bus';
import { NOISE } from '@/lib/glsl';
import { getN3 } from '@/lib/noise3d';
import { hash } from '@/lib/layout';
import { makeLogMaterial } from './logMaterial';

/* The plateau: packed earth around the fire, grass beyond, ending at a cliff edge. */
export function groundHeight(x, z) {
  const r = Math.hypot(x, z);
  const flat = THREE.MathUtils.smoothstep(r, 3.2, 7);
  let y = (fbm(x * 0.22 + 4, z * 0.22 + 1, 3) - 0.5) * 0.3 * flat;
  y += (fbm(x * 0.03, z * 0.03, 3) - 0.5) * 2.2 * THREE.MathUtils.smoothstep(r, 8, 24);
  // hills rising on either side frame the view
  y += THREE.MathUtils.smoothstep(Math.abs(x), 16, 45) * (4 + fbm(x * 0.05, z * 0.05, 4) * 10);
  // cliff
  const zc = CLIFF_Z + (fbm(x * 0.07 + 9, 2, 3) - 0.5) * 4 + THREE.MathUtils.smoothstep(Math.abs(x), 12, 40) * 6;
  const e = z - zc;
  if (e < 0) y -= Math.pow(-e, 1.35) * 7 + (fbm(x * 0.4, z * 0.4, 3) - 0.5) * 2.5 * Math.min(1, -e);
  return Math.max(y, -160);
}
export const CLIFF_Z = -8.5;

function Ground() {
  const grass = useLoader(THREE.TextureLoader, '/textures/grass.jpg');
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(130, 110, 260, 220);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, 10);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      p.setY(i, groundHeight(x, z));
      uv.setXY(i, x / 3.5, z / 3.5);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const mat = useMemo(() => {
    grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
    grass.colorSpace = THREE.SRGBColorSpace;
    grass.anisotropy = 8;
    const m = new THREE.MeshStandardMaterial({ map: grass, roughness: 1 });
    m.onBeforeCompile = (s) => {
      s.uniforms.uN3 = getN3();
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vW; varying vec3 vN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed,1.0)).xyz; vN = normal;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vW; varying vec3 vN;\n${NOISE}`)
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float r = length(vW.xz);
          float n1 = fbm3(vec3(vW.xz*0.6, 0.0));
          float n2 = fbm3(vec3(vW.xz*4.0, 3.0));
          float n3 = fbm3(vec3(vW.xz*18.0, 7.0));
          vec3 grassC = diffuseColor.rgb * vec3(0.32, 0.36, 0.3);
          grassC = mix(grassC, vec3(0.09,0.07,0.045), smoothstep(0.55,0.72,n2)*0.5); // dry patches
          vec3 dirt = mix(vec3(0.075,0.058,0.045), vec3(0.14,0.11,0.085), n2*0.8 + n3*0.3);
          float clearing = smoothstep(2.6, 5.5, r + (n1-0.5)*2.5);
          vec3 c = mix(dirt, grassC, clearing);
          float scorch = 1.0 - smoothstep(1.4, 2.6, r + (n2-0.5)*0.6);
          c = mix(c, vec3(0.025,0.023,0.021), scorch*0.85);
          // rock on steep ground (cliff face and hill sides)
          float steep = smoothstep(0.75, 0.45, vN.y);
          vec3 rock = mix(vec3(0.07,0.07,0.075), vec3(0.16,0.155,0.15), n3*0.7 + n2*0.3);
          c = mix(c, rock, steep);
          diffuseColor.rgb = c;`,
        );
    };
    return m;
  }, [grass]);
  return <mesh geometry={geo} material={mat} receiveShadow />;
}

/* Boulders along the cliff edge */
function Boulders() {
  const ref = useRef();
  const N = 14;
  const geo = useMemo(() => {
    let g = new THREE.IcosahedronGeometry(1, 3);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      v.multiplyScalar(1 + (fbm(v.x * 1.3 + 3, v.y * 1.3 + v.z, 3) - 0.5) * 0.5);
      if (v.y < -0.3) v.y = -0.3;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < N; i++) {
      let x = -22 + (i / (N - 1)) * 44 + (hash(i + 400) - 0.5) * 3;
      if (Math.abs(x) < 4) x = Math.sign(x || 1) * (4 + hash(i + 470) * 2);
      const zc = CLIFF_Z + (fbm(x * 0.07 + 9, 2, 3) - 0.5) * 4 + THREE.MathUtils.smoothstep(Math.abs(x), 12, 40) * 6;
      const z = zc + 0.6 + hash(i + 410) * 1.5;
      const s = 0.14 + hash(i + 420) * 0.32;
      q.setFromEuler(new THREE.Euler(hash(i + 430), hash(i + 440) * 6, hash(i + 450) * 0.5));
      m.compose(new THREE.Vector3(x, groundHeight(x, z) + s * 0.2, z), q, new THREE.Vector3(s * 1.3, s, s * 1.1));
      ref.current.setMatrixAt(i, m);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <instancedMesh ref={ref} args={[geo, undefined, N]} castShadow receiveShadow>
      <meshStandardMaterial color="#2a2928" roughness={0.95} />
    </instancedMesh>
  );
}

/* Ring of fire stones */
function Stones() {
  const ref = useRef();
  const N = 22;
  const geo = useMemo(() => {
    let g = new THREE.IcosahedronGeometry(1, 4);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n =
        Math.sin(v.x * 3.1 + v.y * 1.7) * 0.08 +
        Math.sin(v.z * 4.3 + v.x * 2.2) * 0.06 +
        Math.sin(v.y * 7.1 + v.z * 5.3) * 0.03;
      v.multiplyScalar(1 + n);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.95, color: 0xffffff });
    m.onBeforeCompile = (s) => {
      s.uniforms.uN3 = getN3();
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vO; varying vec3 vW2;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvO = position;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW2 = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vO; varying vec3 vW2;\n${NOISE}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float n = fbm3(vO*3.0);
          float m = fbm3(vO*12.0+4.0);
          vec3 c = mix(vec3(0.16,0.15,0.14), vec3(0.34,0.32,0.29), n*0.9 + m*0.25);
          // soot on the side facing the fire
          float toFire = 1.0 - smoothstep(1.7, 2.05, length(vW2.xz));
          c = mix(c, vec3(0.03), toFire*0.75*smoothstep(0.3,0.7,m+0.2));
          diffuseColor.rgb = c;`,
        );
    };
    return m;
  }, []);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + hash(i + 200) * 0.1;
      const R = 1.95 + (hash(i + 210) - 0.5) * 0.12;
      const sx = 0.2 + hash(i + 220) * 0.1;
      const sy = 0.13 + hash(i + 230) * 0.08;
      const sz = 0.17 + hash(i + 240) * 0.08;
      q.setFromEuler(new THREE.Euler(hash(i + 250) * 0.6, -a + hash(i + 260), hash(i + 270) * 0.4));
      m.compose(new THREE.Vector3(Math.cos(a) * R, sy * 0.45, Math.sin(a) * R), q, new THREE.Vector3(sx, sy, sz));
      ref.current.setMatrixAt(i, m);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  }, []);
  return <instancedMesh ref={ref} args={[geo, mat, N]} castShadow receiveShadow />;
}

/* Pine forest silhouette */
function Trees() {
  const cones = useRef();
  const trunks = useRef();
  const trees = useMemo(() => {
    const out = [];
    let i = 0;
    while (out.length < 120 && i < 4000) {
      i++;
      const side = hash(i * 1.7) < 0.5 ? -1 : 1;
      const x = side * (9 + Math.pow(hash(i * 3.1), 0.9) * 40);
      const z = -5 + hash(i * 5.7) * 40;
      // stay on the plateau, keep the view to the valley open
      if (z < CLIFF_Z + 4 + THREE.MathUtils.smoothstep(Math.abs(x), 12, 40) * 6) continue;
      if (Math.abs(x) < 10 && z < 4) continue;
      out.push({ x, z, y: groundHeight(x, z), h: 5 + hash(i * 7.3) * 7, w: 0.8 + hash(i * 9.1) * 0.5 });
    }
    return out;
  }, []);
  const layers = 5;
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let c = 0;
    trees.forEach((t, ti) => {
      for (let l = 0; l < layers; l++) {
        const f = l / layers;
        const y = t.h * (0.22 + f * 0.62);
        const s = t.h * 0.28 * (1 - f * 0.72) * t.w;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(ti + l * 13) * 6.28);
        m.compose(new THREE.Vector3(t.x, t.y + y, t.z), q, new THREE.Vector3(s, t.h * 0.34, s));
        cones.current.setMatrixAt(c++, m);
      }
      m.compose(new THREE.Vector3(t.x, t.y + t.h * 0.18, t.z), q, new THREE.Vector3(0.12, t.h * 0.36, 0.12));
      trunks.current.setMatrixAt(ti, m);
    });
    cones.current.instanceMatrix.needsUpdate = true;
    trunks.current.instanceMatrix.needsUpdate = true;
  }, [trees]);
  const coneGeo = useMemo(() => {
    const g = new THREE.ConeGeometry(1, 1, 9, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const y = p.getY(i);
      const j = 1 + Math.sin(Math.atan2(z, x) * 7 + y * 5) * 0.12;
      p.setX(i, x * j);
      p.setZ(i, z * j);
      if (y < -0.4) p.setY(i, y - Math.abs(Math.sin(Math.atan2(z, x) * 9)) * 0.12);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <group>
      <instancedMesh ref={cones} args={[coneGeo, undefined, trees.length * layers]} castShadow={false} receiveShadow>
        <meshStandardMaterial color="#0e1a12" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]}>
        <cylinderGeometry args={[0.6, 1, 1, 6]} />
        <meshStandardMaterial color="#1a120c" roughness={1} />
      </instancedMesh>
    </group>
  );
}

/* A few big seating logs around the fire to give it scale */
function SeatLogs() {
  const seats = useMemo(
    () => [
      { a: -0.55, r: 4.0, len: 2.6 },
      { a: 0.75, r: 4.2, len: 2.4 },
      { a: 2.35, r: 4.1, len: 2.8 },
      { a: 3.6, r: 4.3, len: 2.5 },
    ],
    [],
  );
  const mats = useMemo(
    () =>
      seats.map((s, i) => {
        const m = makeLogMaterial({ instanced: false });
        m.userData.single = {
          aIgnite: { value: 1e9 },
          aSeed: { value: 40 + i * 7 },
          aLen: { value: s.len },
          aRad: { value: 0.2 },
        };
        return m;
      }),
    [seats],
  );
  return (
    <group>
      {seats.map((s, i) => {
        const x = Math.cos(s.a) * s.r;
        const z = Math.sin(s.a) * s.r;
        return (
          <mesh
            key={i}
            position={[x, 0.17, z]}
            rotation={[0, -s.a, Math.PI / 2]}
            scale={[0.2, s.len, 0.2]}
            castShadow
            receiveShadow
            material={mats[i]}
          >
            <cylinderGeometry args={[1, 1, 1, 18, 12]} />
          </mesh>
        );
      })}
    </group>
  );
}

/* Hurricane lanterns: let people see the pile before the fire is lit */
function Lantern({ position, phase = 0 }) {
  const light = useRef();
  const glass = useRef();
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const I = Math.min(1, shared.intensity || 0);
    const f = 0.93 + 0.05 * Math.sin(t * 9 + phase) + 0.02 * Math.sin(t * 23 + phase);
    if (light.current) light.current.intensity = 2.6 * f * (1 - I * 0.45);
    if (glass.current) glass.current.emissiveIntensity = 2.2 * f;
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.03, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.085, 0.06, 16]} />
        <meshStandardMaterial color="#1c1a17" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.15, 0]}>
        <sphereGeometry args={[0.07, 20, 14]} />
        <meshStandardMaterial ref={glass} color="#3a2a18" emissive="#ffb562" emissiveIntensity={2} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.27, 0]}>
        <cylinderGeometry args={[0.035, 0.07, 0.05, 16]} />
        <meshStandardMaterial color="#1c1a17" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.31, 0]} rotation={[0, phase, 0]}>
        <torusGeometry args={[0.06, 0.005, 6, 20, Math.PI]} />
        <meshStandardMaterial color="#2a2722" metalness={0.7} roughness={0.4} />
      </mesh>
      <pointLight ref={light} position={[0, 0.2, 0]} color="#ffae5e" intensity={2.5} decay={1.7} distance={9} />
    </group>
  );
}

export default function Surroundings() {
  return (
    <group>
      <Sky />
      <Moon />
      <Mountains />
      <CloudSea />
      <VillageLights />
      <Ground />
      <Stones />
      <Trees />
      <SeatLogs />
      <Lantern position={[-1.9, 0, 2.6]} phase={0.3} />
      <Lantern position={[2.6, 0, 1.6]} phase={2.1} />
      {/* moonlight */}
      <directionalLight position={[MOON_DIR.x * 60, MOON_DIR.y * 60 + 25, MOON_DIR.z * 60]} intensity={0.9} color="#8ea3cc" />
      <hemisphereLight args={['#2a3a5e', '#0d0a07', 0.9]} />
    </group>
  );
}

import * as THREE from 'three';

let NOISE3D = null;
export function noise3D() {
  if (NOISE3D) return NOISE3D;
  const S = 64;
  const lat = (g) => {
    const a = new Float32Array(g * g * g);
    for (let i = 0; i < a.length; i++) a[i] = Math.random();
    return a;
  };
  const octs = [
    { g: 4, a: 0.5, v: lat(4) },
    { g: 8, a: 0.27, v: lat(8) },
    { g: 16, a: 0.15, v: lat(16) },
    { g: 32, a: 0.08, v: lat(32) },
  ];
  const sm = (t) => t * t * (3 - 2 * t);
  const data = new Uint8Array(S * S * S);
  let k = 0;
  for (let z = 0; z < S; z++)
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        let v = 0;
        let tot = 0;
        for (const { g, a, v: L } of octs) {
          const fx = (x / S) * g;
          const fy = (y / S) * g;
          const fz = (z / S) * g;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const z0 = Math.floor(fz);
          const tx = sm(fx - x0);
          const ty = sm(fy - y0);
          const tz = sm(fz - z0);
          const at = (i, j, l) => L[((l % g) * g + (j % g)) * g + (i % g)];
          const c00 = at(x0, y0, z0) * (1 - tx) + at(x0 + 1, y0, z0) * tx;
          const c10 = at(x0, y0 + 1, z0) * (1 - tx) + at(x0 + 1, y0 + 1, z0) * tx;
          const c01 = at(x0, y0, z0 + 1) * (1 - tx) + at(x0 + 1, y0, z0 + 1) * tx;
          const c11 = at(x0, y0 + 1, z0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1, z0 + 1) * tx;
          const c0 = c00 * (1 - ty) + c10 * ty;
          const c1 = c01 * (1 - ty) + c11 * ty;
          v += (c0 * (1 - tz) + c1 * tz) * a;
          tot += a;
        }
        data[k++] = Math.round((v / tot) * 255);
      }
  const t = new THREE.Data3DTexture(data, S, S, S);
  t.format = THREE.RedFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  NOISE3D = t;
  return t;
}


export const n3Uniform = { value: null };
export function getN3() { if (!n3Uniform.value) n3Uniform.value = noise3D(); return n3Uniform; }

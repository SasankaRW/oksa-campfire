// Deterministic placement of logs in a growing teepee bonfire.
// Every client computes the same slot for the same index, so the pile looks
// identical on every screen without storing positions in the database.
import * as THREE from 'three';

export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function ringCount(k) {
  return 6 + 5 * k;
}

// index -> ring k and position j inside that ring
export function ringOf(index) {
  let k = 0;
  let start = 0;
  while (index >= start + ringCount(k)) {
    start += ringCount(k);
    k++;
  }
  return { k, j: index - start };
}

const _up = new THREE.Vector3(0, 1, 0);

export function slotFor(index) {
  const { k, j } = ringOf(index);
  const h1 = hash(index + 1);
  const h2 = hash(index + 7.3);
  const h3 = hash(index + 19.1);

  const angle = k * 0.9 + j * GOLDEN + (h1 - 0.5) * 0.25;
  const baseR = 0.36 + 0.13 * k + (h2 - 0.5) * 0.06;
  const topR = 0.03 + 0.055 * k + h3 * 0.04;
  const topH = 1.0 + 0.11 * k + (h1 - 0.5) * 0.12;
  const radius = 0.05 + h3 * 0.03 + Math.min(k, 6) * 0.003;

  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  // Top leans to the centre but slightly off-axis so logs cross naturally.
  const twist = (h2 - 0.5) * 0.5;
  const base = new THREE.Vector3(ca * baseR, radius * 0.6, sa * baseR);
  const top = new THREE.Vector3(
    Math.cos(angle + twist) * topR,
    topH,
    Math.sin(angle + twist) * topR,
  );
  // Logs overhang a little past the top contact point.
  const dir = top.clone().sub(base);
  const len = dir.length() * (1.08 + h1 * 0.12);
  dir.normalize();
  const center = base.clone().addScaledVector(dir, len / 2);
  const quat = new THREE.Quaternion().setFromUnitVectors(_up, dir);
  const roll = new THREE.Quaternion().setFromAxisAngle(_up, h3 * Math.PI * 2);
  quat.multiply(roll);

  return {
    index,
    ring: k,
    position: center,
    quaternion: quat,
    scale: new THREE.Vector3(radius, len, radius),
    base,
    top: base.clone().addScaledVector(dir, len),
    dir,
    len,
    radius,
    seed: h1 * 100,
  };
}

// Small sticks at the centre that catch first.
export function kindling() {
  const out = [];
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash(i + 50) * 0.3;
    const r = 0.16 + hash(i + 60) * 0.06;
    const base = new THREE.Vector3(Math.cos(a) * r, 0.02, Math.sin(a) * r);
    const top = new THREE.Vector3(Math.cos(a + 0.6) * 0.02, 0.5 + hash(i + 70) * 0.12, Math.sin(a + 0.6) * 0.02);
    const dir = top.clone().sub(base);
    const len = dir.length() * 1.1;
    dir.normalize();
    const radius = 0.012 + hash(i + 80) * 0.01;
    out.push({
      position: base.clone().addScaledVector(dir, len / 2),
      quaternion: new THREE.Quaternion().setFromUnitVectors(_up, dir),
      scale: new THREE.Vector3(radius, len, radius),
      base,
      dir,
      len,
      radius,
      seed: hash(i + 90) * 100,
    });
  }
  return out;
}

// The torch touches the front of the pile; fire spreads outward from there.
const TOUCH = new THREE.Vector3(0, 0.2, 1.3);
const _slotCache = [];
export function igniteDelay(index) {
  const s = _slotCache[index] || (_slotCache[index] = slotFor(index));
  const d = s.base.distanceTo(TOUCH);
  return 0.5 + Math.max(0, d - 0.15) * 1.75 + hash(index + 3.7) * 1.1;
}

// Outer radius of the pile for a given number of logs (for the torch target).
export function pileRadius(n) {
  if (n <= 0) return 0.22;
  const { k } = ringOf(n - 1);
  return 0.36 + 0.13 * k + 0.06;
}

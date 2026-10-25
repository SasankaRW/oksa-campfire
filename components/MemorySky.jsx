'use client';
// Memory photos as a big framed slideshow up in the night sky, behind the fire.
// Drawn right after the sky, at the very back, so the hills, trees,
// flames and sparks all stay in front of it. Moves every frame from the shared
// slideshow clock, so it glides smoothly and pauses on the same photo everywhere.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/lib/store';
import { shared } from '@/lib/bus';
import { memoriesTime, slidePosition, loadManifest } from '@/lib/memories';

const POOL = 4; // photos drawn at once: previous, current, next, and the one after
const DIST = 40; // how far in front of the camera the slideshow sits
const KEEP = 10; // photo textures kept in memory

const mod = (i, n) => ((i % n) + n) % n;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function hash(n) {
  const s = Math.sin(n * 91.7 + 12.3) * 43758.5453;
  return s - Math.floor(s);
}

/* ---- each photo becomes one texture: wooden frame, cream mat, photo, caption ---- */
const cache = new Map(); // src -> { ready, tex, aspect, used }
function fetchPhoto(p) {
  let e = cache.get(p.src);
  if (e) {
    e.used = performance.now();
    return e;
  }
  e = { ready: false, failed: false, tex: null, aspect: 1.2, used: performance.now() };
  cache.set(p.src, e);
  compose(p)
    .then((r) => {
      if (cache.get(p.src) !== e) return r.tex.dispose();
      Object.assign(e, r, { ready: true });
    })
    .catch(() => (e.failed = true)); // keep the entry so a broken photo is not requested again every frame
  // forget the least recently used photos
  if (cache.size > KEEP) {
    const old = [...cache.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, cache.size - KEEP);
    for (const [src, o] of old) {
      o.tex?.dispose();
      cache.delete(src);
    }
  }
  return e;
}

async function compose({ src, caption }) {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  try {
    await document.fonts?.load('italic 44px "Cormorant Garamond"');
  } catch {}
  const W = 1024;
  const B = 24; // wood
  const M = 20; // mat
  const a = clamp(img.naturalWidth / img.naturalHeight, 0.8, 1.7);
  const pw = W - 2 * (B + M);
  const ph = Math.round(pw / a);
  const cap = caption ? 74 : 0;
  const H = ph + 2 * (B + M) + cap;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  // wooden frame
  const wood = g.createLinearGradient(0, 0, W, H);
  wood.addColorStop(0, '#4a2f18');
  wood.addColorStop(0.45, '#24160b');
  wood.addColorStop(0.7, '#3d2613');
  wood.addColorStop(1, '#1b1008');
  g.fillStyle = wood;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,214,150,0.22)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, W - 2, H - 2);
  // mat
  g.fillStyle = '#efe5cf';
  g.fillRect(B, B, W - 2 * B, H - 2 * B);
  g.strokeStyle = 'rgba(190,150,80,0.9)';
  g.strokeRect(B + 1, B + 1, W - 2 * B - 2, H - 2 * B - 2);
  // photo, cropped to fit
  const ia = img.naturalWidth / img.naturalHeight;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (ia > a) sw = sh * a;
  else sh = sw / a;
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, B + M, B + M, pw, ph);
  g.strokeStyle = 'rgba(60,40,20,0.5)';
  g.strokeRect(B + M, B + M, pw, ph);
  if (caption) {
    g.fillStyle = '#4a3520';
    g.font = 'italic 44px "Cormorant Garamond", Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(caption, W / 2, B + M + ph + cap / 2 + 2, pw);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: W / H };
}

export default function MemorySky() {
  const photos = useRef([]);
  const S = useRef({ k: 0, o: 0 });
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const meshes = useMemo(
    () =>
      Array.from({ length: POOL }, () => {
        // opaque pass (so it draws right after the sky, before the hills and fire),
        // but blended so it can fade in and out
        const mat = new THREE.MeshBasicMaterial({
          fog: false,
          depthTest: true,
          depthFunc: THREE.AlwaysDepth,
          depthWrite: true,
          transparent: false,
          blending: THREE.CustomBlending,
          blendSrc: THREE.SrcAlphaFactor,
          blendDst: THREE.OneMinusSrcAlphaFactor,
          opacity: 0,
        });
        // sit at the very back: drawn over the moon, and the sky glow drawn after
        // it stays behind, while the hills (drawn later, and nearer) and the fire stay in front
        mat.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace(
            '#include <project_vertex>',
            '#include <project_vertex>\n  gl_Position.z = gl_Position.w * 0.99998;',
          );
        };
        const m = new THREE.Mesh(geo, mat);
        m.frustumCulled = false;
        m.visible = false;
        m.renderOrder = -12;
        m.userData = { i: null, r: 0 };
        return m;
      }),
    [geo],
  );

  useEffect(() => {
    loadManifest().then((list) => (photos.current = list));
    return () => {
      meshes.forEach((m) => m.material.dispose());
      geo.dispose();
    };
  }, [meshes, geo]);

  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame((state, dt) => {
    const st = useStore.getState();
    const list = photos.current;
    const n = list.length;
    const t = memoriesTime(st.fire, st.now());
    const on = t !== null && n > 0 && !shared.keepsake;
    const s = S.current;
    s.k += ((on ? 1 : 0) - s.k) * (1 - Math.exp(-dt * (shared.keepsake ? 10 : on ? 1.1 : 1.8)));
    if (t !== null) s.o = slidePosition(t);
    shared.memK = s.k;
    if (s.k < 0.003 || !n) {
      meshes.forEach((m) => (m.visible = false));
      return;
    }

    const cam = state.camera;
    const portrait = cam.aspect < 0.9;
    const Hv = 2 * DIST * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const Wv = Hv * cam.aspect;
    // the space the main photo fits inside, in the upper part of the screen
    const boxW = (portrait ? 0.86 : 0.5) * Wv;
    const boxH = (portrait ? 0.36 : 0.5) * Hv;
    const cy = (portrait ? 0.16 : 0.16) * Hv;
    const gap = portrait ? boxW * 0.95 : boxW * 0.88;
    const tt = t ?? 0;
    const o = s.o;
    const base = Math.floor(o) - 1;

    // warm up the next photos so they are ready before they slide in
    for (let i = base; i <= base + POOL + 1; i++) fetchPhoto(list[mod(i, n)]);

    for (let i = base; i < base + POOL; i++) {
      const m = meshes[mod(i, POOL)];
      const u = m.userData;
      const e = fetchPhoto(list[mod(i, n)]);
      if (u.i !== i) {
        u.i = i;
        u.r = 0;
        m.material.map = null;
      }
      if (e.ready && m.material.map !== e.tex) {
        m.material.map = e.tex;
        m.material.needsUpdate = true;
      }
      u.r += ((e.ready ? 1 : 0) - u.r) * (1 - Math.exp(-dt * 4));
      const rel = i - o;
      const d = Math.min(1, Math.abs(rel));
      const vis = clamp(1.75 - Math.abs(rel), 0, 1);
      const alpha = s.k * vis * u.r;
      m.visible = alpha > 0.003;
      if (!m.visible) continue;
      const w0 = Math.min(boxW, boxH * e.aspect);
      const sc = 1 - 0.24 * d;
      const w = w0 * sc;
      const h = (w0 / e.aspect) * sc;
      const x = rel * gap;
      const y = cy + Math.sin(tt * 0.35 + i * 1.7) * 0.004 * Hv;
      v.set(x, y, -DIST).applyQuaternion(cam.quaternion).add(cam.position);
      m.position.copy(v);
      m.quaternion.copy(cam.quaternion);
      m.rotateZ((hash(i) - 0.5) * 0.035 * (0.4 + d));
      m.scale.set(w, h, 1);
      // dimmed so the bloom does not flare the bright parts; neighbours darker still
      m.material.color.setScalar(0.86 * (1 - 0.55 * d));
      m.material.opacity = alpha;
      // after the moon (-15), before the hills (-10); the centre photo on top of its neighbours
      m.renderOrder = d < 0.5 ? -12 : -13;
    }
  });

  return meshes.map((m, i) => <primitive key={i} object={m} />);
}

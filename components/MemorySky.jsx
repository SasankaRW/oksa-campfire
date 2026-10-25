'use client';
// Memory photos as a big framed slideshow up in the night sky, behind the fire.
// Sits in front of the mountains but behind the clearing, so the ground, rocks,
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

// Styled to match the page: charred wood with a thin gold inlay (the page's
// --gold), a parchment mat lit warm from below, a soft ember glow around the
// frame, and the photo graded warm with darker edges, as if seen by firelight.
const GOLD = '#c9a66b';
async function compose({ src, caption }) {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  try {
    await document.fonts?.load('italic 44px "Cormorant Garamond"');
  } catch {}
  const W = 1024;
  const P = 36; // clear space around the frame for the ember glow
  const B = 26; // wood
  const M = 18; // mat
  const a = clamp(img.naturalWidth / img.naturalHeight, 0.8, 1.7);
  const fw = W - 2 * P; // frame width
  const pw = fw - 2 * (B + M);
  const ph = Math.round(pw / a);
  const cap = caption ? 70 : 0;
  const fh = ph + 2 * (B + M) + cap;
  const H = fh + 2 * P;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const fx = P;
  const fy = P;

  // ember glow behind the frame
  g.save();
  g.shadowColor = 'rgba(255,122,42,0.42)';
  g.shadowBlur = 30;
  g.shadowOffsetY = 6;
  g.fillStyle = '#140c06';
  g.fillRect(fx, fy, fw, fh);
  g.restore();

  // charred wood, a little lighter at the bottom where the fire catches it
  const wood = g.createLinearGradient(0, fy, 0, fy + fh);
  wood.addColorStop(0, '#1a100a');
  wood.addColorStop(0.55, '#24160c');
  wood.addColorStop(1, '#3a2312');
  g.fillStyle = wood;
  g.fillRect(fx, fy, fw, fh);
  // fine grain
  g.globalAlpha = 0.18;
  for (let i = 0; i < 70; i++) {
    const y = fy + hash(i + 400) * fh;
    g.fillStyle = hash(i + 500) > 0.5 ? '#000' : '#5a3a1e';
    g.fillRect(fx, y, fw, 1 + hash(i + 600) * 1.5);
  }
  g.globalAlpha = 1;
  // gold inlay, and a faint warm edge
  g.strokeStyle = 'rgba(255,190,120,0.25)';
  g.lineWidth = 2;
  g.strokeRect(fx + 1, fy + 1, fw - 2, fh - 2);
  g.strokeStyle = GOLD;
  g.lineWidth = 2.5;
  g.strokeRect(fx + B * 0.45, fy + B * 0.45, fw - B * 0.9, fh - B * 0.9);
  // small gold corner studs
  g.fillStyle = GOLD;
  for (const [cx, cy] of [
    [fx + B * 0.45, fy + B * 0.45],
    [fx + fw - B * 0.45, fy + B * 0.45],
    [fx + B * 0.45, fy + fh - B * 0.45],
    [fx + fw - B * 0.45, fy + fh - B * 0.45],
  ]) {
    g.beginPath();
    g.arc(cx, cy, 5, 0, Math.PI * 2);
    g.fill();
  }

  // parchment mat, lit warm from below
  const mx = fx + B;
  const my = fy + B;
  const mw = fw - 2 * B;
  const mh = fh - 2 * B;
  const mat = g.createLinearGradient(0, my, 0, my + mh);
  mat.addColorStop(0, '#cbb48a');
  mat.addColorStop(1, '#ead2a0');
  g.fillStyle = mat;
  g.fillRect(mx, my, mw, mh);
  g.strokeStyle = 'rgba(0,0,0,0.45)';
  g.lineWidth = 3;
  g.strokeRect(mx + 1.5, my + 1.5, mw - 3, mh - 3);

  // photo, cropped to fit
  const px = mx + M;
  const py = my + M;
  const ia = img.naturalWidth / img.naturalHeight;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (ia > a) sw = sh * a;
  else sh = sw / a;
  g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, px, py, pw, ph);
  // firelight grade: warm tint, a glow from below, darker edges
  g.save();
  g.beginPath();
  g.rect(px, py, pw, ph);
  g.clip();
  g.globalCompositeOperation = 'soft-light';
  g.fillStyle = 'rgba(255,150,70,0.35)';
  g.fillRect(px, py, pw, ph);
  g.globalCompositeOperation = 'screen';
  const low = g.createLinearGradient(0, py + ph, 0, py + ph * 0.5);
  low.addColorStop(0, 'rgba(255,122,42,0.16)');
  low.addColorStop(1, 'rgba(255,122,42,0)');
  g.fillStyle = low;
  g.fillRect(px, py, pw, ph);
  g.globalCompositeOperation = 'multiply';
  const vig = g.createRadialGradient(px + pw / 2, py + ph * 0.55, Math.min(pw, ph) * 0.35, px + pw / 2, py + ph / 2, Math.hypot(pw, ph) * 0.6);
  vig.addColorStop(0, 'rgba(255,255,255,1)');
  vig.addColorStop(1, 'rgba(70,40,18,1)');
  g.fillStyle = vig;
  g.fillRect(px, py, pw, ph);
  g.restore();
  g.strokeStyle = GOLD;
  g.lineWidth = 2;
  g.strokeRect(px - 1, py - 1, pw + 2, ph + 2);

  if (caption) {
    g.fillStyle = '#4a2f16';
    g.font = 'italic 44px "Cormorant Garamond", Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(caption, W / 2, py + ph + cap / 2 + 2, pw);
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
        const mat = new THREE.MeshBasicMaterial({
          fog: false,
          transparent: true,
          depthTest: true,
          depthWrite: false,
          opacity: 0,
        });
        // tested at the depth of something ~300 m away and drawn after the far
        // landscape: so it covers the moon, mountains, cloud sea and village lights,
        // while the clearing, rocks and trees (nearer) and the fire (drawn later) stay in front
        mat.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace(
            '#include <project_vertex>',
            '#include <project_vertex>\n  gl_Position.z = gl_Position.w * 0.999;',
          );
        };
        const m = new THREE.Mesh(geo, mat);
        m.frustumCulled = false;
        m.visible = false;
        m.renderOrder = -6;
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
    const boxW = (portrait ? 0.94 : 0.68) * Wv;
    const boxH = (portrait ? 0.5 : 0.7) * Hv;
    const cy = (portrait ? 0.1 : 0.07) * Hv;
    const gap = portrait ? boxW * 0.95 : boxW * 0.9;
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
      // warm firelight on the photos, flickering a little with the fire; kept
      // below full brightness so the bloom does not flare; neighbours darker still
      const fl = 0.95 + 0.05 * Math.sin(state.clock.elapsedTime * 7.3) * Math.sin(state.clock.elapsedTime * 3.1 + 1);
      const b = 0.9 * fl * (0.86 + 0.1 * Math.min(1, shared.intensity || 0)) * (1 - 0.55 * d);
      m.material.color.setRGB(b, b * 0.95, b * 0.88);
      m.material.opacity = alpha;
      m.renderOrder = d < 0.5 ? -6 : -7; // after the village lights (-8); centre photo on top
    }
  });

  return meshes.map((m, i) => <primitive key={i} object={m} />);
}

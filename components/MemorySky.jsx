'use client';
// Memory photos as a big frameless slideshow up in the night sky, behind the fire.
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
const PHOTO_DEPTH = 62; // metres: the depth the photos are tested at (see below)

const mod = (i, n) => ((i % n) + n) % n;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/* ---- each photo becomes one texture: wooden frame, cream mat, photo, caption ---- */
const cache = new Map(); // src -> { ready, tex, aspect, used }
function fetchPhoto(p) {
  let e = cache.get(p.src);
  if (e) {
    e.used = performance.now();
    return e;
  }
  e = { ready: false, failed: false, tex: null, aspect: 1.2, inner: 1, photo: 1.2, used: performance.now() };
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

// No frame: the photo's edges fade softly into the night sky, over a big
// blurred glow of the same photo, like light spilling out of it.
const canvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
// Fade a layer's alpha to nothing over `f` px at every edge.
function feather(g, w, h, f) {
  g.globalCompositeOperation = 'destination-in';
  for (const [len, grad] of [
    [w, g.createLinearGradient(0, 0, w, 0)],
    [h, g.createLinearGradient(0, 0, 0, h)],
  ]) {
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(f / len, 'rgba(0,0,0,1)');
    grad.addColorStop(1 - f / len, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }
  g.globalCompositeOperation = 'source-over';
}
async function compose({ src, caption }) {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  if (caption) {
    try {
      await document.fonts?.load('italic 40px "Cormorant Garamond"');
    } catch {}
  }
  const W = 1024;
  const P = 150; // room around the photo for the glow
  const a = clamp(img.naturalWidth / img.naturalHeight, 0.8, 1.7);
  const pw = W - 2 * P;
  const ph = Math.round(pw / a);
  const H = ph + 2 * P;
  const ia = img.naturalWidth / img.naturalHeight;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (ia > a) sw = sh * a;
  else sh = sw / a;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;

  const c = canvas(W, H);
  const g = c.getContext('2d');

  // glow: the photo shrunk to a few pixels and stretched back up (a cheap blur
  // that works in every browser), spread past the edges and faded out
  const tiny = canvas(24, Math.max(8, Math.round(24 / a)));
  tiny.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, tiny.width, tiny.height);
  const glow = canvas(W, H);
  const gg = glow.getContext('2d');
  gg.imageSmoothingQuality = 'high';
  gg.drawImage(tiny, P * 0.35, P * 0.35, W - P * 0.7, H - P * 0.7);
  feather(gg, W, H, P * 0.95);
  g.globalAlpha = 0.6;
  g.drawImage(glow, 0, 0);
  g.globalAlpha = 1;

  // the photo, sharp in the middle, melting into the glow at its edges
  const pc = canvas(pw, ph);
  const pg = pc.getContext('2d');
  pg.drawImage(img, sx, sy, sw, sh, 0, 0, pw, ph);
  if (caption) {
    const fade = pg.createLinearGradient(0, ph, 0, ph - 170);
    fade.addColorStop(0, 'rgba(0,0,0,0.55)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    pg.fillStyle = fade;
    pg.fillRect(0, ph - 170, pw, 170);
    pg.fillStyle = 'rgba(255,245,230,0.95)';
    pg.font = 'italic 40px "Cormorant Garamond", Georgia, serif';
    pg.textAlign = 'center';
    pg.fillText(caption, pw / 2, ph - 70, pw - 160);
  }
  feather(pg, pw, ph, Math.round(Math.min(pw, ph) * 0.12));
  g.drawImage(pc, P, P);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // inner: the share of the texture's width the photo itself takes up
  return { tex, aspect: W / H, inner: pw / W, photo: pw / ph };
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
        // depth-tested as if PHOTO_DEPTH m away and drawn after the far landscape:
        // past the clearing (ground ends ~55 m) but before the nearest mountains
        // (70 m), so it covers the moon, mountains, cloud sea and village lights,
        // while the ground, rocks, trees and fire stay in front
        mat.onBeforeCompile = (sh) => {
          sh.vertexShader = sh.vertexShader.replace(
            '#include <project_vertex>',
            `#include <project_vertex>
  gl_Position.z = (projectionMatrix[2][2] * -${PHOTO_DEPTH.toFixed(1)} + projectionMatrix[3][2]) / ${PHOTO_DEPTH.toFixed(1)} * gl_Position.w;`,
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
      // fit the photo itself in the box; the glow spills out around it
      const w0 = Math.min(boxW, boxH * e.photo) / e.inner;
      const sc = 1 - 0.24 * d;
      const w = w0 * sc;
      const h = (w0 / e.aspect) * sc;
      const x = rel * gap;
      const y = cy + Math.sin(tt * 0.35 + i * 1.7) * 0.004 * Hv;
      v.set(x, y, -DIST).applyQuaternion(cam.quaternion).add(cam.position);
      m.position.copy(v);
      m.quaternion.copy(cam.quaternion);
      m.scale.set(w, h, 1);
      // kept a little below full brightness so the bloom does not flare; neighbours dimmer
      const b = 0.88 * (1 - 0.55 * d);
      m.material.color.setRGB(b, b * 0.97, b * 0.93);
      m.material.opacity = alpha;
      m.renderOrder = d < 0.5 ? -6 : -7; // after the village lights (-8); centre photo on top
    }
  });

  return meshes.map((m, i) => <primitive key={i} object={m} />);
}

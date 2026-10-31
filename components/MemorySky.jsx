'use client';
// Memory photos as a row sliding steadily across the night sky, behind the fire.
// Sits in front of the mountains but behind the clearing, so the ground, rocks,
// flames and sparks all stay in front of it. Moves every frame from the shared
// slideshow clock, so it glides smoothly and pauses on the same frame everywhere.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '@/lib/store';
import { shared } from '@/lib/bus';
import { memoriesTime, slidePosition, loadManifest } from '@/lib/memories';

const POOL = 10; // most photos on screen at once (the row is cut to fit)
const DIST = 40; // how far in front of the camera the slideshow sits
const KEEP = 14; // photo textures kept in memory
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

// Minimal: the photo with rounded corners and one very thin light border.
const canvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
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
  const P = 4; // a few clear pixels so the border edge stays smooth
  const R = 28; // corner radius
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

  // the photo, clipped to the rounded corners
  g.save();
  roundRect(g, P, P, pw, ph, R);
  g.clip();
  g.drawImage(img, sx, sy, sw, sh, P, P, pw, ph);
  if (caption) {
    // a dark fade at the bottom so the caption reads on any photo
    const fade = g.createLinearGradient(0, P + ph, 0, P + ph - 170);
    fade.addColorStop(0, 'rgba(0,0,0,0.55)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(P, P + ph - 170, pw, 170);
    g.fillStyle = 'rgba(255,245,230,0.95)';
    g.font = 'italic 40px "Cormorant Garamond", Georgia, serif';
    g.textAlign = 'center';
    g.fillText(caption, W / 2, P + ph - 50, pw - 120);
  }
  g.restore();

  // very thin light border
  roundRect(g, P + 1, P + 1, pw - 2, ph - 2, R - 1);
  g.strokeStyle = 'rgba(255,244,230,0.7)';
  g.lineWidth = 2;
  g.stroke();

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
    // every photo gets the same slot in the row and fits inside it
    const rowH = (portrait ? 0.3 : 0.44) * Hv;
    const slot = Math.min(rowH * 1.55, (portrait ? 0.82 : 0.5) * Wv);
    const cy = (portrait ? 0.12 : 0.08) * Hv;
    const tt = t ?? 0;
    const o = s.o;
    // photos whose slot touches the screen, plus one either side
    const reach = Math.min(Math.floor(POOL / 2) - 1, Math.ceil(Wv / 2 / slot) + 1);
    const base = Math.floor(o) - reach;
    const last = Math.floor(o) + reach;

    // warm up the next photos so they are ready before they slide in
    for (let i = base; i <= last + 2; i++) fetchPhoto(list[mod(i, n)]);

    meshes.forEach((m) => (m.visible = false));
    for (let i = base; i <= last; i++) {
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
      const x = (i - o) * slot;
      // fade out softly at the screen edges
      const edge = clamp((Wv / 2 + slot * 0.2 - Math.abs(x)) / (slot * 0.7), 0, 1);
      const alpha = s.k * edge * u.r;
      m.visible = alpha > 0.003;
      if (!m.visible) continue;
      // fit the photo itself inside its slot (a small gap between neighbours)
      const pw = Math.min(slot * 0.9, rowH * e.photo);
      const w = pw / e.inner;
      const h = w / e.aspect;
      const y = cy + Math.sin(tt * 0.35 + i * 1.7) * 0.004 * Hv;
      v.set(x, y, -DIST).applyQuaternion(cam.quaternion).add(cam.position);
      m.position.copy(v);
      m.quaternion.copy(cam.quaternion);
      m.scale.set(w, h, 1);
      // kept a little below full brightness so the bloom does not flare
      const b = 0.82;
      m.material.color.setRGB(b, b * 0.97, b * 0.93);
      m.material.opacity = alpha;
      m.renderOrder = -6; // after the village lights (-8)
    }
  });

  return meshes.map((m, i) => <primitive key={i} object={m} />);
}

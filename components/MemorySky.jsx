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
import { memoriesTime, rowTarget, loadManifest } from '@/lib/memories';

const POOL = 10; // most photos on screen at once (the row is cut to fit)
const DIST = 40; // how far in front of the camera the slideshow sits
const PHOTO_DEPTH = 62; // metres: the depth the photos are tested at (see below)
// photo textures kept in memory, and their width; phones keep fewer, smaller ones
// (never fewer than the row needs, see trimCache)
const cfg = { keep: 14, W: 1024 };
const VIDEO_TIMEOUT = 8000; // a clip that has not loaded by then counts as broken
const PLAY_RETRY = 2000; // ms between attempts to start a paused clip

// every slideshow material has a map from the start, so swapping photos in
// never needs a new shader
const BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
BLANK.colorSpace = THREE.SRGBColorSpace;
BLANK.needsUpdate = true;

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
      if (cache.get(p.src) !== e) {
        dropVideo(r.video);
        return r.tex.dispose();
      }
      Object.assign(e, r, { ready: true });
      if (r.video) watchFrames(e);
    })
    .catch(() => (e.failed = true)); // keep the entry so a broken photo is not requested again every frame
  return e;
}

// Forget the least recently used photos. Runs once a frame, after every photo the
// row needs has been asked for, so a photo on screen is never the one dropped.
function trimCache(need) {
  const keep = Math.max(cfg.keep, need);
  if (cache.size <= keep) return;
  const old = [...cache.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, cache.size - keep);
  for (const [src, o] of old) {
    o.dropped = true;
    o.tex?.dispose();
    dropVideo(o.video);
    cache.delete(src);
  }
}

// Marks a clip's texture as stale whenever the video shows a new frame, where the
// browser supports telling us (otherwise updateVideos checks ~30 times a second).
function watchFrames(e) {
  const el = e.video;
  if (!el?.requestVideoFrameCallback) return;
  const onFrame = () => {
    if (e.dropped) return;
    e.rvfc = true;
    e.dirty = true;
    el.requestVideoFrameCallback(onFrame);
  };
  el.requestVideoFrameCallback(onFrame);
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
// A video clip: muted, inline and looping, so phones let it play on its own.
async function loadVideo(src) {
  const el = document.createElement('video');
  el.muted = true;
  el.defaultMuted = true;
  el.playsInline = true;
  el.setAttribute('playsinline', '');
  el.loop = true;
  el.preload = 'auto';
  el.src = src;
  try {
    await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error('video timed out')), VIDEO_TIMEOUT);
      el.addEventListener(
        'loadeddata',
        () => {
          clearTimeout(timer);
          res();
        },
        { once: true },
      );
      el.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          rej(new Error('video failed'));
        },
        { once: true },
      );
      el.load();
      el.play().catch(() => {}); // some phones only fetch the first frame once playing
    });
  } catch (err) {
    dropVideo(el); // stop the download
    throw err;
  }
  el.pause();
  return el;
}
function dropVideo(el) {
  if (!el) return;
  el.pause();
  el.removeAttribute('src');
  el.load();
}

async function compose({ src, caption, video }) {
  let img;
  let nw;
  let nh;
  if (video) {
    img = await loadVideo(src);
    nw = img.videoWidth;
    nh = img.videoHeight;
  } else {
    img = new Image();
    img.decoding = 'async';
    img.src = src;
    await img.decode();
    nw = img.naturalWidth;
    nh = img.naturalHeight;
  }
  if (caption) {
    try {
      await document.fonts?.load('italic 40px "Cormorant Garamond"');
    } catch {}
  }
  const W = cfg.W;
  const k = W / 1024; // sizes below are for a 1024 px wide texture
  const P = 4; // a few clear pixels so the border edge stays smooth
  const R = 28 * k; // corner radius
  const a = clamp(nw / nh, 0.8, 1.7);
  const pw = W - 2 * P;
  const ph = Math.round(pw / a);
  const H = ph + 2 * P;
  const ia = nw / nh;
  let sw = nw;
  let sh = nh;
  if (ia > a) sw = sh * a;
  else sh = sw / a;
  const sx = (nw - sw) / 2;
  const sy = (nh - sh) / 2;

  const c = canvas(W, H);
  const g = c.getContext('2d');

  // drawn once for a photo, and again for each new frame of a video
  const draw = () => {
    g.clearRect(0, 0, W, H);
    // the photo, clipped to the rounded corners
    g.save();
    roundRect(g, P, P, pw, ph, R);
    g.clip();
    g.drawImage(img, sx, sy, sw, sh, P, P, pw, ph);
    if (caption) {
      // a dark fade at the bottom so the caption reads on any photo
      const fade = g.createLinearGradient(0, P + ph, 0, P + ph - 170 * k);
      fade.addColorStop(0, 'rgba(0,0,0,0.55)');
      fade.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = fade;
      g.fillRect(P, P + ph - 170 * k, pw, 170 * k);
      g.fillStyle = 'rgba(255,245,230,0.95)';
      g.font = `italic ${Math.round(40 * k)}px "Cormorant Garamond", Georgia, serif`;
      g.textAlign = 'center';
      g.fillText(caption, W / 2, P + ph - 50 * k, pw - 120 * k);
    }
    g.restore();

    // very thin light border
    roundRect(g, P + 1, P + 1, pw - 2, ph - 2, R - 1);
    g.strokeStyle = 'rgba(255,244,230,0.7)';
    g.lineWidth = 2;
    g.stroke();
  };
  draw();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 1;
  if (video) {
    // redrawn many times a second: skip building mipmaps on every upload
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
  }
  // inner: the share of the texture's width the photo itself takes up
  return { tex, aspect: W / H, inner: pw / W, photo: pw / ph, video: video ? img : null, draw };
}

// Videos play only while they are on screen, and their frames are copied into the texture.
function updateVideos(showing) {
  const now = performance.now();
  for (const e of cache.values()) {
    const el = e.video;
    if (!el) continue;
    if (showing?.has(e)) {
      if (el.paused && !(now - (e.triedPlay || 0) < PLAY_RETRY)) {
        e.triedPlay = now;
        el.play().catch(() => {});
      }
      // a new video frame: told by the browser, or else checked at most 30 times a second
      const fresh = e.rvfc ? e.dirty : el.currentTime !== e.lastT && now - (e.drawnAt || 0) >= 33;
      if (fresh) {
        e.dirty = false;
        e.lastT = el.currentTime;
        e.drawnAt = now;
        e.draw();
        e.tex.needsUpdate = true;
      }
    } else if (!el.paused) el.pause();
  }
}
const showing = new Set(); // reused every frame

export default function MemorySky({ quality = 'high' }) {
  // phones: fewer, smaller photo textures
  cfg.keep = quality === 'high' ? 14 : 8;
  cfg.W = quality === 'high' ? 1024 : 768;
  const photos = useRef([]);
  const S = useRef({ k: 0, o: 0, f: 0, init: false });
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
          map: BLANK,
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
      updateVideos(null);
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
    const paused = !!st.fire.memories_paused_at;
    if (t !== null) {
      // glide toward the shared position instead of snapping to it, so a late
      // pause message or a clock correction never makes the row jump
      const target = rowTarget(st.fire, st.now());
      if (!s.init || Math.abs(target - s.o) > 3) s.o = target;
      else s.o += (target - s.o) * (1 - Math.exp(-dt * (paused ? 2.6 : 5)));
      s.init = true;
    } else s.init = false;
    // focus: the centre photo grows and the others step back while paused
    s.f += ((paused && t !== null ? 1 : 0) - s.f) * (1 - Math.exp(-dt * 2.6));
    shared.memK = s.k;
    if (s.k < 0.003 || !n) {
      for (const m of meshes) m.visible = false;
      updateVideos(null);
      return;
    }

    const cam = state.camera;
    const portrait = cam.aspect < 0.9;
    const Hv = 2 * DIST * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const Wv = Hv * cam.aspect;
    // every photo gets the same slot in the row and fits inside it
    const rowH = (portrait ? 0.36 : 0.52) * Hv;
    const slot = Math.min(rowH * 1.55, (portrait ? 0.86 : 0.52) * Wv);
    // the box the focused photo grows into when paused
    const focusW = (portrait ? 0.94 : 0.66) * Wv;
    const focusH = (portrait ? 0.55 : 0.74) * Hv;
    const cy = (portrait ? 0.12 : 0.08) * Hv;
    const tt = t ?? 0;
    const o = s.o;
    const f = s.f;
    // photos whose slot touches the screen, plus one either side
    const reach = Math.min(Math.floor(POOL / 2) - 1, Math.ceil(Wv / 2 / slot) + 1);
    const base = Math.floor(o) - reach;
    const last = Math.floor(o) + reach;

    // warm up the next photos so they are ready before they slide in
    for (let i = base; i <= last + 2; i++) fetchPhoto(list[mod(i, n)]);
    trimCache(last - base + 3 + 1); // the photos asked for above, and one to spare

    // how much the neighbours move aside to make room for the focused photo
    const ce = fetchPhoto(list[mod(Math.round(o), n)]);
    const cpw = Math.min(slot * 0.9, rowH * ce.photo);
    const cfw = Math.min(focusW, focusH * ce.photo);
    const push = f * Math.max(0, (cfw - cpw) / 2 + slot * 0.05);

    for (const m of meshes) m.visible = false;
    showing.clear();
    for (let i = base; i <= last; i++) {
      const m = meshes[mod(i, POOL)];
      const u = m.userData;
      const e = fetchPhoto(list[mod(i, n)]);
      if (u.i !== i) {
        u.i = i;
        u.r = 0;
        m.material.map = BLANK;
      }
      if (e.ready && m.material.map !== e.tex) m.material.map = e.tex;
      u.r += ((e.ready ? 1 : 0) - u.r) * (1 - Math.exp(-dt * 4));
      const rel = i - o;
      const c = clamp(1 - Math.abs(rel), 0, 1); // 1 = this photo is in the middle
      const x = rel * slot + push * clamp(rel * 2, -1, 1);
      // fade out softly at the screen edges
      const edge = clamp((Wv / 2 + slot * 0.2 - Math.abs(x)) / (slot * 0.7), 0, 1);
      const alpha = s.k * edge * u.r * (1 - 0.45 * f * (1 - c));
      m.visible = alpha > 0.003;
      if (!m.visible) continue;
      if (e.video) showing.add(e);
      // fit the photo inside its slot (a small gap between neighbours), or the focus box
      const pw0 = Math.min(slot * 0.9, rowH * e.photo);
      const pw1 = Math.min(focusW, focusH * e.photo);
      const pw = pw0 + (pw1 - pw0) * f * c;
      const w = pw / e.inner;
      const h = w / e.aspect;
      const y = cy + Math.sin(tt * 0.35 + i * 1.7) * 0.004 * Hv * (1 - f);
      v.set(x, y, -DIST).applyQuaternion(cam.quaternion).add(cam.position);
      m.position.copy(v);
      m.quaternion.copy(cam.quaternion);
      m.scale.set(w, h, 1);
      // kept below full brightness so the bloom does not flare; others dim while one is focused
      const b = (0.82 + 0.06 * f * c) * (1 - 0.6 * f * (1 - c));
      m.material.color.setRGB(b, b * 0.97, b * 0.93);
      m.material.opacity = alpha;
      m.renderOrder = c > 0.5 ? -6 : -7; // after the village lights (-8); the middle photo on top
    }
    updateVideos(showing);
  });

  return meshes.map((m, i) => <primitive key={i} object={m} />);
}

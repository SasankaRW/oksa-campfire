// Shared timing for the memory slideshow in the sky. Every screen works out
// the same position from the same server timestamps, so everyone sees the
// same photo at the same moment, and a pause freezes everyone on the same frame.
export const SLIDE = 7; // seconds per photo
export const MOVE = 1.4; // seconds of each slide's glide to the next photo

// Seconds of slideshow played so far (frozen while paused), or null when off.
export function memoriesTime(fire, now) {
  if (!fire?.memories_at) return null;
  const end = fire.memories_paused_at || now;
  return (end - fire.memories_at) / 1000;
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// Slideshow position: 0 = first photo centred, 1.5 = halfway between the second and third.
export function slidePosition(t) {
  if (t === null || t <= 0) return 0;
  const n = Math.floor(t / SLIDE);
  const f = t - n * SLIDE;
  const p = f < SLIDE - MOVE ? 0 : ease((f - (SLIDE - MOVE)) / MOVE);
  return n + p;
}

let manifest = null;
export function loadManifest() {
  if (!manifest) {
    manifest = fetch('/memories/manifest.json')
      .then((r) => r.json())
      .then((j) => j.photos || [])
      .catch(() => {
        manifest = null;
        return [];
      });
  }
  return manifest;
}

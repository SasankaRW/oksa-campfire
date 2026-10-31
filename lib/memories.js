// Shared timing for the memory slideshow in the sky. Every screen works out
// the same position from the same server timestamps, so everyone sees the
// same photos at the same moment, and a pause freezes everyone on the same frame.
export const PER_PHOTO = 6; // seconds for the row to move along by one photo

// Seconds of slideshow played so far (frozen while paused), or null when off.
export function memoriesTime(fire, now) {
  if (!fire?.memories_at) return null;
  const end = fire.memories_paused_at || now;
  return (end - fire.memories_at) / 1000;
}

// Row position in photos: 0 = first photo centred, 1.5 = halfway from the second to the third.
// Moves at a steady speed, so the whole row keeps sliding without stopping.
export function slidePosition(t) {
  if (t === null || t <= 0) return 0;
  return t / PER_PHOTO;
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

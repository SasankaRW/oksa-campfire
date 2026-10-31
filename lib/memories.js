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

// The photo everyone is (or will be) looking at: the one nearest the middle of the row.
// When paused, every screen glides this photo to the centre and enlarges it.
export function centreIndex(fire, now) {
  const t = memoriesTime(fire, now);
  return t === null ? null : Math.max(0, Math.round(slidePosition(t)));
}

// Where the row should be drawn: steady while playing, settled on the centre photo while paused.
export function rowTarget(fire, now) {
  const t = memoriesTime(fire, now);
  if (t === null) return null;
  return fire.memories_paused_at ? centreIndex(fire, now) : slidePosition(t);
}

// New start time on resume, so the row carries on from the photo it was paused on
// (instead of jumping back to where it was a moment before the pause).
export function resumeStart(memoriesAt, pausedAt, now) {
  const at = Math.max(0, Math.round(slidePosition((pausedAt - memoriesAt) / 1000)));
  return now - at * PER_PHOTO * 1000;
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

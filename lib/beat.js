'use client';
// A shared, gentle beat for sing-alongs. Every screen counts from the same
// server timestamp (song_at), so the fire, the notes and the camera sway pulse
// together for everyone.
import { useStore } from './store';
import { toScene } from './clock';

export const SONG_BPM = 100;
export const BEAT = 60 / SONG_BPM; // seconds

// now: scene seconds. Returns null when no song is on.
export function songBeat(now) {
  const f = useStore.getState().fire;
  if (!f.song_at) return null;
  const t = now - toScene(f.song_at);
  if (t < 0) return null;
  const b = t / BEAT;
  return { t, beat: Math.floor(b), phase: b - Math.floor(b) };
}

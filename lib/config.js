// Edit these to change the wording on screen.
export const EVENT = {
  org: "Kingswood Old Scouts' Association",
  title: 'The Campfire',
  year: '2026',
  waiting: 'The fire is yet to be lit. Lay your log.',
  lit: 'The fire is lit.',
  embers: 'The fire burns low.',
  keepsakeLine: 'I laid a log in the fire',
};
export const MAX_NAME = 32;
export const MAX_BATCH = 4;
export const MAX_MESSAGE = 48;
export const COUNTDOWN_SECONDS = 10;
// Longest countdown the fire keeper can set (seconds).
export const MAX_COUNTDOWN_SECONDS = 2 * 60 * 60;

// 75 -> "1:15", 3725 -> "1:02:05"
export function formatCountdown(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

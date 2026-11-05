// Tiny deterministic pseudo-random hash (0..1). Kept in its own file, free of
// three.js, so UI code can use it without pulling the 3D engine into the first load.
export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

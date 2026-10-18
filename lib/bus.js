// Tiny event bus for one-off scene events (log landed, burst, etc).
const subs = new Map();
export function on(type, fn) {
  if (!subs.has(type)) subs.set(type, new Set());
  subs.get(type).add(fn);
  return () => subs.get(type).delete(fn);
}
export function emit(type, payload) {
  subs.get(type)?.forEach((fn) => fn(payload));
}
// Shared mutable refs between components (no re-render).
export const shared = {
  hand: null, // { position: Vector3, quaternion: Quaternion } of the log in your hand
  intensity: 0,
  lit: false,
  zoom: 1, // 0.45 (close) .. 1.8 (far)
};
export function setZoom(z) {
  shared.zoom = Math.max(0.45, Math.min(1.8, z));
}

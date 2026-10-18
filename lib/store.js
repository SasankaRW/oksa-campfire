'use client';
import { create } from 'zustand';

// All timestamps are milliseconds on the *server* clock.
// `offset` corrects this device's clock so everyone's fire is in sync.
export const useStore = create((set, get) => ({
  ready: false,
  demo: false,
  offset: 0,
  deviceId: null,
  profile: null, // { name, batch, message }
  logs: [], // sorted by created_at, hidden removed
  fire: { ignite_at: null, stoke_at: null, mode: 'normal', reset_at: null },
  online: 1,
  feed: [], // { id, text, at }
  arrivals: {}, // logId -> { from:[x,y,z], quat:[x,y,z,w], at }
  pendingThrow: null, // own log in flight before server confirms
  soundOn: false,
  leaders: [], // public: { slot, name, title, called_at, laid_at } (ms)
  adminLeaders: [], // admin only, includes tokens
  setLeaders: (leaders) => set({ leaders }),
  focusMine: 0,

  now: () => Date.now() + get().offset,

  setLogs: (logs) => set({ logs: sortLogs(logs) }),
  upsertLog: (log) => {
    const logs = get().logs.filter((l) => l.id !== log.id);
    if (!log.hidden) logs.push(log);
    const isNew = !get().logs.some((l) => l.id === log.id);
    set({ logs: sortLogs(logs) });
    if (isNew && !log.hidden) {
      const by = log.batch ? `${log.name} · '${String(log.batch).slice(-2)}` : log.name;
      get().pushFeed(`${by} laid a log${log.message ? ` — “${log.message}”` : ''}`);
    }
  },
  removeLog: (id) => set({ logs: get().logs.filter((l) => l.id !== id) }),
  setFire: (fire) => set({ fire: { ...get().fire, ...fire } }),
  pushFeed: (text) => {
    const item = { id: Math.random().toString(36).slice(2), text, at: Date.now() };
    set({ feed: [...get().feed, item].slice(-6) });
  },
  setArrival: (id, a) => set({ arrivals: { ...get().arrivals, [id]: a } }),
}));

function sortLogs(logs) {
  return [...logs].sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
}

export function myLog() {
  const s = useStore.getState();
  return s.logs.find((l) => l.device_id === s.deviceId) || null;
}

export function getDeviceId() {
  try {
    let id = localStorage.getItem('campfire.device');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('campfire.device', id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem('campfire.profile') || 'null');
    return p && p.name ? p : null;
  } catch {
    return null;
  }
}

export function saveProfile(p) {
  try {
    localStorage.setItem('campfire.profile', JSON.stringify(p));
  } catch {}
}

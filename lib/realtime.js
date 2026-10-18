'use client';
// Connects the page to shared state. Uses Supabase when configured,
// otherwise a local demo mode that syncs between tabs of one browser.
import { createClient } from '@supabase/supabase-js';
import { useStore, getDeviceId } from './store';
import { DEMO_NAMES } from './demoNames';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const IS_DEMO = !URL || !ANON;

let started = false;
let supabase = null;
let pollTimer = null;

const toRow = (r) => ({
  id: r.id,
  device_id: r.device_id,
  name: r.name,
  batch: r.batch || '',
  message: r.message || '',
  created_at: typeof r.created_at === 'number' ? r.created_at : Date.parse(r.created_at),
  hidden: !!r.hidden,
});
const toFire = (f) => ({
  ignite_at: f.ignite_at ? Date.parse(f.ignite_at) : null,
  stoke_at: f.stoke_at ? Date.parse(f.stoke_at) : null,
  mode: f.mode || 'normal',
  reset_at: f.reset_at ? Date.parse(f.reset_at) : null,
});

export async function startRealtime() {
  if (started) return;
  started = true;
  const s = useStore.getState();
  const deviceId = getDeviceId();
  useStore.setState({ deviceId, demo: IS_DEMO });
  if (IS_DEMO) return startDemo(deviceId);

  supabase = createClient(URL, ANON, { realtime: { params: { eventsPerSecond: 20 } } });
  await syncClock();
  await fetchAll();
  useStore.setState({ ready: true });

  let subscribed = false;
  const channel = supabase
    .channel('campfire', { config: { presence: { key: deviceId } } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'logs' }, (p) => {
      if (p.eventType === 'DELETE') useStore.getState().removeLog(p.old.id);
      else useStore.getState().upsertLog(toRow(p.new));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fire_state' }, (p) => {
      if (!p.new) return;
      const prev = useStore.getState().fire;
      const next = toFire(p.new);
      useStore.getState().setFire(next);
      if (next.reset_at !== prev.reset_at) fetchAll();
    })
    .on('presence', { event: 'sync' }, () => {
      useStore.setState({ online: Math.max(1, Object.keys(channel.presenceState()).length) });
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        stopPolling();
        await channel.track({ t: Date.now() });
        fetchAll();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        subscribed = false;
        startPolling();
      }
    });
  // If realtime is full or blocked, fall back to polling Supabase directly.
  setTimeout(() => !subscribed && startPolling(), 8000);
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(fetchAll, 4000);
}
function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

async function syncClock() {
  try {
    const t0 = Date.now();
    const r = await fetch('/api/time', { cache: 'no-store' });
    const { now } = await r.json();
    const t1 = Date.now();
    useStore.setState({ offset: now - (t0 + t1) / 2 });
  } catch {}
}

async function fetchAll() {
  const [{ data: logs }, { data: fire }] = await Promise.all([
    supabase.from('logs').select('*').eq('hidden', false).order('created_at').limit(1000),
    supabase.from('fire_state').select('*').eq('id', 1).maybeSingle(),
  ]);
  const st = useStore.getState();
  if (logs) {
    const rows = logs.map(toRow);
    if (!st.ready) st.setLogs(rows);
    else {
      const ids = new Set(rows.map((r) => r.id));
      st.logs.filter((l) => !ids.has(l.id)).forEach((l) => st.removeLog(l.id));
      rows.forEach((r) => {
        const cur = st.logs.find((l) => l.id === r.id);
        if (!cur) useStore.getState().upsertLog(r);
      });
    }
  }
  if (fire) useStore.getState().setFire(toFire(fire));
}

export async function addLog(profile) {
  const deviceId = useStore.getState().deviceId;
  if (IS_DEMO) return demoAddLog(deviceId, profile);
  const r = await fetch('/api/logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, ...profile }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Could not lay your log. Try again.');
  const row = toRow(j.log);
  useStore.getState().upsertLog(row);
  return row;
}

export async function adminAction(passcode, action, extra = {}) {
  if (IS_DEMO) return demoAdmin(passcode, action, extra);
  const r = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passcode, action, ...extra }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Action failed');
  if (j.fire) useStore.getState().setFire(toFire(j.fire));
  if (action === 'reset' || action === 'seed') await fetchAll();
  return j;
}

/* ------------------------------ demo mode ------------------------------ */
let bc = null;
const KEY = 'campfire.demo';
const seen = new Map();

function demoRead() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { logs: [], fire: {} };
  } catch {
    return { logs: [], fire: {} };
  }
}
function demoWrite(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {}
}

function startDemo(deviceId) {
  const d = demoRead();
  const st = useStore.getState();
  st.setLogs(d.logs.filter((l) => !l.hidden));
  st.setFire({ ignite_at: null, stoke_at: null, mode: 'normal', ...d.fire });
  useStore.setState({ ready: true });
  if (typeof BroadcastChannel === 'undefined') return;
  bc = new BroadcastChannel('campfire');
  bc.onmessage = ({ data }) => {
    const s = useStore.getState();
    if (data.type === 'log') s.upsertLog(data.log);
    if (data.type === 'logs') data.logs.forEach((l) => useStore.getState().upsertLog(l));
    if (data.type === 'remove') s.removeLog(data.id);
    if (data.type === 'fire') s.setFire(data.fire);
    if (data.type === 'reset') {
      s.setLogs([]);
      s.setFire(data.fire);
    }
    if (data.type === 'ping') {
      seen.set(data.id, Date.now());
    }
  };
  const ping = () => {
    bc.postMessage({ type: 'ping', id: deviceId });
    seen.set(deviceId, Date.now());
    const now = Date.now();
    let n = 0;
    seen.forEach((t) => now - t < 7000 && n++);
    useStore.setState({ online: n });
  };
  ping();
  setInterval(ping, 3000);
}

function demoAddLog(deviceId, profile) {
  const d = demoRead();
  const existing = d.logs.find((l) => l.device_id === deviceId);
  if (existing) return existing;
  const log = {
    id: crypto.randomUUID(),
    device_id: deviceId,
    name: profile.name,
    batch: profile.batch || '',
    message: profile.message || '',
    created_at: Date.now(),
    hidden: false,
  };
  d.logs.push(log);
  demoWrite(d);
  useStore.getState().upsertLog(log);
  bc?.postMessage({ type: 'log', log });
  return log;
}

function demoAdmin(passcode, action, extra) {
  if (passcode !== 'demo') throw new Error('Wrong passcode. In demo mode it is "demo".');
  const d = demoRead();
  const now = Date.now();
  const st = useStore.getState();
  if (action === 'login') return { ok: true };
  if (action === 'ignite') d.fire = { ...d.fire, ignite_at: now + (extra.delay ?? 10) * 1000, mode: 'normal' };
  if (action === 'stoke') d.fire = { ...d.fire, stoke_at: now };
  if (action === 'embers') d.fire = { ...d.fire, mode: d.fire.mode === 'embers' ? 'normal' : 'embers' };
  if (action === 'extinguish') d.fire = { ...d.fire, ignite_at: null, mode: 'normal' };
  if (action === 'hide') {
    d.logs = d.logs.filter((l) => l.id !== extra.id);
    demoWrite(d);
    st.removeLog(extra.id);
    bc?.postMessage({ type: 'remove', id: extra.id });
    return { ok: true };
  }
  if (action === 'reset') {
    const fire = { ignite_at: null, stoke_at: null, mode: 'normal', reset_at: now };
    demoWrite({ logs: [], fire });
    st.setLogs([]);
    st.setFire(fire);
    bc?.postMessage({ type: 'reset', fire });
    return { ok: true };
  }
  if (action === 'seed') {
    const n = extra.count || 20;
    const added = [];
    for (let i = 0; i < n; i++) {
      const name = DEMO_NAMES[(d.logs.length + i) % DEMO_NAMES.length];
      added.push({
        id: crypto.randomUUID(),
        device_id: 'test-' + crypto.randomUUID(),
        name,
        batch: String(1985 + Math.floor(Math.random() * 38)),
        message: '',
        created_at: now + i * (extra.spread ?? 350),
        hidden: false,
      });
    }
    d.logs.push(...added);
    demoWrite(d);
    // Drip them in so they arrive one by one like real people.
    added.forEach((l, i) =>
      setTimeout(() => {
        useStore.getState().upsertLog(l);
        bc?.postMessage({ type: 'log', log: l });
      }, i * (extra.spread ?? 350)),
    );
    return { ok: true };
  }
  demoWrite(d);
  st.setFire(d.fire);
  bc?.postMessage({ type: 'fire', fire: d.fire });
  return { ok: true };
}

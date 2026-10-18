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
const toLeader = (l) => ({
  slot: l.slot,
  name: l.name,
  title: l.title || '',
  called_at: l.called_at ? (typeof l.called_at === 'number' ? l.called_at : Date.parse(l.called_at)) : null,
  laid_at: l.laid_at ? (typeof l.laid_at === 'number' ? l.laid_at : Date.parse(l.laid_at)) : null,
});
const toFire = (f) => ({
  ignite_at: f.ignite_at ? Date.parse(f.ignite_at) : null,
  stoke_at: f.stoke_at ? Date.parse(f.stoke_at) : null,
  mode: f.mode || 'normal',
  reset_at: f.reset_at ? Date.parse(f.reset_at) : null,
  leaders_rev: f.leaders_rev || 0,
});

export async function startRealtime() {
  if (started) return;
  started = true;
  const deviceId = getDeviceId();
  useStore.setState({ deviceId, demo: IS_DEMO });
  if (IS_DEMO) return startDemo(deviceId);

  supabase = createClient(URL, ANON, { realtime: { params: { eventsPerSecond: 10 } } });
  await syncClock();
  await fetchAll();
  useStore.setState({ ready: true });

  // Live updates for as many people as the realtime plan allows. Anyone beyond
  // that (or behind a strict network) is kept in sync by light polling instead.
  connectLive();
  pollLoop();
  heartbeatLoop(deviceId);
}

let live = false;
let channel = null;
let cursor = null; // server timestamp (ISO) of the last sync

function connectLive() {
  if (channel) supabase.removeChannel(channel);
  channel = supabase
    .channel('campfire')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'logs' }, (p) => {
      if (p.eventType === 'DELETE') useStore.getState().removeLog(p.old.id);
      else useStore.getState().upsertLog(toRow(p.new));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fire_state' }, (p) => {
      if (p.new) applyFire(p.new);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        live = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        live = false;
        // Probably at the connection limit: stop retrying, poll instead, try again later.
        const ch = channel;
        channel = null;
        if (ch) supabase.removeChannel(ch);
        setTimeout(connectLive, 120000 + Math.random() * 120000);
      }
    });
}

function applyFire(row) {
  const prev = useStore.getState().fire;
  const next = toFire(row);
  useStore.getState().setFire(next);
  if (prev.reset_at !== next.reset_at && next.reset_at) fetchAll();
  else if (prev.leaders_rev !== next.leaders_rev) pollChanges().catch(() => {});
}

function pollLoop() {
  const wait = (live ? 20000 : 3000) + Math.random() * 1000;
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    try {
      await pollChanges();
    } catch {}
    pollLoop();
  }, wait);
}

async function pollChanges() {
  if (!cursor) return fetchAll();
  const { data, error } = await supabase.rpc('campfire_since', { p_since: cursor });
  if (error || !data) return;
  if (data.fire) applyFire(data.fire);
  for (const r of data.logs || []) useStore.getState().upsertLog(toRow(r));
  if (data.leaders) useStore.getState().setLeaders(data.leaders.map(toLeader));
  cursor = new Date(Date.parse(data.now) - 3000).toISOString();
}

function heartbeatLoop(deviceId) {
  const beat = async () => {
    try {
      const { data } = await supabase.rpc('heartbeat', { p_device: deviceId });
      if (typeof data === 'number') useStore.setState({ online: Math.max(1, data) });
    } catch {}
    setTimeout(beat, 40000 + Math.random() * 10000);
  };
  setTimeout(beat, Math.random() * 3000);
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

// Full load (first visit, or after the admin resets everything).
async function fetchAll() {
  const { data, error } = await supabase.rpc('campfire_since', { p_since: '1970-01-01T00:00:00Z' });
  if (error || !data) return;
  const rows = (data.logs || []).map(toRow).filter((r) => !r.hidden);
  const st = useStore.getState();
  if (!st.ready) st.setLogs(rows);
  else {
    const ids = new Set(rows.map((r) => r.id));
    st.logs.filter((l) => !ids.has(l.id)).forEach((l) => useStore.getState().removeLog(l.id));
    rows.forEach((r) => useStore.getState().upsertLog(r));
  }
  if (data.fire) useStore.getState().setFire(toFire(data.fire));
  if (data.leaders) useStore.getState().setLeaders(data.leaders.map(toLeader));
  cursor = new Date(Date.parse(data.now) - 3000).toISOString();
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

export async function leaderInfo(token) {
  if (IS_DEMO) {
    const l = (demoRead().leaders || []).find((x) => x.token === token && x.name);
    if (!l) throw new Error('This leader link is not valid.');
    return toLeader(l);
  }
  const r = await fetch('/api/leader?t=' + encodeURIComponent(token), { cache: 'no-store' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return toLeader(j.leader);
}

export async function leaderLay(token) {
  if (IS_DEMO) {
    const d = demoRead();
    const l = (d.leaders || []).find((x) => x.token === token);
    if (!l) throw new Error('This leader link is not valid.');
    if (!l.called_at) throw new Error('Please wait until the fire keeper calls you.');
    if (!l.laid_at) l.laid_at = Date.now();
    demoWrite(d);
    demoPushLeaders(d);
    return toLeader(l);
  }
  const r = await fetch('/api/leader', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ t: token }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  await pollChanges().catch(() => {});
  return toLeader(j.leader);
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
  if (j.leaders) {
    useStore.setState({ adminLeaders: j.leaders });
    useStore.getState().setLeaders(j.leaders.filter((l) => l.name).map(toLeader));
  }
  if (action === 'reset' || action === 'seed' || action === 'hide') await fetchAll();
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

function demoPushLeaders(d) {
  const pubs = (d.leaders || []).filter((l) => l.name).map(toLeader);
  useStore.getState().setLeaders(pubs);
  bc?.postMessage({ type: 'leaders', leaders: pubs });
}

function startDemo(deviceId) {
  const d = demoRead();
  const st = useStore.getState();
  st.setLeaders((d.leaders || []).filter((l) => l.name).map(toLeader));
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
    if (data.type === 'leaders') s.setLeaders(data.leaders);
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
  if (action === 'login') {
    useStore.setState({ adminLeaders: d.leaders || [] });
    return { ok: true };
  }
  if (action === 'leaders_save') {
    const prev = d.leaders || [];
    d.leaders = (extra.leaders || []).slice(0, 5).map((l, slot) => ({
      slot,
      name: (l.name || '').trim().slice(0, 40),
      title: (l.title || '').trim().slice(0, 60),
      token: prev.find((p) => p.slot === slot)?.token || Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
      called_at: prev.find((p) => p.slot === slot)?.called_at || null,
      laid_at: prev.find((p) => p.slot === slot)?.laid_at || null,
    }));
    demoWrite(d);
    useStore.setState({ adminLeaders: d.leaders });
    demoPushLeaders(d);
    return { ok: true };
  }
  if (action === 'leader_call' || action === 'leader_lay' || action === 'leader_reset') {
    const l = (d.leaders || []).find((x) => x.slot === Number(extra.slot));
    if (l) {
      if (action === 'leader_call') l.called_at = now;
      if (action === 'leader_lay') {
        l.called_at = l.called_at || now;
        l.laid_at = now;
      }
      if (action === 'leader_reset') l.called_at = l.laid_at = null;
    }
    demoWrite(d);
    useStore.setState({ adminLeaders: d.leaders });
    demoPushLeaders(d);
    return { ok: true };
  }
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
    const leaders = (d.leaders || []).map((l) => ({ ...l, called_at: null, laid_at: null }));
    demoWrite({ logs: [], fire, leaders });
    useStore.setState({ adminLeaders: leaders });
    demoPushLeaders({ leaders });
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

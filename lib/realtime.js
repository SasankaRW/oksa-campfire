'use client';
// Connects the page to shared state. Uses Supabase when configured,
// otherwise a local demo mode that syncs between tabs of one browser.
import { createClient } from '@supabase/supabase-js';
import { useStore, getDeviceId } from './store';
import { DEMO_NAMES } from './demoNames';
import { resumeStart } from './memories';

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
  memories_at: f.memories_at ? (typeof f.memories_at === 'number' ? f.memories_at : Date.parse(f.memories_at)) : null,
  memories_paused_at: f.memories_paused_at
    ? typeof f.memories_paused_at === 'number'
      ? f.memories_paused_at
      : Date.parse(f.memories_paused_at)
    : null,
  cheer_at: f.cheer_at ? (typeof f.cheer_at === 'number' ? f.cheer_at : Date.parse(f.cheer_at)) : null,
  cheer_text: f.cheer_text || '',
  song_at: f.song_at ? (typeof f.song_at === 'number' ? f.song_at : Date.parse(f.song_at)) : null,
  song_title: f.song_title || '',
  quiz_url: f.quiz_url || '',
  quiz_on: !!f.quiz_on,
  logs_open: !!f.logs_open,
});

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const toMs = (v) => (v ? (typeof v === 'number' ? v : Date.parse(v)) || 0 : 0);
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

// fetch that gives up after `ms` (works on older phones that lack AbortSignal.timeout)
function fetchT(url, opts = {}, ms = 5000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(timer));
}

// a Supabase call that gives up after `ms`
async function rpcT(name, args, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const { data, error } = await supabase.rpc(name, args).abortSignal(ctl.signal);
    if (error || !data) throw new Error(name + ' failed');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function startRealtime() {
  if (started) return;
  started = true;
  try {
    const deviceId = getDeviceId();
    useStore.setState({ deviceId, demo: IS_DEMO });
    if (IS_DEMO) return startDemo(deviceId);

    supabase = createClient(URL, ANON, { realtime: { params: { eventsPerSecond: 10 } } });
    // Show the fire within ~8 seconds even on a bad signal; polling fills in the rest.
    await Promise.race([Promise.all([syncClock(), loadInitial()]).catch(() => {}), sleep(8000)]);
    useStore.setState({ ready: true });

    // Come back to life cleanly after the phone sleeps, the tab is hidden, or the network drops.
    // A short random wait spreads out a whole crowd whose network comes back at the same moment.
    let resyncTimer = null;
    const resync = () => {
      if (hidden()) return;
      clearTimeout(resyncTimer);
      resyncTimer = setTimeout(() => {
        syncClock();
        pollNow();
        if (!live) connectLive(); // does nothing while we are waiting out a backoff
      }, Math.random() * 2000);
    };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('online', resync);

    // Live updates for as many people as the realtime plan allows. Anyone beyond
    // that (or behind a strict network) is kept in sync by light polling instead.
    connectLive();
    pollLoop();
    heartbeatLoop(deviceId);
  } catch {
    useStore.setState({ ready: true });
  }
}

/* ---------------- live channel (fire changes only) ----------------
   Log arrivals are NOT sent live: at a rush that would be hundreds of messages a
   second to every guest, far over the free plan. They come from polling /api/since,
   which Vercel's cache shares between everyone. */
let live = false;
let channel = null;
let gen = 0; // which channel attempt is the current one; callbacks from older ones are ignored
let liveFails = 0; // failures in a row
let liveTimer = null;
let nextLiveAttemptAt = 0;
const LIVE_MAX_FAILS = 3;

function connectLive() {
  if (!supabase || channel || Date.now() < nextLiveAttemptAt) return;
  clearTimeout(liveTimer);
  const my = ++gen;
  // a fresh name each time, so we never get back an old channel that is still shutting down
  channel = supabase
    .channel('campfire-' + my)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fire_state' }, (p) => {
      if (my !== gen || !p.new) return;
      // live changes arrive in the order the database saved them, so always apply them
      liveAt = Math.max(liveAt, toMs(p.commit_timestamp));
      applyFire(p.new);
    })
    .subscribe((status) => {
      if (my !== gen) return; // an old channel we already gave up on
      if (status === 'SUBSCRIBED') {
        live = true;
        liveFails = 0;
        pollNow(); // catch anything that happened while connecting
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // Supabase keeps retrying this channel by itself. Only after several failures in a
        // row (probably the connection limit) do we give up for a few minutes and just poll.
        live = false;
        if (++liveFails >= LIVE_MAX_FAILS) dropLive(true);
      } else if (status === 'CLOSED') {
        // the server closed it: Supabase won't retry this one, so we start a new one
        live = false;
        dropLive(++liveFails >= LIVE_MAX_FAILS);
      }
    });
}

function dropLive(longWait) {
  live = false;
  const old = channel;
  channel = null;
  gen++; // ignore anything the old channel still says (including the CLOSED from removing it)
  const wait = longWait ? 120000 + Math.random() * 120000 : 5000 + Math.random() * 10000;
  nextLiveAttemptAt = Date.now() + wait;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(connectLive, wait);
  if (!old) return;
  Promise.resolve()
    .then(() => supabase.removeChannel(old))
    .catch(() => {})
    .then(() => {
      // while waiting out a long backoff, also close the connection so it stops knocking
      if (longWait && !channel) return supabase.realtime?.disconnect?.();
    })
    .catch(() => {});
}

/* ---------------- applying what the server sends ----------------
   Answers can arrive late or out of order (cached ones are a few seconds old), so
   nothing older than what is already on screen is ever applied. Times here are the
   database's own clock, so they can be compared safely. */
let cursor = 0; // server time (ms): we have everything that changed before this
let liveAt = 0; // database time of the newest live fire change applied
let lastNow = 0; // database time of the newest poll/snapshot fire applied
let resetSeen = 0; // newest reset_at seen
let loadedOnce = false;
let lastNewLogAt = 0; // when a new log last arrived (local ms): poll faster while logs are flowing
const logStamp = new Map(); // log id -> updated_at of the version shown
let leadersTimer = null;

// A poll or snapshot answer taken at database time `at` is up to date only if it is
// at least as new as everything we have already shown.
function freshAt(at) {
  if (at < Math.max(lastNow, liveAt)) return false;
  lastNow = at;
  return true;
}

function applyFire(row, from = 'live') {
  const prev = useStore.getState().fire;
  const next = toFire(row);
  useStore.getState().setFire(next);
  useStore.setState({ fireLoaded: true });
  const reset = toMs(row.reset_at);
  const isNewReset = reset > resetSeen;
  if (isNewReset) resetSeen = reset;
  if (isNewReset && from !== 'snapshot' && from !== 'admin') reloadAfterReset();
  else if (from === 'live' && prev.leaders_rev !== next.leaders_rev) {
    // everyone gets this at once: spread the re-checks over 0–3 s
    clearTimeout(leadersTimer);
    leadersTimer = setTimeout(pollNow, Math.random() * 3000);
  }
}

function applyLogRow(r) {
  if (!r || !r.id) return;
  const t = toMs(r.updated_at) || toMs(r.created_at);
  const seen = logStamp.get(r.id);
  if (seen !== undefined && t <= seen) return; // already showing this version (or a newer one)
  if (seen === undefined && loadedOnce && !r.hidden) lastNewLogAt = Date.now();
  logStamp.set(r.id, t);
  useStore.getState().upsertLog(toRow(r));
}

let catchUps = 0;
let wantSoon = false;
let inTick = false;
// the answer was older than what we already show: look again shortly (a few times at most)
function behind() {
  if (catchUps >= 3) return;
  catchUps++;
  wantSoon = true;
  if (!inTick) pollLoop();
}

function applyChanges(data) {
  if (!data || !data.now) throw new Error('bad answer');
  // from before the last reset: its logs were deleted, ignore all of it
  if (data.fire && toMs(data.fire.reset_at) < resetSeen) return behind();
  for (const r of data.logs || []) applyLogRow(r);
  if (freshAt(toMs(data.now))) {
    catchUps = 0;
    if (data.fire) applyFire(data.fire, 'poll');
    if (data.leaders) useStore.getState().setLeaders(data.leaders.map(toLeader));
  } else behind(); // a cached answer from before the last live change: look again shortly
  cursor = Math.max(cursor, toMs(data.now) - 3000);
}

function applySnapshot(data, from = 'snapshot') {
  if (!data || !data.now) throw new Error('bad answer');
  if (data.fire && toMs(data.fire.reset_at) < resetSeen) return false; // from before the last reset
  const snapAt = toMs(data.now);
  const rows = data.logs || [];
  const st = useStore.getState();
  if (!loadedOnce) {
    for (const r of rows) logStamp.set(r.id, toMs(r.updated_at) || toMs(r.created_at));
    const ids = new Set(rows.map((r) => r.id));
    // keep your own log if it arrived first
    st.setLogs([...rows.map(toRow).filter((r) => !r.hidden), ...st.logs.filter((l) => !ids.has(l.id))]);
    loadedOnce = true;
  } else {
    const ids = new Set(rows.map((r) => r.id));
    // gone from the fire (reset): remove, unless it arrived after this snapshot was taken
    st.logs
      .filter((l) => !ids.has(l.id) && (logStamp.get(l.id) || 0) <= snapAt)
      .forEach((l) => useStore.getState().removeLog(l.id));
    rows.forEach(applyLogRow);
  }
  if (data.fire) {
    const r = toMs(data.fire.reset_at);
    if (r > resetSeen) resetSeen = r;
  }
  if (freshAt(snapAt)) {
    if (data.fire) applyFire(data.fire, from);
    if (data.leaders) useStore.getState().setLeaders(data.leaders.map(toLeader));
  }
  cursor = Math.max(cursor, snapAt - 3000);
  return true;
}

/* ---------------- polling ---------------- */
let pollFails = 0;
function pollWait() {
  const fire = useStore.getState().fire;
  const flowing = fire.logs_open && Date.now() - lastNewLogAt < 60000;
  let wait;
  if (!live) wait = 5000; // no live channel: polling is how we hear about everything
  else if (flowing) wait = 5000; // logs are arriving: keep up with them
  else if (fire.logs_open) wait = 15000;
  else wait = 45000; // the live channel brings fire changes; this is just a safety net
  if (pollFails) wait = Math.max(wait, Math.min(30000, 5000 * 2 ** pollFails));
  if (wantSoon) {
    wantSoon = false;
    wait = Math.min(wait, 4000);
  }
  return wait + Math.random() * 1000;
}

function pollLoop() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(pollTick, pollWait());
}

async function pollTick() {
  // nothing while the page is hidden; coming back triggers a check straight away
  if (hidden()) return pollLoop();
  inTick = true;
  try {
    await pollChanges();
    pollFails = 0;
  } catch {
    pollFails = Math.min(pollFails + 1, 4);
  }
  inTick = false;
  pollLoop();
}

// check now, then carry on with the regular rhythm
function pollNow() {
  if (inTick) return; // a check is already running
  clearTimeout(pollTimer);
  pollTick();
}

async function pollChanges() {
  if (!cursor) return loadInitial(1);
  // rounded to 5 s so everyone asks the same question and shares one cached answer
  const bucket = Math.floor(cursor / 5000) * 5000;
  let data;
  try {
    const r = await fetchT('/api/since?s=' + bucket, {}, 6000);
    if (!r.ok) throw new Error('since ' + r.status);
    data = await r.json();
  } catch (e) {
    // our own server keeps failing: ask Supabase directly now and then
    if (pollFails < 2) throw e;
    data = await rpcT('campfire_since', { p_since: new Date(bucket).toISOString() });
  }
  applyChanges(data);
}

function heartbeatLoop(deviceId) {
  const beat = async () => {
    if (hidden()) return setTimeout(beat, 60000);
    try {
      const { data } = await supabase.rpc('heartbeat', { p_device: deviceId });
      if (typeof data === 'number') useStore.setState({ online: Math.max(1, data) });
    } catch {}
    setTimeout(beat, 40000 + Math.random() * 10000);
  };
  setTimeout(beat, Math.random() * 3000);
}

// Clock sync: several quick samples; the fastest round trip gives the most accurate offset.
// A stored offset is only replaced by a better one, or once it is over 5 minutes old.
let bestRtt = Infinity;
let bestAt = 0;
let syncing = false;
async function syncClock() {
  if (syncing) return;
  syncing = true;
  try {
    if (Date.now() - bestAt > 5 * 60000) bestRtt = Infinity;
    for (let i = 0; i < 4; i++) {
      try {
        const t0 = Date.now();
        const r = await fetchT('/api/time', { cache: 'no-store' }, 5000);
        const { now } = await r.json();
        const t1 = Date.now();
        const rtt = t1 - t0;
        // slow answers (over 1.5 s) are too blurry, unless we have nothing better yet
        if (typeof now === 'number' && rtt < bestRtt && (rtt <= 1500 || !bestAt)) {
          bestRtt = rtt;
          bestAt = t1;
          useStore.setState({ offset: now - (t0 + t1) / 2 });
        }
      } catch {}
    }
  } finally {
    syncing = false;
  }
}

// First load: use the edge-cached snapshot so a crowd arriving together costs
// the database almost nothing. Falls back to asking Supabase directly.
async function loadInitial(tries = 3) {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const r = await fetchT('/api/snapshot', {}, 5000);
      if (r.ok && applySnapshot(await r.json())) return;
    } catch {}
    try {
      return await fetchAll();
    } catch {}
    if (attempt < tries - 1) await sleep(800 * (attempt + 1));
  }
  if (tries === 1) throw new Error('load failed');
}

// After a reset everyone reloads: spread out over 0–3 s and use the shared cached snapshot.
// A cached copy from just before the reset is skipped and asked for again.
let reloadTimer = null;
function reloadAfterReset() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => loadAfterReset(0), Math.random() * 3000);
}
async function loadAfterReset(attempt) {
  try {
    const r = await fetchT('/api/snapshot', {}, 5000);
    if (r.ok && applySnapshot(await r.json())) return;
  } catch {}
  if (attempt < 4) reloadTimer = setTimeout(() => loadAfterReset(attempt + 1), 2000 + Math.random() * 2000);
  else fetchAll().catch(() => {});
}

// Full, fresh load straight from Supabase (the admin after a reset, or as a fallback).
async function fetchAll() {
  const data = await rpcT('campfire_since', { p_since: '1970-01-01T00:00:00Z' });
  if (!applySnapshot(data, 'admin')) throw new Error('old answer');
}

// fetch with a timeout and a couple of retries on network or server hiccups
async function fetchRetry(url, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, { ...opts, signal: ctl.signal });
      clearTimeout(timer);
      if (r.status < 500) return r; // success or a real answer (e.g. wrong passcode)
      last = new Error('Server busy');
    } catch (e) {
      clearTimeout(timer);
      last = e;
    }
    await new Promise((res) => setTimeout(res, 600 * (i + 1) + Math.random() * 400));
  }
  throw new Error(last?.name === 'AbortError' ? 'The connection is slow. Please try again.' : 'Could not reach the server. Check your connection and try again.');
}

export async function addLog(profile) {
  const deviceId = useStore.getState().deviceId;
  if (IS_DEMO) return demoAddLog(deviceId, profile);
  // safe to retry: the server returns your existing log instead of making a second one
  const r = await fetchRetry('/api/logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, ...profile }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Could not lay your log. Try again.');
  const row = toRow(j.log);
  logStamp.set(row.id, toMs(j.log.updated_at) || row.created_at);
  useStore.getState().upsertLog(row); // your own log shows straight away
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
  const r = await fetchRetry('/api/leader', {
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
  // The server ignores a repeat of a big moment (light, photos, song, ...) that arrives
  // within 20 s, so retrying those is safe. These would double up if repeated:
  const safe = !['seed', 'stoke', 'cheer'].includes(action);
  const r = await fetchRetry(
    '/api/admin',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passcode, action, ...extra }),
    },
    safe ? 2 : 1,
  );
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Action failed');
  if (j.fire) applyFire(j.fire, 'admin');
  if (j.leaders) {
    useStore.setState({ adminLeaders: j.leaders });
    useStore.getState().setLeaders(j.leaders.filter((l) => l.name).map(toLeader));
  }
  if (action === 'reset' || action === 'seed' || action === 'hide') fetchAll().catch(() => {});
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
  useStore.setState({ ready: true, fireLoaded: true });
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
  if (action === 'ping') return { ok: true };
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
  if (action === 'memories_start') d.fire = { ...d.fire, memories_at: now + 1500, memories_paused_at: null };
  if (action === 'memories_stop') d.fire = { ...d.fire, memories_at: null, memories_paused_at: null };
  if (action === 'memories_pause' && d.fire.memories_at && !d.fire.memories_paused_at) d.fire = { ...d.fire, memories_paused_at: now };
  if (action === 'memories_resume' && d.fire.memories_at && d.fire.memories_paused_at)
    d.fire = { ...d.fire, memories_at: resumeStart(d.fire.memories_at, d.fire.memories_paused_at, now), memories_paused_at: null };
  if (action === 'cheer') d.fire = { ...d.fire, cheer_at: now + 1200, cheer_text: (extra.text || '').slice(0, 80) };
  if (action === 'song_start') d.fire = { ...d.fire, song_at: now, song_title: (extra.title || '').slice(0, 80) };
  if (action === 'song_stop') d.fire = { ...d.fire, song_at: null };
  if (action === 'quiz') d.fire = { ...d.fire, quiz_url: extra.url ?? d.fire.quiz_url ?? '', quiz_on: !!extra.on };
  if (action === 'logs_open') d.fire = { ...d.fire, logs_open: !!extra.on };
  if (action === 'embers') d.fire = { ...d.fire, mode: extra.mode === 'embers' ? 'embers' : 'normal' };
  if (action === 'extinguish') d.fire = { ...d.fire, ignite_at: null, mode: 'normal' };
  if (action === 'hide') {
    d.logs = d.logs.filter((l) => l.id !== extra.id);
    demoWrite(d);
    st.removeLog(extra.id);
    bc?.postMessage({ type: 'remove', id: extra.id });
    return { ok: true };
  }
  if (action === 'reset') {
    const fire = { ignite_at: null, stoke_at: null, mode: 'normal', reset_at: now, quiz_on: false, logs_open: false, quiz_url: d.fire?.quiz_url || '' };
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

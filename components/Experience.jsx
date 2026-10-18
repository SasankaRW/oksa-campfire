'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useStore, loadProfile, saveProfile } from '@/lib/store';
import { startRealtime, addLog } from '@/lib/realtime';
import { initAudio, muteAudio } from '@/lib/audio';
import { emit, shared, setZoom } from '@/lib/bus';
import { EVENT, MAX_NAME, MAX_MESSAGE } from '@/lib/config';
import { hash } from '@/lib/layout';
import AdminPanel from './AdminPanel';
import { makeKeepsake } from '@/lib/keepsake';

const Scene = dynamic(() => import('./Scene'), { ssr: false });

function useTick(ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

function detectQuality() {
  if (typeof window === 'undefined') return 'high';
  try {
    const q = new URLSearchParams(location.search).get('q');
    if (q === 'low' || q === 'high') return q;
  } catch {}
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 700;
  const cores = navigator.hardwareConcurrency || 4;
  return mobile || cores <= 4 ? 'low' : 'high';
}

export default function Experience({ mode = 'guest' }) {
  const ready = useStore((s) => s.ready);
  const logs = useStore((s) => s.logs);
  const deviceId = useStore((s) => s.deviceId);
  const fire = useStore((s) => s.fire);
  const online = useStore((s) => s.online);
  const feed = useStore((s) => s.feed);
  const demo = useStore((s) => s.demo);
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ name: '', batch: '', message: '' });
  const [error, setError] = useState('');
  const [sound, setSound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quality, setQuality] = useState('high');
  const [hideUi, setHideUi] = useState(false);
  useTick(200);

  useEffect(() => {
    setQuality(detectQuality());
    startRealtime();
    const p = loadProfile();
    if (p) {
      setProfile(p);
      setForm(p);
    }
    const key = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'h') setHideUi((v) => !v);
      if (e.key === '+' || e.key === '=') setZoom(shared.zoom * 0.85);
      if (e.key === '-' || e.key === '_') setZoom(shared.zoom * 1.18);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const mine = useMemo(() => logs.find((l) => l.device_id === deviceId) || null, [logs, deviceId]);
  const now = Date.now() + useStore.getState().offset;
  const igniteIn = fire.ignite_at ? (fire.ignite_at - now) / 1000 : null;
  const lit = igniteIn !== null && igniteIn <= 0;
  const counting = igniteIn !== null && igniteIn > 0 && igniteIn <= 60;
  const status = lit ? (fire.mode === 'embers' ? EVENT.embers : EVENT.lit) : counting ? 'The fire is being lit…' : EVENT.waiting;
  const handActive = mode === 'guest' && ready && !!profile && !mine;

  async function join(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return setError('Enter your name.');
    if (form.batch && !/^\d{4}$/.test(form.batch.trim())) return setError('Batch year should look like 2004.');
    setError('');
    initAudio();
    setSound(true);
    const p = { name: name.slice(0, MAX_NAME), batch: form.batch.trim(), message: form.message.trim().slice(0, MAX_MESSAGE) };
    saveProfile(p);
    setProfile(p);
  }

  async function onThrow() {
    if (busy || mine) return;
    setBusy(true);
    try {
      await addLog(profile);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggleSound() {
    if (sound) {
      muteAudio();
      setSound(false);
    } else {
      initAudio();
      setSound(true);
    }
  }

  const throwRef = useRef(onThrow);
  throwRef.current = onThrow;
  const stableThrow = useCallback(() => throwRef.current(), []);
  const mySeed = useMemo(() => (deviceId ? hash(deviceId.charCodeAt(0) + deviceId.charCodeAt(5)) * 100 : 7), [deviceId]);
  const sceneEl = useMemo(
    () => <Scene quality={quality} handActive={handActive} onThrow={stableThrow} mySeed={mySeed} />,
    [quality, handActive, stableThrow, mySeed],
  );
  const joinUrl = typeof window !== 'undefined' ? window.location.host : '';

  return (
    <main className={`stage ${hideUi ? 'ui-hidden' : ''}`}>
      {sceneEl}
      <div className={`curtain ${ready ? 'up' : ''}`} />
      <div className={`dim ${counting ? 'on' : ''}`} />

      <header className="hud-top">
        <div>
          <div className="eyebrow">{EVENT.org}</div>
          <h1 className="title">{EVENT.title}</h1>
          <div className="status">{status}</div>
        </div>
        <div className="counts">
          <div className="big">{logs.length}</div>
          <div className="small">
            {logs.length === 1 ? 'log laid' : 'logs laid'} · {online} around the fire
          </div>
        </div>
      </header>

      <ul className="feed" aria-live="polite">
        {feed.map((f) => (
          <li key={f.id} className="feed-item">
            {f.text}
          </li>
        ))}
      </ul>

      {counting && (
        <div className="countdown" key={Math.ceil(igniteIn)}>
          <span>{Math.ceil(igniteIn)}</span>
        </div>
      )}

      {mode === 'guest' && ready && !profile && (
        <form className="card join" onSubmit={join}>
          <div className="eyebrow">{EVENT.year} · Virtual campfire</div>
          <h2>Take a log for the fire</h2>
          <p className="lede">Every log carries a name. When the fire is lit, yours burns with the rest.</p>
          <label>
            <span>Your name</span>
            <input
              autoFocus
              maxLength={MAX_NAME}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Nimal Perera"
            />
          </label>
          <div className="row">
            <label className="narrow">
              <span>Batch</span>
              <input
                inputMode="numeric"
                maxLength={4}
                value={form.batch}
                onChange={(e) => setForm({ ...form, batch: e.target.value.replace(/\D/g, '') })}
                placeholder="2004"
              />
            </label>
            <label>
              <span>Carve a few words (optional)</span>
              <input
                maxLength={MAX_MESSAGE}
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="For Troop 3"
              />
            </label>
          </div>
          {error && <div className="error">{error}</div>}
          <button className="btn primary" type="submit">
            Take your log
          </button>
          <div className="fine">Sound on for the full experience.</div>
        </form>
      )}

      {handActive && (
        <div className="hint">
          <div className="hint-text">Drag your log into the fire</div>
          <button className="btn ghost" disabled={busy} onClick={() => emit('throw-log')}>
            {busy ? 'Laying it…' : 'Or lay it on the fire'}
          </button>
          {error && <div className="error">{error}</div>}
        </div>
      )}

      {mode === 'guest' && mine && (
        <div className="mine">
          <div>
            <div className="mine-name">
              {mine.name}
              {mine.batch ? ` · ${mine.batch}` : ''}
            </div>
            <div className="mine-sub">Your log is in the fire — #{logs.indexOf(mine) + 1}</div>
          </div>
          <div className="mine-actions">
            <button className="btn ghost" onClick={() => emit('focus-mine')}>
              Find my log
            </button>
            {lit && (
              <button className="btn ghost" onClick={() => makeKeepsake(mine, logs.indexOf(mine) + 1)}>
                Keepsake
              </button>
            )}
          </div>
        </div>
      )}

      {mode === 'stage' && <div className="joinat">Lay your log at {joinUrl}</div>}

      <div className="zoom" role="group" aria-label="Zoom">
        <button onClick={() => setZoom(shared.zoom * 0.8)} aria-label="Zoom in">+</button>
        <button onClick={() => setZoom(shared.zoom * 1.25)} aria-label="Zoom out">−</button>
      </div>

      <button className="sound" onClick={toggleSound} aria-label={sound ? 'Mute' : 'Turn sound on'}>
        {sound ? 'Sound on' : 'Sound off'}
      </button>

      {demo && mode !== 'stage' && (
        <div className="demo-flag">Demo mode · syncs between tabs in this browser only</div>
      )}

      {mode === 'admin' && <AdminPanel />}
    </main>
  );
}

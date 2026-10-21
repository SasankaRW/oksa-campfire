'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useStore, loadProfile, saveProfile } from '@/lib/store';
import { startRealtime, addLog, leaderInfo, leaderLay } from '@/lib/realtime';
import { initAudio, muteAudio } from '@/lib/audio';
import { emit, shared, setZoom } from '@/lib/bus';
import { EVENT, MAX_NAME, MAX_MESSAGE } from '@/lib/config';
import { hash } from '@/lib/layout';
import AdminPanel from './AdminPanel';
import Moments from './Moments';
import SceneGuard from './SceneGuard';
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
  const [leaderToken, setLeaderToken] = useState(null);
  const [leaderMe, setLeaderMe] = useState(null); // { slot, name, title } or { error }
  const [leaderBusy, setLeaderBusy] = useState(false);
  const leaders = useStore((s) => s.leaders);
  // Re-render quickly only while something is counting down or animating on screen.
  const _t = Date.now() + useStore.getState().offset;
  const _busy =
    (fire.ignite_at && fire.ignite_at > _t - 2000 && fire.ignite_at - _t < 61000) ||
    (fire.cheer_at && _t - fire.cheer_at < 12000) ||
    useStore.getState().leaders.some((l) => l.laid_at && _t - l.laid_at < 10000);
  useTick(_busy ? 200 : fire.memories_at ? 500 : 1000);

  useEffect(() => {
    setQuality(detectQuality());
    startRealtime();
    try {
      const t = new URLSearchParams(location.search).get('leader');
      if (t) setLeaderToken(t);
    } catch {}
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
  const status = lit ? (fire.mode === 'embers' ? EVENT.embers : EVENT.lit) : counting ? 'The fire arrow is drawn…' : EVENT.waiting;
  const isLeader = !!leaderToken && leaderMe && !leaderMe.error;
  const handActive = mode === 'guest' && !leaderToken && ready && !!profile && !mine;

  useEffect(() => {
    if (!ready || !leaderToken) return;
    leaderInfo(leaderToken)
      .then((l) => setLeaderMe(l))
      .catch((e) => setLeaderMe({ error: e.message }));
  }, [ready, leaderToken]);

  // live status of this leader (called / laid) comes from the shared list
  const myLeader = isLeader ? leaders.find((l) => l.slot === leaderMe.slot) || leaderMe : null;
  // the leader currently being called (for everyone)
  const calling = [...leaders].filter((l) => l.called_at && !l.laid_at).sort((a, b) => b.called_at - a.called_at)[0];
  // the leader whose honour log is being laid right now (for everyone)
  const spot = leaders
    .filter((l) => l.laid_at && (now - l.laid_at) / 1000 >= 0 && (now - l.laid_at) / 1000 < 9)
    .sort((a, b) => b.laid_at - a.laid_at)[0];
  const spotT = spot ? (now - spot.laid_at) / 1000 : 0;

  async function layHonour() {
    setLeaderBusy(true);
    try {
      initAudio();
      setSound(true);
      await leaderLay(leaderToken);
    } catch (e) {
      setLeaderMe((m) => ({ ...m, note: e.message }));
    } finally {
      setLeaderBusy(false);
    }
  }

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
      <SceneGuard>{sceneEl}</SceneGuard>
      <div className={`curtain ${ready ? 'up' : ''}`} />
      <div className={`dim ${counting ? 'on' : ''} ${spot ? 'spot' : ''}`} />

      <Moments now={now} />

      {spot && (
        <div className={`honour-card ${spotT > 8 ? 'out' : ''}`} key={spot.slot + '-' + spot.laid_at}>
          <div className="honour-eyebrow">Honour log</div>
          <div className="honour-name">Laid by {spot.name}</div>
          {spot.title && <div className="honour-title">{spot.title}</div>}
        </div>
      )}

      {!spot && calling && !(isLeader && myLeader?.slot === calling.slot) && (
        <div className="calling">
          The fire keeper calls <strong>{calling.name}</strong>
          {calling.title ? `, ${calling.title}` : ''}
        </div>
      )}

      {leaderToken && ready && leaderMe?.error && (
        <div className="card leader-card">
          <h2>This link isn't working</h2>
          <p className="lede">{leaderMe.error} Please ask the fire keeper for your link again.</p>
        </div>
      )}

      {isLeader && myLeader && !(spot && spot.slot === myLeader.slot) && (
        <div className="card leader-card">
          <div className="eyebrow">Honour log</div>
          <h2>Welcome, {myLeader.name}</h2>
          {myLeader.title && <p className="lede leader-title">{myLeader.title}</p>}
          {!myLeader.called_at && (
            <p className="lede">
              Your honour log is ready. When the fire keeper calls your name, a button will appear here for you to lay it.
            </p>
          )}
          {myLeader.called_at && !myLeader.laid_at && (
            <>
              <p className="lede">You have been called. Everyone around the fire will watch your log being laid.</p>
              <button className="btn place pulse" disabled={leaderBusy} onClick={layHonour}>
                {leaderBusy ? 'Laying it…' : 'Lay the honour log'}
              </button>
            </>
          )}
          {myLeader.laid_at && <p className="lede">Your honour log is in place at the heart of the fire. Thank you.</p>}
          {leaderMe?.note && <div className="error">{leaderMe.note}</div>}
        </div>
      )}

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

      {mode === 'guest' && !leaderToken && ready && !profile && (
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
          <button className="btn primary big pulse" type="submit">
            Take your log
          </button>
          <div className="fine">Sound on for the full experience.</div>
        </form>
      )}

      {handActive && (
        <div className="hint">
          <div className="hint-arrows" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="hint-text">Your log is ready. Tap the button below, or drag the log up into the fire.</div>
          <button className="btn place pulse" disabled={busy} onClick={() => emit('throw-log')}>
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M12 2c1 3.5 5 5.6 5 10a5 5 0 0 1-10 0c0-2.2 1.2-3.6 2.3-4.6.2 1.6 1 2.6 2 3 0-3 .2-5.6.7-8.4z"
              />
            </svg>
            {busy ? 'Placing your log…' : 'Place my log on the fire'}
          </button>
          {error && <div className="error">{error}</div>}
        </div>
      )}

      {mode === 'guest' && !leaderToken && mine && (
        <div className="mine">
          <div>
            <div className="mine-name">
              {mine.name}
              {mine.batch ? ` · ${mine.batch}` : ''}
            </div>
            <div className="mine-sub">Your log is in the fire — #{logs.indexOf(mine) + 1}</div>
          </div>
          <div className="mine-actions">
            <button className="btn ghost big-ish" onClick={() => emit('focus-mine')}>
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

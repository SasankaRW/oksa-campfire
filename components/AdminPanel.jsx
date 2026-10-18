'use client';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { adminAction } from '@/lib/realtime';
import { COUNTDOWN_SECONDS } from '@/lib/config';

export default function AdminPanel() {
  const logs = useStore((s) => s.logs);
  const fire = useStore((s) => s.fire);
  const online = useStore((s) => s.online);
  const demo = useStore((s) => s.demo);
  const [pass, setPass] = useState('');
  const [authed, setAuthed] = useState(false);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);
  const [delay, setDelay] = useState(COUNTDOWN_SECONDS);

  useEffect(() => {
    try {
      const p = sessionStorage.getItem('campfire.admin');
      if (p) {
        setPass(p);
        setAuthed(true);
      }
    } catch {}
  }, []);

  async function run(action, extra) {
    setMsg('');
    try {
      await adminAction(pass, action, extra);
      if (action === 'login') {
        setAuthed(true);
        try {
          sessionStorage.setItem('campfire.admin', pass);
        } catch {}
      }
    } catch (e) {
      setMsg(e.message);
      if (action === 'login') setAuthed(false);
    }
  }

  const now = Date.now() + useStore.getState().offset;
  const lit = fire.ignite_at && fire.ignite_at <= now;
  const counting = fire.ignite_at && fire.ignite_at > now;

  if (!open)
    return (
      <button className="admin-toggle" onClick={() => setOpen(true)}>
        Admin
      </button>
    );

  return (
    <aside className="admin">
      <div className="admin-head">
        <div>
          <div className="eyebrow">Fire keeper</div>
          <div className="admin-title">Admin controls</div>
        </div>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>
          Hide
        </button>
      </div>

      {!authed ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run('login');
          }}
        >
          <label>
            <span>Passcode{demo ? ' (demo: "demo")' : ''}</span>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
          </label>
          <button className="btn primary" type="submit">
            Enter
          </button>
          {msg && <div className="error">{msg}</div>}
        </form>
      ) : (
        <>
          <div className="admin-stats">
            <div>
              <div className="big">{online}</div>
              <div className="small">online</div>
            </div>
            <div>
              <div className="big">{logs.length}</div>
              <div className="small">logs</div>
            </div>
            <div>
              <div className="big">{lit ? (fire.mode === 'embers' ? 'Embers' : 'Lit') : counting ? 'Lighting' : 'Unlit'}</div>
              <div className="small">fire</div>
            </div>
          </div>

          {!lit && !counting && (
            <div className="admin-ignite">
              <label className="inline">
                <span>Countdown</span>
                <select value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
                  <option value={10}>10 s</option>
                  <option value={5}>5 s</option>
                  <option value={3}>3 s</option>
                </select>
              </label>
              <button className="btn fire" onClick={() => run('ignite', { delay })}>
                Shoot the fire arrow
              </button>
            </div>
          )}
          {(lit || counting) && (
            <div className="admin-grid">
              <button className="btn" onClick={() => run('stoke')} disabled={!lit}>
                Stoke the fire
              </button>
              <button className="btn" onClick={() => run('embers')} disabled={!lit}>
                {fire.mode === 'embers' ? 'Rekindle' : 'Let it burn low'}
              </button>
              <button className="btn" onClick={() => run('extinguish')}>
                Put it out
              </button>
            </div>
          )}

          <div className="admin-sub">Rehearsal</div>
          <div className="admin-grid">
            <button className="btn" onClick={() => run('seed', { count: 20 })}>
              Add 20 test logs
            </button>
            <button className="btn" onClick={() => run('seed', { count: 100, spread: 120 })}>
              Add 100 test logs
            </button>
            {!confirmReset ? (
              <button className="btn danger" onClick={() => setConfirmReset(true)}>
                Reset everything
              </button>
            ) : (
              <button
                className="btn danger"
                onClick={() => {
                  setConfirmReset(false);
                  run('reset');
                }}
              >
                Confirm: delete all logs
              </button>
            )}
          </div>

          <div className="admin-sub">Latest logs</div>
          <ul className="admin-logs">
            {[...logs]
              .reverse()
              .slice(0, 40)
              .map((l) => (
                <li key={l.id}>
                  <span>
                    {l.name}
                    {l.batch ? ` · ${l.batch}` : ''}
                    {l.message ? <em> “{l.message}”</em> : null}
                  </span>
                  <button className="link" onClick={() => run('hide', { id: l.id })}>
                    Remove
                  </button>
                </li>
              ))}
          </ul>
          {msg && <div className="error">{msg}</div>}
          <div className="fine">Press H to hide all on-screen text for screen sharing.</div>
        </>
      )}
    </aside>
  );
}

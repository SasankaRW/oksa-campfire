'use client';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { adminAction } from '@/lib/realtime';
import { COUNTDOWN_SECONDS, MAX_COUNTDOWN_SECONDS, formatCountdown } from '@/lib/config';

/* What each action changes, applied instantly on this screen while the server confirms. */
function optimistic(action, extra, T) {
  switch (action) {
    case 'ignite':
      return { ignite_at: T + (extra.delay ?? 10) * 1000, mode: 'normal' };
    case 'extinguish':
      return { ignite_at: null, mode: 'normal' };
    case 'stoke':
      return { stoke_at: T };
    case 'embers':
      return { mode: extra.mode };
    case 'memories_start':
      return { memories_at: T + 1500, memories_paused_at: null };
    case 'memories_stop':
      return { memories_at: null, memories_paused_at: null };
    case 'memories_pause': {
      const f = useStore.getState().fire;
      return f.memories_at && !f.memories_paused_at ? { memories_paused_at: T } : null;
    }
    case 'memories_resume': {
      const f = useStore.getState().fire;
      return f.memories_at && f.memories_paused_at ? { memories_at: f.memories_at + (T - f.memories_paused_at), memories_paused_at: null } : null;
    }
    case 'cheer':
      return { cheer_at: T + 1200, cheer_text: extra.text || '' };
    case 'song_start':
      return { song_at: T, song_title: extra.title || '' };
    case 'song_stop':
      return { song_at: null };
    case 'quiz':
      return { quiz_on: !!extra.on, ...(typeof extra.url === 'string' ? { quiz_url: extra.url.trim() } : {}) };
    default:
      return null;
  }
}

const TABS = [
  ['fire', 'Fire'],
  ['moments', 'Moments'],
  ['leaders', 'Leaders'],
  ['guests', 'Guests'],
  ['setup', 'Rehearse'],
];

function Spinner() {
  return <span className="spin" aria-hidden="true" />;
}

// Defined outside the panel so buttons are not re-created on every render
// (that used to swallow clicks while the page refreshed).
function Btn({ busy, children, onClick, className = '', disabled, title }) {
  return (
    <button className={`btn ${className} ${busy ? 'busy' : ''}`} onClick={onClick} disabled={disabled || busy} title={title}>
      {busy ? <Spinner /> : null}
      <span>{children}</span>
    </button>
  );
}

export default function AdminPanel() {
  const logs = useStore((s) => s.logs);
  const adminLeaders = useStore((s) => s.adminLeaders);
  const pubLeaders = useStore((s) => s.leaders);
  const fire = useStore((s) => s.fire);
  const online = useStore((s) => s.online);
  const demo = useStore((s) => s.demo);

  const [pass, setPass] = useState('');
  const [authed, setAuthed] = useState(false);
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState('fire');
  const [pending, setPending] = useState({}); // key -> true
  const [toast, setToast] = useState(null); // { text, kind }
  const [confirm, setConfirm] = useState(null); // key awaiting a second click
  const [delay, setDelay] = useState(COUNTDOWN_SECONDS);
  const [custom, setCustom] = useState(false);
  const [cMin, setCMin] = useState('5');
  const [cSec, setCSec] = useState('0');
  const [draft, setDraft] = useState(null);
  const [copied, setCopied] = useState(-1);
  const [cheerText, setCheerText] = useState('Three cheers for Kingswood!');
  const [songTitle, setSongTitle] = useState('');
  const [filter, setFilter] = useState('');
  const [quizUrl, setQuizUrl] = useState(null); // null until loaded from the fire
  const toastTimer = useRef(null);
  const confirmTimer = useRef(null);

  useEffect(() => {
    try {
      const p = sessionStorage.getItem('campfire.admin');
      if (p) {
        setPass(p);
        setAuthed(true);
      }
      const t = sessionStorage.getItem('campfire.admin.tab');
      if (t) setTab(t);
    } catch {}
  }, []);

  // load leaders, then keep the server warm so clicks respond quickly
  useEffect(() => {
    if (!authed || !pass) return;
    adminAction(pass, 'login').catch(() => {});
    const id = setInterval(() => adminAction(pass, 'ping').catch(() => {}), 4 * 60 * 1000);
    return () => clearInterval(id);
  }, [authed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (draft === null && adminLeaders.length) {
      setDraft([0, 1, 2, 3, 4].map((i) => ({ name: adminLeaders[i]?.name || '', title: adminLeaders[i]?.title || '' })));
    }
  }, [adminLeaders, draft]);

  // fill the quiz link box with the saved link once it arrives
  useEffect(() => {
    if (quizUrl === null && fire.quiz_url) setQuizUrl(fire.quiz_url);
  }, [fire.quiz_url, quizUrl]);

  function say(text, kind = 'ok') {
    clearTimeout(toastTimer.current);
    setToast({ text, kind });
    toastTimer.current = setTimeout(() => setToast(null), kind === 'err' ? 5000 : 1800);
  }

  // Runs an action: instant local feedback, spinner on the button, toast when done.
  async function run(action, extra = {}, key = action, doneText = 'Done') {
    if (pending[key]) return;
    setConfirm(null);
    const st = useStore.getState();
    const before = st.fire;
    const patch = optimistic(action, extra, Date.now() + st.offset);
    if (patch) st.setFire(patch);
    setPending((p) => ({ ...p, [key]: true }));
    try {
      await adminAction(pass, action, extra);
      if (action === 'login') {
        setAuthed(true);
        try {
          sessionStorage.setItem('campfire.admin', pass);
        } catch {}
      } else if (doneText) say(doneText);
    } catch (e) {
      if (patch) useStore.getState().setFire(before);
      say(e.message || 'That did not work. Try again.', 'err');
      if (action === 'login') setAuthed(false);
    } finally {
      setPending((p) => {
        const n = { ...p };
        delete n[key];
        return n;
      });
    }
  }

  // Two-step confirm for anything destructive
  function confirmThen(key, fn) {
    if (confirm === key) {
      setConfirm(null);
      fn();
    } else {
      setConfirm(key);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirm(null), 4000);
    }
  }

  function pickTab(t) {
    setTab(t);
    try {
      sessionStorage.setItem('campfire.admin.tab', t);
    } catch {}
  }

  const now = Date.now() + useStore.getState().offset;
  const lit = fire.ignite_at && fire.ignite_at <= now;
  const counting = fire.ignite_at && fire.ignite_at > now;
  const countLeft = counting ? Math.ceil((fire.ignite_at - now) / 1000) : 0;
  const fireLabel = lit
    ? fire.mode === 'embers'
      ? 'Burning low'
      : 'Lit'
    : counting
      ? `Lighting in ${countLeft > 60 ? formatCountdown(countLeft) : `${countLeft}s`}`
      : 'Not lit';
  // custom timer: whole minutes + seconds, 1s to MAX_COUNTDOWN_SECONDS
  const chosenDelay = custom ? (parseInt(cMin, 10) || 0) * 60 + (parseInt(cSec, 10) || 0) : delay;
  const customBad = chosenDelay < 1 || chosenDelay > MAX_COUNTDOWN_SECONDS;

  if (!open)
    return (
      <button className="admin-toggle" onClick={() => setOpen(true)}>
        Fire keeper
      </button>
    );

  const leadersNamed = adminLeaders.filter((l) => l.name);
  const nextLeader = leadersNamed.find((l) => !(pubLeaders.find((p) => p.slot === l.slot)?.called_at || l.called_at));
  const shownLogs = [...logs]
    .reverse()
    .filter((l) => !filter || l.name.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, 60);

  return (
    <aside className="admin">
      <div className="admin-head">
        <div>
          <div className="eyebrow">Fire keeper</div>
          <div className="admin-title">Controls</div>
        </div>
        <button className="btn ghost sm" onClick={() => setOpen(false)} title="Hide this panel (press H to hide all text)">
          Hide
        </button>
      </div>

      {!authed ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run('login', {}, 'login', null);
          }}
        >
          <label>
            <span>Passcode{demo ? ' (demo: "demo")' : ''}</span>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
          </label>
          <Btn busy={!!pending['login']} className="primary">
            Enter
          </Btn>
        </form>
      ) : (
        <>
          <div className="admin-status">
            <div className={`chip ${lit ? 'on' : counting ? 'warn' : ''}`}>
              <i /> {fireLabel}
            </div>
            <div className="chip">{online} online</div>
            <div className="chip">{logs.length} logs</div>
            {fire.memories_at ? <div className={`chip ${fire.memories_paused_at ? 'warn' : 'on'}`}>{fire.memories_paused_at ? 'Photos paused' : 'Photos playing'}</div> : null}
            {fire.song_at ? <div className="chip on">Sing-along</div> : null}
            {fire.quiz_on ? <div className="chip on">Quiz button showing</div> : null}
          </div>

          <nav className="admin-tabs" role="tablist">
            {TABS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pickTab(k)}>
                {label}
              </button>
            ))}
          </nav>

          <div className="admin-body">
            {/* ------------------------------ FIRE ------------------------------ */}
            {tab === 'fire' && (
              <section>
                {!lit && !counting && (
                  <>
                    <p className="hint2">When everyone has laid their log, shoot the fire arrow. A countdown shows on every screen first.</p>
                    <div className="seg four" role="radiogroup" aria-label="Countdown">
                      {[10, 5, 3].map((s) => (
                        <button key={s} role="radio" aria-checked={!custom && delay === s} className={!custom && delay === s ? 'on' : ''}
                          onClick={() => {
                            setCustom(false);
                            setDelay(s);
                          }}
                        >
                          {s}s
                        </button>
                      ))}
                      <button role="radio" aria-checked={custom} className={custom ? 'on' : ''} onClick={() => setCustom(true)}>
                        Custom
                      </button>
                    </div>
                    {custom && (
                      <div className="custom-timer">
                        <label>
                          <input type="number" inputMode="numeric" min="0" max={MAX_COUNTDOWN_SECONDS / 60} value={cMin}
                            onChange={(e) => setCMin(e.target.value)}
                          />
                          <span>min</span>
                        </label>
                        <label>
                          <input type="number" inputMode="numeric" min="0" max="59" value={cSec}
                            onChange={(e) => setCSec(e.target.value)}
                          />
                          <span>sec</span>
                        </label>
                      </div>
                    )}
                    {custom && customBad && <p className="hint2 warnline">Pick a time up to {MAX_COUNTDOWN_SECONDS / 60} minutes.</p>}
                    <Btn busy={!!pending['ignite']} className="fire big-act" disabled={custom && customBad}
                      onClick={() => run('ignite', { delay: chosenDelay }, 'ignite', 'Fire arrow drawn')}
                    >
                      {custom && !customBad ? `Shoot the fire arrow in ${formatCountdown(chosenDelay)}` : 'Shoot the fire arrow'}
                    </Btn>
                  </>
                )}
                {counting && (
                  <div className="countbox">
                    <div className="countnum">{countLeft > 60 ? formatCountdown(countLeft) : countLeft}</div>
                    <div>The arrow flies when the countdown ends.</div>
                  </div>
                )}
                {lit && (
                  <>
                    <p className="hint2">The fire is burning. Use these for big moments.</p>
                    <div className="admin-grid two">
                      <Btn busy={!!pending['stoke']} onClick={() => run('stoke', {}, 'stoke', 'Fire stoked')}>
                        Stoke the fire
                      </Btn>
                      <Btn busy={!!pending['embers']}
                        onClick={() =>
                          run('embers', { mode: fire.mode === 'embers' ? 'normal' : 'embers' }, 'embers', fire.mode === 'embers' ? 'Rekindled' : 'Burning low')
                        }
                      >
                        {fire.mode === 'embers' ? 'Rekindle' : 'Let it burn low'}
                      </Btn>
                    </div>
                  </>
                )}
                {(lit || counting) && (
                  <Btn busy={!!pending['extinguish']}
                    className={`danger ${confirm === 'extinguish' ? 'confirming' : ''}`}
                    onClick={() => confirmThen('extinguish', () => run('extinguish', {}, 'extinguish', 'Fire put out'))}
                  >
                    {counting
                      ? confirm === 'extinguish' ? 'Click again to cancel' : 'Cancel the countdown'
                      : confirm === 'extinguish' ? 'Click again to put it out' : 'Put the fire out'}
                  </Btn>
                )}
              </section>
            )}

            {/* ---------------------------- MOMENTS ---------------------------- */}
            {tab === 'moments' && (
              <section>
                {!lit && <p className="hint2 warnline">These work best after the fire is lit.</p>}

                <div className="card2">
                  <div className="card2-title">Memory photos</div>
                  <p className="hint2">The view pulls back and the photos glide past in the sky behind the fire, on every screen.</p>
                  {!fire.memories_at ? (
                    <Btn busy={!!pending['mem']} className="primary-soft" onClick={() => run('memories_start', {}, 'mem', 'Photos started')}>
                      Start photos
                    </Btn>
                  ) : (
                    <div className="admin-grid two">
                      {fire.memories_paused_at ? (
                        <Btn busy={!!pending['mempause']} className="primary-soft" onClick={() => run('memories_resume', {}, 'mempause', 'Photos playing')}>
                          Resume photos
                        </Btn>
                      ) : (
                        <Btn busy={!!pending['mempause']} onClick={() => run('memories_pause', {}, 'mempause', 'Photos paused')}>
                          Pause photos
                        </Btn>
                      )}
                      <Btn busy={!!pending['mem']} onClick={() => run('memories_stop', {}, 'mem', 'Photos stopped')}>
                        Stop photos
                      </Btn>
                    </div>
                  )}
                </div>

                <div className="card2">
                  <div className="card2-title">Three cheers</div>
                  <input value={cheerText} onChange={(e) => setCheerText(e.target.value)} placeholder="Three cheers for… (optional)" />
                  <Btn busy={!!pending['cheer']} className="primary-soft" onClick={() => run('cheer', { text: cheerText }, 'cheer', 'Cheers started')}>
                    Hip hip, hooray ×3
                  </Btn>
                </div>

                <div className="card2">
                  <div className="card2-title">Kahoot quiz</div>
                  <p className="hint2">Shows a “Join the quiz” button on every guest's screen. It opens the link in a new tab.</p>
                  <input
                    type="url"
                    inputMode="url"
                    value={quizUrl ?? ''}
                    onChange={(e) => setQuizUrl(e.target.value)}
                    placeholder="https://kahoot.it/?pin=…"
                  />
                  {!fire.quiz_on ? (
                    <Btn busy={!!pending['quiz']} className="primary-soft" disabled={!(quizUrl || '').trim()}
                      onClick={() => run('quiz', { url: quizUrl || '', on: true }, 'quiz', 'Quiz button is showing')}
                    >
                      Show quiz button to everyone
                    </Btn>
                  ) : (
                    <div className="admin-grid two">
                      <Btn busy={!!pending['quizsave']} disabled={!(quizUrl || '').trim() || (quizUrl || '').trim() === fire.quiz_url}
                        onClick={() => run('quiz', { url: quizUrl || '', on: true }, 'quizsave', 'Quiz link updated')}
                      >
                        Update link
                      </Btn>
                      <Btn busy={!!pending['quiz']} onClick={() => run('quiz', { on: false }, 'quiz', 'Quiz button hidden')}>
                        Hide quiz button
                      </Btn>
                    </div>
                  )}
                </div>

                <div className="card2">
                  <div className="card2-title">Sing-along</div>
                  {!fire.song_at ? (
                    <>
                      <input value={songTitle} onChange={(e) => setSongTitle(e.target.value)} placeholder="Song name" />
                      <Btn busy={!!pending['song']} className="primary-soft" onClick={() => run('song_start', { title: songTitle }, 'song', 'Sing-along on')}>
                        Start sing-along
                      </Btn>
                    </>
                  ) : (
                    <>
                      <p className="hint2">Now singing: {fire.song_title || 'Campfire song'}</p>
                      <Btn busy={!!pending['song']} onClick={() => run('song_stop', {}, 'song', 'Sing-along ended')}>
                        End sing-along
                      </Btn>
                    </>
                  )}
                </div>
              </section>
            )}

            {/* ---------------------------- LEADERS ---------------------------- */}
            {tab === 'leaders' && (
              <section className="admin-leaders">
                {leadersNamed.length > 0 && (
                  <>
                    <Btn busy={!!pending['callnext']}
                      className="fire big-act"
                      disabled={!nextLeader}
                      onClick={() => nextLeader && run('leader_call', { slot: nextLeader.slot }, 'callnext', `Called ${nextLeader.name}`)}
                    >
                      {nextLeader ? `Call next: ${nextLeader.name}` : 'All leaders called'}
                    </Btn>
                    {leadersNamed.map((l) => {
                      const p = pubLeaders.find((x) => x.slot === l.slot) || {};
                      const laid = p.laid_at || l.laid_at;
                      const called = p.called_at || l.called_at;
                      return (
                        <div className="lstat" key={l.slot}>
                          <div className="who">
                            <b>{l.slot + 1}.</b> {l.name} {l.title ? <em>· {l.title}</em> : null}
                          </div>
                          <span className={`tag2 ${laid ? 'laid' : called ? 'called' : ''}`}>
                            {laid ? 'Laid' : called ? 'Waiting for them' : 'Not called'}
                          </span>
                          <div className="lacts">
                            <button
                              className="mini"
                              onClick={() => {
                                navigator.clipboard?.writeText(`${location.origin}/?leader=${l.token}`);
                                setCopied(l.slot);
                                setTimeout(() => setCopied(-1), 1500);
                              }}
                            >
                              {copied === l.slot ? 'Copied' : 'Copy link'}
                            </button>
                            {!called && (
                              <Btn busy={!!pending['call' + l.slot]} className="mini" onClick={() => run('leader_call', { slot: l.slot }, 'call' + l.slot, `Called ${l.name}`)}>
                                Call
                              </Btn>
                            )}
                            {!laid && (
                              <Btn busy={!!pending['lay' + l.slot]} className="mini" onClick={() => run('leader_lay', { slot: l.slot }, 'lay' + l.slot, `Laid for ${l.name}`)}>
                                Lay for them
                              </Btn>
                            )}
                            {(called || laid) && (
                              <Btn busy={!!pending['undo' + l.slot]}
                                className={`mini ${confirm === 'undo' + l.slot ? 'confirming' : ''}`}
                                onClick={() => confirmThen('undo' + l.slot, () => run('leader_reset', { slot: l.slot }, 'undo' + l.slot, 'Undone'))}
                              >
                                {confirm === 'undo' + l.slot ? 'Sure?' : 'Undo'}
                              </Btn>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}

                <details className="ldetails" open={leadersNamed.length === 0}>
                  <summary>{leadersNamed.length ? 'Edit names and titles' : 'Add the 5 leaders'}</summary>
                  {(draft || [0, 1, 2, 3, 4].map(() => ({ name: '', title: '' }))).map((l, i) => (
                    <div className="lrow" key={i}>
                      <input
                        placeholder={`Leader ${i + 1} name`}
                        value={l.name}
                        onChange={(e) => {
                          const d = [...(draft || [0, 1, 2, 3, 4].map(() => ({ name: '', title: '' })))];
                          d[i] = { ...d[i], name: e.target.value };
                          setDraft(d);
                        }}
                      />
                      <input
                        placeholder="Title"
                        value={l.title}
                        onChange={(e) => {
                          const d = [...(draft || [0, 1, 2, 3, 4].map(() => ({ name: '', title: '' })))];
                          d[i] = { ...d[i], title: e.target.value };
                          setDraft(d);
                        }}
                      />
                    </div>
                  ))}
                  <Btn busy={!!pending['lsave']} className="primary-soft" onClick={() => run('leaders_save', { leaders: draft || [] }, 'lsave', 'Leaders saved')}>
                    Save and make links
                  </Btn>
                  <p className="hint2">Links stay the same when you edit names.</p>
                </details>
              </section>
            )}

            {/* ----------------------------- GUESTS ----------------------------- */}
            {tab === 'guests' && (
              <section>
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search names" />
                <ul className="admin-logs">
                  {shownLogs.map((l) => (
                    <li key={l.id}>
                      <span>
                        {l.name}
                        {l.batch ? ` · ${l.batch}` : ''}
                        {l.message ? <em> “{l.message}”</em> : null}
                      </span>
                      <Btn busy={!!pending['hide' + l.id]}
                        className={`mini ${confirm === 'hide' + l.id ? 'confirming' : ''}`}
                        onClick={() => confirmThen('hide' + l.id, () => run('hide', { id: l.id }, 'hide' + l.id, 'Log removed'))}
                      >
                        {confirm === 'hide' + l.id ? 'Remove?' : 'Remove'}
                      </Btn>
                    </li>
                  ))}
                  {!shownLogs.length && <li className="empty">No logs yet</li>}
                </ul>
              </section>
            )}

            {/* ----------------------------- SETUP ----------------------------- */}
            {tab === 'setup' && (
              <section>
                <p className="hint2">Use these to rehearse. Reset everything before the event starts.</p>
                <div className="admin-grid two">
                  <Btn busy={!!pending['seed20']} onClick={() => run('seed', { count: 20 }, 'seed20', '20 test logs added')}>
                    Add 20 test logs
                  </Btn>
                  <Btn busy={!!pending['seed100']} onClick={() => run('seed', { count: 100, spread: 120 }, 'seed100', '100 test logs added')}>
                    Add 100 test logs
                  </Btn>
                </div>
                <Btn busy={!!pending['reset']}
                  className={`danger ${confirm === 'reset' ? 'confirming' : ''}`}
                  onClick={() => confirmThen('reset', () => run('reset', {}, 'reset', 'Everything reset'))}
                >
                  {confirm === 'reset' ? 'Click again: delete all logs and put the fire out' : 'Reset everything'}
                </Btn>
                <p className="fine">Press H to hide all on-screen text when screen sharing.</p>
              </section>
            )}
          </div>
        </>
      )}

      {toast && (
        <div className={`admin-toast ${toast.kind}`} role="status">
          {toast.kind === 'ok' ? '✓ ' : ''}
          {toast.text}
        </div>
      )}
    </aside>
  );
}

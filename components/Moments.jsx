'use client';
// After the fire is lit: "three cheers" and the sing-along banner
// (memory photos are drawn in the sky by MemorySky). All timed from shared server
// timestamps so every screen shows the same thing at the same moment.
import { memo, useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import { emit } from '@/lib/bus';
import { BEAT } from '@/lib/beat';
import { playClap } from '@/lib/audio';

function hash(n) {
  const s = Math.sin(n * 91.7 + 12.3) * 43758.5453;
  return s - Math.floor(s);
}

export default function Moments({ now }) {
  const fire = useStore((s) => s.fire);
  /* ---------- three cheers ---------- */
  const c = fire.cheer_at ? (now - fire.cheer_at) / 1000 : null;
  const cheerOn = c !== null && c > -1.2 && c < 10.6;
  let cheerWord = null;
  let cheerKey = '';
  if (cheerOn) {
    for (let k = 0; k < 3; k++) {
      const hk = 1.6 + 2.8 * k;
      if (c >= hk - 1.4 && c < hk) {
        cheerWord = 'Hip hip…';
        cheerKey = 'h' + k;
      }
      if (c >= hk && c < hk + 1.3) {
        cheerWord = 'Hooray!';
        cheerKey = 'H' + k;
      }
    }
  }
  // during the cheer, anyone can tap to throw sparks and clap
  useEffect(() => {
    if (!cheerOn) return;
    const tap = (e) => {
      if (e.target.closest('button, input, select, a, .admin')) return;
      emit('local-burst');
      playClap();
    };
    window.addEventListener('pointerdown', tap);
    return () => window.removeEventListener('pointerdown', tap);
  }, [cheerOn]);

  /* ---------- sing-along ---------- */
  const song = fire.song_at ? fire.song_title || 'Campfire song' : null;

  return (
    <>
      {/* the photos themselves are drawn in the sky by MemorySky; this tells the page they're on */}
      {fire.memories_at ? <div className="memories-live" hidden /> : null}

      {cheerOn && (
        <div className="cheer">
          {fire.cheer_text && c < 0.4 ? <div className="cheer-lead">{fire.cheer_text}</div> : null}
          {cheerWord && (
            <div key={cheerKey} className={`cheer-word ${cheerWord === 'Hooray!' ? 'big' : ''}`}>
              {cheerWord}
            </div>
          )}
          {c > 0 && <div className="cheer-tip">Tap anywhere to cheer along</div>}
        </div>
      )}

      {song && <SongLayer key={fire.song_at} songAt={fire.song_at} title={song} />}
    </>
  );
}

// Sing-along: notes rising from the fire, a warm glow and a banner that pulse
// on a shared beat, and tap-anywhere to clap along. Everything is pure CSS
// animation started once with a delay that lines it up with the shared beat,
// so it costs nothing per frame and stays in step on every screen.
const NOTE_GLYPHS = ['♪', '♫', '♩', '♬'];
const NOTES = Array.from({ length: 14 }, (_, i) => {
  const beats = 6 + Math.floor(hash(i + 50) * 4); // each note lives 6-9 beats
  return {
    i,
    g: NOTE_GLYPHS[i % 4],
    x: 50 + (hash(i + 10) - 0.5) * 26, // vw, around the fire
    sx: (hash(i + 20) - 0.5) * 12, // vw, sway
    size: 20 + hash(i + 30) * 22,
    dur: beats * BEAT,
    d: Math.floor(hash(i + 40) * 8) * BEAT * 0.5, // start on a half-beat
  };
});
const EQ = [1, 0.5, 1, 0.5, 1];

const SongLayer = memo(function SongLayer({ songAt, title }) {
  const [bd] = useState(() => {
    const t = (useStore.getState().now() - songAt) / 1000;
    return -(((t % BEAT) + BEAT) % BEAT); // line the CSS beat up with the shared one
  });
  const [taps, setTaps] = useState([]);
  useEffect(() => {
    let id = 0;
    const tap = (e) => {
      if (e.target.closest('button, input, select, a, .admin, .admin-toggle')) return;
      playClap();
      emit('song-tap');
      const n = { id: ++id, x: e.clientX, y: e.clientY, g: NOTE_GLYPHS[id % 4] };
      setTaps((t) => [...t.slice(-6), n]);
      setTimeout(() => setTaps((t) => t.filter((q) => q.id !== n.id)), 1200);
    };
    window.addEventListener('pointerdown', tap, true);
    return () => window.removeEventListener('pointerdown', tap, true);
  }, []);
  return (
    <div className="song-layer" style={{ '--beat': `${BEAT}s`, '--bd': `${bd}s` }} aria-live="polite">
      <div className="song-glow" />
      <div className="song-notes" aria-hidden="true">
        {NOTES.map((n) => (
          <span
            key={n.i}
            style={{ left: `${n.x}vw`, fontSize: `${n.size}px`, '--sx': `${n.sx}vw`, '--dur': `${n.dur}s`, '--d': `${n.d}s` }}
          >
            {n.g}
          </span>
        ))}
      </div>
      {taps.map((t) => (
        <span key={t.id} className="tap-note" style={{ left: t.x, top: t.y }} aria-hidden="true">
          {t.g}
        </span>
      ))}
      <div className="song-wrap">
        <div className="song">
          <span className="eq" aria-hidden="true">
            {EQ.map((_, i) => (
              <i key={i} style={{ '--d': `${i % 2 ? BEAT / 2 : 0}s`, animationDuration: `${i % 2 ? BEAT / 2 : BEAT}s` }} />
            ))}
          </span>
          <span className="song-text">
            Sing along · <em>{title}</em>
          </span>
        </div>
        <div className="song-tip">Tap anywhere to clap along</div>
      </div>
    </div>
  );
});

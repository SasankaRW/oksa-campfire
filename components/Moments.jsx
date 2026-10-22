'use client';
// After the fire is lit: framed memory photos floating over the scene,
// "three cheers", and the sing-along banner. All timed from shared server
// timestamps so every screen shows the same thing at the same moment.
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { emit } from '@/lib/bus';
import { BEAT } from '@/lib/beat';
import { playClap } from '@/lib/audio';

const INTERVAL = 3.6; // seconds between photos
const LIFE = 11; // seconds each photo stays on screen

function hash(n) {
  const s = Math.sin(n * 91.7 + 12.3) * 43758.5453;
  return s - Math.floor(s);
}

export default function Moments({ now }) {
  const fire = useStore((s) => s.fire);
  const [photos, setPhotos] = useState([]);
  const preloaded = useRef(new Set());
  const [loaded, setLoaded] = useState(() => new Set());
  const markLoaded = (src) =>
    setLoaded((prev) => {
      if (prev.has(src)) return prev;
      const n = new Set(prev);
      n.add(src);
      return n;
    });

  useEffect(() => {
    fetch('/memories/manifest.json')
      .then((r) => r.json())
      .then((j) => {
        const list = j.photos || [];
        setPhotos(list);
        list.slice(0, 4).forEach((p) => {
          preloaded.current.add(p.src);
          const img = new Image();
          img.src = p.src;
          img.decode().then(() => markLoaded(p.src)).catch(() => markLoaded(p.src));
        });
      })
      .catch(() => {});
  }, []);

  /* ---------- memories ---------- */
  const portrait = typeof window !== 'undefined' && window.innerWidth / window.innerHeight < 0.9;
  const mem = useMemo(() => {
    if (!fire.memories_at || !photos.length) return [];
    const t = (now - fire.memories_at) / 1000;
    if (t < 0) return [];
    const last = Math.floor(t / INTERVAL);
    const first = Math.max(0, Math.floor((t - LIFE) / INTERVAL) + 1);
    const out = [];
    for (let k = first; k <= last; k++) {
      const p = photos[k % photos.length];
      out.push({ k, p, age: t - k * INTERVAL });
    }
    // warm up the next few images so they appear instantly
    for (let k = Math.max(0, last - 2); k <= last + 4; k++) {
      const src = photos[k % photos.length]?.src;
      if (src && !preloaded.current.has(src)) {
        preloaded.current.add(src);
        const img = new Image();
        img.decoding = 'async';
        img.src = src;
        img.decode().then(() => markLoaded(src)).catch(() => markLoaded(src));
      }
    }
    return out;
  }, [fire.memories_at, photos, Math.floor(now / 250)]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="memories" aria-hidden="true">
        {mem
          .filter(({ k }) => !(portrait && k % 3 === 2)) // phones: two at a time
          .map(({ k, p, age }) => (
            <MemoryPhoto key={k} k={k} src={p.src} caption={p.caption} age={age} ready={loaded.has(p.src)} portrait={portrait} />
          ))}
      </div>

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

// Each photo fixes its timing once, when it first appears. Its style never
// changes after that, so the browser runs the float animation smoothly on the
// GPU instead of restarting it on every update (which caused the little jumps).
// Photos rotate through fixed "safe" spots that never cover the fire, the title,
// the counters or the feed, and the photos on screen at the same time never share a spot.
const DESKTOP_SLOTS = [
  { x: 6, y: 16 }, // left, high (below the title)
  { x: 74, y: 52 }, // right, lower
  { x: 7, y: 50 }, // left, lower
  { x: 73, y: 18 }, // right, high (below the counter)
];
const PHONE_SLOTS = [
  { x: 5, y: 18 }, // left, below the title and the "laid a log" line
  { x: 53, y: 19 }, // right, a touch lower, clear of the zoom buttons
];

const MemoryPhoto = memo(
  function MemoryPhoto({ k, src, caption, age, ready, portrait }) {
    const [start] = useState(() => age);
    const slots = portrait ? PHONE_SLOTS : DESKTOP_SLOTS;
    const slot = portrait ? slots[(k % 3) % 2] : slots[k % slots.length];
    const left = slot.x < 50;
    const r = (hash(k) - 0.5) * 6;
    const x = slot.x + (hash(k + 3) - 0.5) * (portrait ? 1.5 : 4);
    const y = slot.y + (hash(k + 7) - 0.5) * 2;
    return (
      <figure
        className={`memory ${left ? 'l' : 'r'} ${ready ? '' : 'pending'}`}
        style={{
          left: `${x}vw`,
          top: `${y}vh`,
          '--r': `${r}deg`,
          animationDuration: `${LIFE}s`,
          animationDelay: `${-start}s`,
          animationPlayState: ready ? 'running' : 'paused',
        }}
      >
        <div className="memory-frame">
          <div className="memory-mat">
            <img src={src} alt="" decoding="sync" />
            {caption ? <figcaption>{caption}</figcaption> : null}
          </div>
        </div>
      </figure>
    );
  },
  (a, b) => a.k === b.k && a.ready === b.ready && a.src === b.src && a.portrait === b.portrait,
);

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

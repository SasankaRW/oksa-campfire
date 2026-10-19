'use client';
// After the fire is lit: framed memory photos floating over the scene,
// "three cheers", and the sing-along banner. All timed from shared server
// timestamps so every screen shows the same thing at the same moment.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { emit } from '@/lib/bus';
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
        {mem.map(({ k, p, age }) => {
          const left = k % 2 === 0;
          const r = (hash(k) - 0.5) * 7;
          const x = left ? 3 + hash(k + 3) * 16 : 63 + hash(k + 3) * 16;
          const y = 14 + hash(k + 7) * 30;
          return (
            <figure
              key={k}
              className={`memory ${left ? 'l' : 'r'} ${loaded.has(p.src) ? '' : 'pending'}`}
              style={{
                left: `${x}vw`,
                top: `${y}vh`,
                '--r': `${r}deg`,
                animationDuration: `${LIFE}s`,
                animationDelay: `${-age}s`,
              }}
            >
              <div className="memory-frame">
                <div className="memory-mat">
                  <img src={p.src} alt="" decoding="sync" />
                  {p.caption ? <figcaption>{p.caption}</figcaption> : null}
                </div>
              </div>
            </figure>
          );
        })}
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

      {song && (
        <div className="song">
          <span className="song-note">♪</span>
          <span>
            Sing along · <em>{song}</em>
          </span>
        </div>
      )}
    </>
  );
}

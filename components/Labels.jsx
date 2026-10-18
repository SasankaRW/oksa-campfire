'use client';
import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { on, shared } from '@/lib/bus';
import { useStore } from '@/lib/store';
import { getSlot } from './Logs';

let uid = 0;
const short = (b) => (b ? ` · '${String(b).slice(-2)}` : '');

// Name tags that appear over a log as it lands, and names that rise with the
// embers once the fire is lit.
export default function Labels({ embersOfNames = true }) {
  const [items, setItems] = useState([]);
  const nextEmber = useRef(0);

  useEffect(() => {
    const add = (it) =>
      setItems((xs) => {
        const now = performance.now();
        const busy = xs.filter((x) => x.kind === 'land' && !x.mine && now - x.born < 1500).length;
        if (it.kind === 'land' && !it.mine && busy >= 2) return xs;
        return [...xs.slice(-8), { id: ++uid, born: now, ...it }];
      });
    const off1 = on('landed', ({ log, mine, top, base }) => {
      if (!mine) return; // only your own log gets a tag
      add({
        kind: 'land',
        pos: base.clone().lerp(top, 0.3).add(new THREE.Vector3(0, 0.28, 0)),
        name: 'Your log',
        mine,
        life: 6000,
      });
    });
    const off2 = on('focus-mine', () => {
      const st = useStore.getState();
      const i = st.logs.findIndex((l) => l.device_id === st.deviceId);
      if (i < 0) return;
      const s = getSlot(i);
      add({ kind: 'land', pos: s.base.clone().lerp(s.top, 0.3).add(new THREE.Vector3(0, 0.28, 0)), name: 'Your log', mine: true, life: 6000 });
    });
    return () => {
      off1();
      off2();
    };
  }, []);

  useFrame(() => {
    const now = performance.now();
    if (items.length && items.some((i) => now - i.born > i.life)) {
      setItems((xs) => xs.filter((i) => now - i.born <= i.life));
    }
    if (!embersOfNames || !shared.lit || shared.intensity < 0.35) return;
    if (now < nextEmber.current) return;
    nextEmber.current = now + 2600 + Math.random() * 2200;
    const logs = useStore.getState().logs;
    if (!logs.length) return;
    const l = logs[(Math.random() * logs.length) | 0];
    const a = Math.random() * Math.PI * 2;
    setItems((xs) => [
      ...xs.slice(-8),
      {
        id: ++uid,
        born: now,
        kind: 'ember',
        pos: new THREE.Vector3(Math.cos(a) * 0.3, 2.3 + shared.intensity * 0.8, Math.sin(a) * 0.3),
        drift: new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.4, (Math.random() - 0.5) * 0.4),
        name: l.name,
        life: 6500,
      },
    ]);
  });

  return items.map((it) => <Label key={it.id} it={it} />);
}

function Label({ it }) {
  const g = useRef();
  const el = useRef();
  useFrame(() => {
    const t = (performance.now() - it.born) / it.life;
    if (!g.current || !el.current) return;
    if (it.kind === 'ember') {
      g.current.position.copy(it.pos).addScaledVector(it.drift, t);
      g.current.position.x += Math.sin(t * 6 + it.id) * 0.08;
      el.current.style.opacity = String(Math.min(1, t * 5) * (1 - Math.pow(t, 1.6)) * 0.85);
    } else {
      g.current.position.copy(it.pos);
      g.current.position.y += t * 0.25;
      el.current.style.opacity = String(Math.min(1, t * 8) * (1 - Math.pow(Math.max(0, t - 0.6) / 0.4, 2)));
    }
  });
  return (
    <group ref={g} position={it.pos}>
      <Html center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div ref={el} className={`tag tag-${it.kind}${it.mine ? ' tag-mine' : ''}`} style={{ opacity: 0 }}>
          <span className="tag-name">{it.name}</span>
          {it.message ? <span className="tag-msg">“{it.message}”</span> : null}
        </div>
      </Html>
    </group>
  );
}

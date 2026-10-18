'use client';
// All sound is synthesised with Web Audio, so there are no audio files to host.
let ctx = null;
let master = null;
let fireGain = null;
let rumbleGain = null;
let nightGain = null;
let noiseBuf = null;
let crackleTimer = null;
let level = 0;
let enabled = false;

function makeNoise(seconds = 2, brown = false) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

function loop(buf) {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start();
  return s;
}

export function initAudio() {
  if (ctx) {
    ctx.resume();
    enabled = true;
    master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.5);
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  enabled = true;
  master = ctx.createGain();
  master.gain.value = 0;
  master.gain.setTargetAtTime(0.9, ctx.currentTime, 1.2);
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  noiseBuf = makeNoise(2);
  const brown = makeNoise(4, true);

  // Night: soft wind + distant crickets
  nightGain = ctx.createGain();
  nightGain.gain.value = 0.5;
  nightGain.connect(master);
  const wind = loop(brown);
  const wf = ctx.createBiquadFilter();
  wf.type = 'lowpass';
  wf.frequency.value = 380;
  const wg = ctx.createGain();
  wg.gain.value = 0.05;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 0.03;
  lfo.connect(lfoG).connect(wg.gain);
  lfo.start();
  wind.connect(wf).connect(wg).connect(nightGain);
  [4350, 4720, 3980].forEach((f, i) => cricket(f, 0.35 + i * 0.13, i));

  // Fire: low rumble/roar + crackle pops
  fireGain = ctx.createGain();
  fireGain.gain.value = 0;
  fireGain.connect(master);
  const roar = loop(brown);
  const rf = ctx.createBiquadFilter();
  rf.type = 'lowpass';
  rf.frequency.value = 220;
  rumbleGain = ctx.createGain();
  rumbleGain.gain.value = 0;
  roar.connect(rf).connect(rumbleGain).connect(fireGain);
  const hiss = loop(noiseBuf);
  const hf = ctx.createBiquadFilter();
  hf.type = 'bandpass';
  hf.frequency.value = 2400;
  hf.Q.value = 0.4;
  const hg = ctx.createGain();
  hg.gain.value = 0.012;
  hiss.connect(hf).connect(hg).connect(fireGain);
  scheduleCrackles();
}

function cricket(freq, rate, i) {
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = 0;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  if (pan.pan) pan.pan.value = [-0.7, 0.6, 0.1][i];
  osc.connect(g).connect(pan).connect(nightGain);
  osc.start();
  const chirp = () => {
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const s = t + k * 0.05;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(0.006, s + 0.012);
      g.gain.linearRampToValueAtTime(0, s + 0.035);
    }
    setTimeout(chirp, (1 / rate) * 1000 * (0.7 + Math.random() * 0.8));
  };
  setTimeout(chirp, Math.random() * 2000);
}

function pop(gain, freq, dur) {
  const t = ctx.currentTime + Math.random() * 0.02;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(fireGain);
  s.start(t, Math.random() * 1.5, dur + 0.02);
}

function scheduleCrackles() {
  const tick = () => {
    if (ctx && level > 0.02) {
      const n = Math.random() < level ? 1 + Math.floor(Math.random() * 3 * level) : 0;
      for (let i = 0; i < n; i++) {
        const big = Math.random() < 0.12;
        pop(big ? 0.5 : 0.12 + Math.random() * 0.2, big ? 1200 + Math.random() * 800 : 2000 + Math.random() * 4000, big ? 0.05 : 0.012 + Math.random() * 0.02);
      }
    }
    crackleTimer = setTimeout(tick, 40 + Math.random() * 120);
  };
  tick();
}

export function setFireLevel(v) {
  level = Math.max(0, Math.min(1.5, v));
  if (!ctx || !fireGain) return;
  const t = ctx.currentTime;
  fireGain.gain.setTargetAtTime(Math.min(1, level * 1.1), t, 0.4);
  rumbleGain.gain.setTargetAtTime(0.25 * level, t, 0.4);
  nightGain.gain.setTargetAtTime(0.5 - Math.min(0.3, level * 0.25), t, 1);
}

export function playThud(v = 0.6) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(95, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35 * v, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.4);
  // woody knock
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 700;
  f.Q.value = 3;
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.25 * v, t);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  s.connect(f).connect(g2).connect(master);
  s.start(t, 0, 0.15);
}

export function playStrike() {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 2;
  f.frequency.setValueAtTime(1800, t);
  f.frequency.exponentialRampToValueAtTime(6000, t + 0.18);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  s.connect(f).connect(g).connect(master);
  s.start(t, 0, 0.35);
  // flare hiss
  const s2 = ctx.createBufferSource();
  s2.buffer = noiseBuf;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'lowpass';
  f2.frequency.setValueAtTime(800, t + 0.15);
  f2.frequency.exponentialRampToValueAtTime(3500, t + 0.5);
  const g3 = ctx.createGain();
  g3.gain.setValueAtTime(0.0001, t + 0.15);
  g3.gain.exponentialRampToValueAtTime(0.18, t + 0.3);
  g3.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  s2.connect(f2).connect(g3).connect(master);
  s2.start(t + 0.15, 0, 1.4);
}

export function playWhoosh(v = 1) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(150, t);
  f.frequency.exponentialRampToValueAtTime(900, t + 0.6);
  f.frequency.exponentialRampToValueAtTime(200, t + 2.2);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
  s.connect(f).connect(g).connect(master);
  s.start(t, 0, 2.5);
}

export function muteAudio() {
  enabled = false;
  if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
}
export const audioOn = () => enabled;

// Bow release: a taut string thrum plus a rushing whoosh of the flaming arrow.
export function playTwang() {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(110, t + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.4);
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 0.8;
  f.frequency.setValueAtTime(500, t + 0.05);
  f.frequency.exponentialRampToValueAtTime(1800, t + 1.2);
  f.frequency.exponentialRampToValueAtTime(600, t + 2.0);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.0001, t + 0.05);
  g2.gain.exponentialRampToValueAtTime(0.22, t + 1.3);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
  s.connect(f).connect(g2).connect(master);
  s.start(t + 0.05, 0, 1.95);
}

// A slow, soft ceremonial drum: four beats leading into the honour log settling.
export function playDrum() {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + 0.05;
  [0, 1.15, 2.3, 3.45, 4.6].forEach((dt, i) => {
    const t = t0 + dt;
    const strong = i === 0 || i === 4;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(strong ? 78 : 92, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(strong ? 0.6 : 0.35, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 1);
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 400;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(strong ? 0.25 : 0.14, t);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    s.connect(f).connect(g2).connect(master);
    s.start(t, Math.random(), 0.2);
  });
}

// Draws the keepsake card: the fire as a real photographic print lying on dark card
// stock, with the guest's memory photo as a taped-on Polaroid. Pure canvas drawing,
// no app imports (only the dependency-free palette), so it can be previewed on its own.
import { THEME } from './theme.js';

const W = 1080;
const H = 1400;
const rad = (d) => (d * Math.PI) / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// small seeded random so every card has the same tape, leaks and fibres
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// a tileable noise texture for paper
function paperNoise(size, rand, fibres = 0) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (rand() - 0.5) * 70;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.lineCap = 'round';
  for (let i = 0; i < fibres; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI;
    const l = 4 + rand() * 14;
    g.strokeStyle = rand() < 0.5 ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
    g.lineWidth = 0.6;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rand() * 2, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  return c;
}

// tone curves as lookup tables, one per channel
function curves(fn) {
  const r = new Uint8ClampedArray(256);
  const gg = new Uint8ClampedArray(256);
  const b = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const [x, y, z] = fn(i / 255);
    r[i] = x * 255;
    gg[i] = y * 255;
    b[i] = z * 255;
  }
  return [r, gg, b];
}
const smooth = (x) => x * x * (3 - 2 * x);

// curves + luminance-weighted grain (grain is strongest in the mid-tones, like film)
function develop(g, x, y, w, h, lut, grain, rand) {
  const im = g.getImageData(x, y, w, h);
  const d = im.data;
  const [R, G, B] = lut;
  for (let i = 0; i < d.length; i += 4) {
    let r = R[d[i]];
    let gr = G[d[i + 1]];
    let b = B[d[i + 2]];
    const l = (r * 0.3 + gr * 0.59 + b * 0.11) / 255;
    const n = (rand() + rand() - 1) * grain * (0.35 + 1.3 * l * (1 - l));
    d[i] = r + n;
    d[i + 1] = gr + n;
    d[i + 2] = b + n * 1.1;
  }
  g.putImageData(im, x, y);
}

// soft blur that works in every browser (canvas filters are missing on Safari)
function softBlur(src, w, h, scale) {
  const sw = Math.max(2, Math.round(w / scale));
  const sh = Math.max(2, Math.round(h / scale));
  const a = canvas(sw, sh);
  const ga = a.getContext('2d');
  ga.imageSmoothingQuality = 'high';
  ga.drawImage(src, 0, 0, sw, sh);
  const b = canvas(w, h);
  const gb = b.getContext('2d');
  gb.imageSmoothingQuality = 'high';
  gb.drawImage(a, 0, 0, w, h);
  return b;
}

// red-orange glow bleeding around the brightest parts (film halation)
function halation(photo, w, h) {
  const sw = Math.round(w / 12);
  const sh = Math.round(h / 12);
  const s = canvas(sw, sh);
  const gs = s.getContext('2d');
  gs.drawImage(photo, 0, 0, sw, sh);
  const im = gs.getImageData(0, 0, sw, sh);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255;
    const k = clamp((l - 0.55) / 0.4, 0, 1);
    d[i] = 255 * k;
    d[i + 1] = 90 * k;
    d[i + 2] = 30 * k;
  }
  gs.putImageData(im, 0, 0);
  return softBlur(s, w, h, 1);
}

async function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

// the fire shot developed like a film photo, as its own canvas
function developFire(shot, size, rand) {
  const c = canvas(size, size);
  const g = c.getContext('2d');
  // square crop centred on the fire
  const sw = shot.width;
  const sh = shot.height;
  const side = Math.min(sw, sh * 1.05);
  const sx = Math.max(0, Math.min(sw - side, sw / 2 - side / 2));
  const sy = Math.max(0, Math.min(sh - Math.min(side, sh), sh / 2 - side / 2));
  g.imageSmoothingQuality = 'high';
  g.drawImage(shot, sx, sy, side, Math.min(side, sh), 0, 0, size, size);

  // halation from the flames
  const hal = halation(c, size, size);
  g.globalCompositeOperation = 'screen';
  g.globalAlpha = 0.55;
  g.drawImage(hal, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';

  // a touch of lens softness towards the corners
  const soft = softBlur(c, size, size, 3);
  const mask = canvas(size, size);
  const gm = mask.getContext('2d');
  gm.drawImage(soft, 0, 0);
  gm.globalCompositeOperation = 'destination-in';
  const rg = gm.createRadialGradient(size / 2, size * 0.55, size * 0.35, size / 2, size * 0.55, size * 0.75);
  rg.addColorStop(0, 'rgba(0,0,0,0)');
  rg.addColorStop(1, 'rgba(0,0,0,0.85)');
  gm.fillStyle = rg;
  gm.fillRect(0, 0, size, size);
  g.drawImage(mask, 0, 0);

  // vignette
  const vg = g.createRadialGradient(size / 2, size * 0.55, size * 0.22, size / 2, size * 0.55, size * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(10,4,2,0.6)');
  g.fillStyle = vg;
  g.fillRect(0, 0, size, size);

  // a faint warm light leak on one edge
  const lk = g.createLinearGradient(size, size * 0.15, size * 0.78, size * 0.35);
  lk.addColorStop(0, 'rgba(255,120,40,0.32)');
  lk.addColorStop(1, 'rgba(255,120,40,0)');
  g.globalCompositeOperation = 'screen';
  g.fillStyle = lk;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = 'source-over';

  // film colour: matte blacks, cool shadows, warm highlights, gentle S-curve
  const lut = curves((x) => {
    const s = 0.5 + (smooth(x) - 0.5) * 0.9 + (x - 0.5) * 0.1;
    const lift = 0.055 + s * 0.92;
    const sh = (1 - x) * (1 - x);
    const hi = x * x;
    return [lift + hi * 0.035 - sh * 0.01, lift + hi * 0.01, lift - hi * 0.04 + sh * 0.035];
  });
  develop(g, 0, 0, size, size, lut, 16, rand);
  return c;
}

function dateStamp(g, x, y, date) {
  const t = `${String(date.getDate()).padStart(2, ' ')}  ${String(date.getMonth() + 1).padStart(2, '0')}  '${String(date.getFullYear()).slice(-2)}`;
  g.save();
  g.font = '700 30px "Courier New", ui-monospace, monospace';
  g.textAlign = 'left';
  g.globalCompositeOperation = 'screen';
  g.shadowColor = 'rgba(255,110,20,0.9)';
  g.shadowBlur = 10;
  g.fillStyle = 'rgba(255,150,60,0.85)';
  g.fillText(t, x, y);
  g.shadowBlur = 2;
  g.fillStyle = 'rgba(255,190,120,0.75)';
  g.fillText(t, x, y);
  g.restore();
}

// the card itself: dark, slightly textured stock, warmly lit from above
function drawCard(g, rand) {
  g.fillStyle = '#0e0b09';
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W * 0.5, H * 0.32, 80, W * 0.5, H * 0.4, H * 0.85);
  glow.addColorStop(0, 'rgba(120,70,35,0.32)');
  glow.addColorStop(0.5, 'rgba(60,32,16,0.18)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  g.save();
  g.globalCompositeOperation = 'overlay';
  g.globalAlpha = 0.22;
  g.fillStyle = g.createPattern(paperNoise(256, rand, 260), 'repeat');
  g.fillRect(0, 0, W, H);
  g.restore();
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
}

// a print lying on the card: two shadows (soft and contact), then the paper
function lift(g, w, h, soft = 1) {
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.7)';
  g.shadowBlur = 46 * soft;
  g.shadowOffsetY = 22 * soft;
  g.fillStyle = '#000';
  g.fillRect(-w / 2 + 6, -h / 2 + 10, w - 12, h - 12);
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 5;
  g.shadowOffsetY = 2;
  g.fillRect(-w / 2, -h / 2, w, h);
  g.restore();
}

// light falling across a sheet of paper, plus its texture
function paperShade(g, x, y, w, h, noise, strength = 1) {
  g.save();
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.16 * strength;
  g.fillStyle = g.createPattern(noise, 'repeat');
  g.fillRect(x, y, w, h);
  g.globalAlpha = 1;
  const lg = g.createLinearGradient(x, y, x + w, y + h);
  lg.addColorStop(0, 'rgba(255,255,255,1)');
  lg.addColorStop(1, `rgba(${215 - 20 * strength},${200 - 20 * strength},${185 - 20 * strength},1)`);
  g.fillStyle = lg;
  g.fillRect(x, y, w, h);
  g.restore();
}

function tape(g, cx, cy, w, h, angle, rand, noise) {
  g.save();
  g.translate(cx, cy);
  g.rotate(rad(angle));
  const p = new Path2D();
  const teeth = 7;
  p.moveTo(-w / 2, -h / 2);
  p.lineTo(w / 2, -h / 2);
  for (let i = 1; i <= teeth; i++) p.lineTo(w / 2 + (i % 2 ? -4 - rand() * 3 : rand() * 2), -h / 2 + (h * i) / teeth);
  p.lineTo(-w / 2, h / 2);
  for (let i = teeth - 1; i >= 0; i--) p.lineTo(-w / 2 + (i % 2 ? 4 + rand() * 3 : -rand() * 2), -h / 2 + (h * i) / teeth);
  p.closePath();
  g.shadowColor = 'rgba(0,0,0,0.25)';
  g.shadowBlur = 4;
  g.shadowOffsetY = 1;
  g.fillStyle = 'rgba(232,222,196,0.62)';
  g.fill(p);
  g.shadowColor = 'transparent';
  g.clip(p);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.18;
  g.fillStyle = g.createPattern(noise, 'repeat');
  g.fillRect(-w, -h, w * 2, h * 2);
  g.globalCompositeOperation = 'screen';
  g.globalAlpha = 1;
  const sh = g.createLinearGradient(0, -h / 2, 0, h / 2);
  sh.addColorStop(0, 'rgba(255,255,255,0.22)');
  sh.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.fillStyle = sh;
  g.fillRect(-w, -h, w * 2, h * 2);
  g.restore();
}

// the guest's memory photo as an instant print
async function drawPolaroid(g, src, cx, cy, angle, rand, noise, caption) {
  let img;
  try {
    img = await loadImage(src);
  } catch {
    return;
  }
  // real instant-film proportions: thin sides and top, deep bottom
  const S = 272;
  const side = 17;
  const top = 18;
  const bottom = 74;
  const fw = S + side * 2;
  const fh = S + top + bottom;

  // develop the picture: faded, a little green in the shadows, warm highlights
  const pc = canvas(S, S);
  const gp = pc.getContext('2d');
  const q = Math.min(img.naturalWidth, img.naturalHeight);
  gp.imageSmoothingQuality = 'high';
  gp.drawImage(img, (img.naturalWidth - q) / 2, (img.naturalHeight - q) / 2, q, q, 0, 0, S, S);
  const vg = gp.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(20,10,0,0.42)');
  gp.fillStyle = vg;
  gp.fillRect(0, 0, S, S);
  const lut = curves((x) => {
    const s = 0.5 + (smooth(x) - 0.5) * 0.75 + (x - 0.5) * 0.15;
    const v = 0.1 + s * 0.82;
    const sh = (1 - x) * (1 - x);
    return [v + x * 0.03, v + sh * 0.025, v - x * 0.06 + sh * 0.01];
  });
  develop(gp, 0, 0, S, S, lut, 13, rand);
  // gently desaturate, as instant film does
  gp.globalCompositeOperation = 'saturation';
  gp.fillStyle = 'rgba(128,128,128,0.22)';
  gp.fillRect(0, 0, S, S);
  gp.globalCompositeOperation = 'source-over';

  g.save();
  g.translate(cx, cy);
  g.rotate(rad(angle));
  lift(g, fw, fh, 0.8);
  // the paper frame
  g.fillStyle = '#f1ede3';
  g.fillRect(-fw / 2, -fh / 2, fw, fh);
  paperShade(g, -fw / 2, -fh / 2, fw, fh, noise, 0.8);
  // the picture, set slightly into the frame
  const px = -fw / 2 + side;
  const py = -fh / 2 + top;
  g.drawImage(pc, px, py);
  const edge = (x0, y0, x1, y1, a) => {
    const lg = g.createLinearGradient(x0, y0, x1, y1);
    lg.addColorStop(0, `rgba(0,0,0,${a})`);
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = lg;
  };
  edge(px, py, px, py + 7, 0.35);
  g.fillRect(px, py, S, 7);
  edge(px, py, px + 6, py, 0.25);
  g.fillRect(px, py, 6, S);
  g.strokeStyle = 'rgba(70,55,40,0.35)';
  g.lineWidth = 1;
  g.strokeRect(px + 0.5, py + 0.5, S - 1, S - 1);
  // glossy sheen across the whole print
  const gl = g.createLinearGradient(-fw / 2, -fh / 2, fw / 2, fh / 2);
  gl.addColorStop(0.25, 'rgba(255,255,255,0)');
  gl.addColorStop(0.42, 'rgba(255,255,255,0.13)');
  gl.addColorStop(0.5, 'rgba(255,255,255,0.03)');
  gl.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalCompositeOperation = 'screen';
  g.fillStyle = gl;
  g.fillRect(-fw / 2, -fh / 2, fw, fh);
  g.globalCompositeOperation = 'source-over';
  // handwritten caption in pen
  g.save();
  g.translate(0, fh / 2 - bottom / 2 + 6);
  g.rotate(rad(-2));
  g.fillStyle = 'rgba(30,38,70,0.85)';
  g.font = '500 36px Caveat, "Segoe Print", "Bradley Hand", cursive';
  g.textAlign = 'center';
  g.fillText(caption, 0, 0, fw - 40);
  g.restore();
  g.restore();
  // a strip of tape holding it to the fire print
  const tx = cx + Math.sin(rad(angle)) * (fh / 2 - 4);
  const ty = cy - Math.cos(rad(angle)) * (fh / 2 - 4);
  tape(g, tx, ty, 128, 36, angle - 9, rand, noise);
}

function spaced(g, text, x, y, spacing) {
  const chars = [...text];
  const widths = chars.map((ch) => g.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - spacing;
  let cx = x - total / 2;
  g.textAlign = 'left';
  chars.forEach((ch, i) => {
    g.fillText(ch, cx, y);
    cx += widths[i];
  });
  g.textAlign = 'center';
}

// gold-foil fill for text
function foil(g, y0, y1) {
  const f = g.createLinearGradient(0, y0, 0, y1);
  f.addColorStop(0, '#8d6c3c');
  f.addColorStop(0.45, '#f0d8a0');
  f.addColorStop(0.55, '#d4b273');
  f.addColorStop(1, '#8a6a3a');
  return f;
}

// Pressed into the card: a dark line above and a faint light line below each letter.
function pressed(g, draw) {
  g.save();
  const fill = g.fillStyle;
  g.fillStyle = 'rgba(0,0,0,0.7)';
  g.translate(0, -1);
  draw();
  g.translate(0, 2);
  g.fillStyle = 'rgba(255,230,190,0.07)';
  draw();
  g.translate(0, -1);
  g.fillStyle = fill;
  draw();
  g.restore();
}

/**
 * Draws the keepsake card and returns the canvas.
 * text: { org, name, line, message, footer: [..], caption }
 */
export async function drawKeepsake({ shot, photo, text, seed = 7, date = new Date() }) {
  const rand = rng(seed);
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const noise = paperNoise(128, rand, 40);

  try {
    await Promise.all([
      document.fonts.load('600 64px "Cormorant Garamond"'),
      document.fonts.load('italic 32px "Cormorant Garamond"'),
      document.fonts.load('500 20px Inter'),
      document.fonts.load('500 36px Caveat'),
    ]);
  } catch {}

  drawCard(g, rand);

  // the fire print: a darkroom print with a narrow paper border, lying slightly askew
  const PS = 900; // picture
  const B = 22; // paper border
  const FW = PS + B * 2;
  const pcx = W / 2;
  const pcy = 48 + FW / 2;
  const fire = developFire(shot, PS, rand);
  g.save();
  g.translate(pcx, pcy);
  g.rotate(rad(-1.1));
  lift(g, FW, FW);
  g.fillStyle = '#ece6da';
  g.fillRect(-FW / 2, -FW / 2, FW, FW);
  paperShade(g, -FW / 2, -FW / 2, FW, FW, noise, 1);
  g.drawImage(fire, -PS / 2, -PS / 2);
  // the faint edge where the picture meets the paper
  g.strokeStyle = 'rgba(40,30,20,0.4)';
  g.lineWidth = 1;
  g.strokeRect(-PS / 2 + 0.5, -PS / 2 + 0.5, PS - 1, PS - 1);
  dateStamp(g, -PS / 2 + 36, PS / 2 - 34, date);
  // soft sheen of the print's surface
  const sh = g.createLinearGradient(-FW / 2, -FW / 2, FW / 2, FW / 2);
  sh.addColorStop(0, 'rgba(255,255,255,0.07)');
  sh.addColorStop(0.35, 'rgba(255,255,255,0)');
  sh.addColorStop(1, 'rgba(255,255,255,0)');
  g.globalCompositeOperation = 'screen';
  g.fillStyle = sh;
  g.fillRect(-FW / 2, -FW / 2, FW, FW);
  g.globalCompositeOperation = 'source-over';
  g.restore();

  if (photo) await drawPolaroid(g, photo, 852, 812, 6.5, rand, noise, text.caption || 'a memory');

  // the words, pressed into the card
  const ty = 1078;
  g.textAlign = 'center';
  g.font = '500 20px Inter, system-ui, sans-serif';
  g.fillStyle = foil(g, ty - 18, ty + 2);
  pressed(g, () => spaced(g, text.org.toUpperCase(), W / 2, ty, 4));
  g.font = '600 68px "Cormorant Garamond", Georgia, serif';
  g.fillStyle = THEME.ink;
  pressed(g, () => g.fillText(text.name, W / 2, ty + 74, W - 120));
  g.font = 'italic 32px "Cormorant Garamond", Georgia, serif';
  g.fillStyle = THEME.ink2;
  pressed(g, () => g.fillText(text.line, W / 2, ty + 120, W - 120));
  if (text.message) {
    g.fillStyle = foil(g, ty + 138, ty + 168);
    pressed(g, () => g.fillText(`“${text.message}”`, W / 2, ty + 162, W - 120));
  }
  // footer
  const fy = H - 100;
  const rule = g.createLinearGradient(W / 2 - 150, 0, W / 2 + 150, 0);
  rule.addColorStop(0, 'rgba(201,166,107,0)');
  rule.addColorStop(0.5, 'rgba(201,166,107,0.6)');
  rule.addColorStop(1, 'rgba(201,166,107,0)');
  g.fillStyle = rule;
  g.fillRect(W / 2 - 150, fy, 300, 1);
  g.font = '500 19px Inter, system-ui, sans-serif';
  g.fillStyle = '#a99977';
  text.footer.forEach((line, i) => pressed(g, () => spaced(g, line.toUpperCase(), W / 2, fy + 36 + i * 30, 2.5)));
  return c;
}

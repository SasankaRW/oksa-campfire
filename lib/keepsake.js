'use client';
import { EVENT } from './config';
import { shared } from './bus';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n) =>
  new Promise((r) => {
    const step = () => (n-- <= 0 ? r() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

// Frames the fire in a steady close-up, renders it at full sharpness, and lays it
// out as a portrait card with your name. Returns when the download has started.
// `photo` is an optional data URL of the guest's own memory photo (kept on their device).
export async function makeKeepsake(log, number, photo = null) {
  const src = document.querySelector('main.stage canvas');
  if (!src) return;
  document.body.classList.add('keepsake-shot');
  shared.keepsake = true;
  shared.setSharp?.(true);
  await wait(1300); // let the camera glide in and the flames settle
  await frames(3);
  let shot;
  try {
    shot = await createImageBitmap(src);
  } catch {
    shot = src;
  } finally {
    shared.keepsake = false;
    shared.setSharp?.(false);
    document.body.classList.remove('keepsake-shot');
  }

  const W = 1080;
  const H = 1450; // a little taller than 4:5 to fit the footer lines
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#07060a';
  g.fillRect(0, 0, W, H);

  // square crop centred on the fire
  const sw = shot.width;
  const sh = shot.height;
  const side = Math.min(sw, sh * 1.05);
  const cx = sw / 2;
  const cy = sh * 0.5;
  const sx = Math.max(0, Math.min(sw - side, cx - side / 2));
  const sy = Math.max(0, Math.min(sh - Math.min(side, sh), cy - side / 2));
  const P = 60; // margin
  const PW = W - P * 2;
  const PH = PW; // square photo
  g.save();
  g.drawImage(shot, sx, sy, side, Math.min(side, sh), P, P, PW, PH);
  // warm grade + vignette, like a photo taken by firelight
  g.globalCompositeOperation = 'soft-light';
  g.fillStyle = 'rgba(255,150,70,0.18)';
  g.fillRect(P, P, PW, PH);
  g.globalCompositeOperation = 'source-over';
  const vg = g.createRadialGradient(W / 2, P + PH * 0.55, PW * 0.25, W / 2, P + PH * 0.55, PW * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vg;
  g.fillRect(P, P, PW, PH);
  // fine film grain
  const grain = g.getImageData(P, P, PW, PH);
  const d = grain.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(grain, P, P);
  g.restore();
  // thin gold border around the photo
  g.strokeStyle = 'rgba(201,166,107,0.75)';
  g.lineWidth = 2;
  g.strokeRect(P - 10, P - 10, PW + 20, PH + 20);

  try {
    await document.fonts.load('600 64px "Cormorant Garamond"');
    await document.fonts.load('italic 24px "Cormorant Garamond"');
  } catch {}
  if (photo) await drawPolaroid(g, photo, P + PW - 150, P + PH - 150);
  const ty = P + PH + 70;
  g.textAlign = 'center';
  g.fillStyle = '#c9a66b';
  g.font = '500 20px Inter, system-ui, sans-serif';
  spaced(g, EVENT.org.toUpperCase(), W / 2, ty, 4);
  g.fillStyle = '#f1e9da';
  g.font = '600 66px "Cormorant Garamond", Georgia, serif';
  g.fillText(log.name, W / 2, ty + 72);
  g.fillStyle = '#b8ae9c';
  g.font = 'italic 32px "Cormorant Garamond", Georgia, serif';
  g.fillText(`${EVENT.keepsakeLine}${log.batch ? ` · Batch of ${log.batch}` : ''}`, W / 2, ty + 118);
  if (log.message) {
    g.fillStyle = '#d9b77c';
    g.fillText(`“${log.message}”`, W / 2, ty + 160);
  }
  // footer
  g.strokeStyle = 'rgba(201,166,107,0.35)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(W / 2 - 140, H - 150);
  g.lineTo(W / 2 + 140, H - 150);
  g.stroke();
  g.fillStyle = '#a89878';
  g.font = '500 19px Inter, system-ui, sans-serif';
  EVENT.keepsakeFooter.forEach((line, i) => spaced(g, line.toUpperCase(), W / 2, H - 114 + i * 30, 2.5));
  g.fillStyle = '#6f685d';
  g.font = '400 16px Inter, system-ui, sans-serif';
  g.fillText(`Log #${number} · ${EVENT.title}`, W / 2, H - 22);

  const a = document.createElement('a');
  a.download = `campfire-${log.name.replace(/\s+/g, '-').toLowerCase()}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
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

// The guest's memory photo as a small tilted print tucked into the corner of the fire photo.
async function drawPolaroid(g, src, cx, cy) {
  let img;
  try {
    img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = src;
    });
  } catch {
    return;
  }
  const S = 270; // picture size
  const pad = 14;
  const bottom = 46;
  const fw = S + pad * 2;
  const fh = S + pad + bottom;
  // square centre crop
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  g.save();
  g.translate(cx, cy);
  g.rotate((5 * Math.PI) / 180);
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 30;
  g.shadowOffsetY = 10;
  g.fillStyle = '#f4ecdc';
  g.fillRect(-fw / 2, -fh / 2, fw, fh);
  g.shadowColor = 'transparent';
  g.drawImage(img, sx, sy, side, side, -fw / 2 + pad, -fh / 2 + pad, S, S);
  // a touch of firelight on the print
  g.globalCompositeOperation = 'soft-light';
  g.fillStyle = 'rgba(255,150,70,0.22)';
  g.fillRect(-fw / 2 + pad, -fh / 2 + pad, S, S);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#7a5a34';
  g.font = 'italic 24px "Cormorant Garamond", Georgia, serif';
  g.textAlign = 'center';
  g.fillText('a memory', 0, fh / 2 - 15);
  g.restore();
}

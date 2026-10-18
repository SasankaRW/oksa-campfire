'use client';
import { EVENT } from './config';

// Builds a portrait PNG from the live scene with your name on it.
export async function makeKeepsake(log, number) {
  const src = document.querySelector('main.stage canvas');
  if (!src) return;
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#050608';
  g.fillRect(0, 0, W, H);
  // crop the centre of the scene to portrait
  const sw = src.width;
  const sh = src.height;
  const targetRatio = W / (H * 0.78);
  let cw = sw;
  let ch = sw / targetRatio;
  if (ch > sh) {
    ch = sh;
    cw = sh * targetRatio;
  }
  g.drawImage(src, (sw - cw) / 2, (sh - ch) / 2 - sh * 0.04, cw, ch, 0, 0, W, H * 0.78);
  const grad = g.createLinearGradient(0, H * 0.55, 0, H);
  grad.addColorStop(0, 'rgba(5,6,8,0)');
  grad.addColorStop(0.45, 'rgba(5,6,8,0.92)');
  grad.addColorStop(1, 'rgba(5,6,8,1)');
  g.fillStyle = grad;
  g.fillRect(0, H * 0.55, W, H * 0.45);

  try {
    await document.fonts.load('600 64px "Cormorant Garamond"');
  } catch {}
  g.textAlign = 'center';
  g.fillStyle = '#c9a66b';
  g.font = '500 22px Inter, system-ui, sans-serif';
  spaced(g, EVENT.org.toUpperCase(), W / 2, H * 0.80, 4);
  g.fillStyle = '#f1e9da';
  g.font = '600 68px "Cormorant Garamond", Georgia, serif';
  g.fillText(log.name, W / 2, H * 0.865);
  g.fillStyle = '#b8ae9c';
  g.font = 'italic 34px "Cormorant Garamond", Georgia, serif';
  const sub = `${EVENT.keepsakeLine}${log.batch ? ` · Batch of ${log.batch}` : ''}`;
  g.fillText(sub, W / 2, H * 0.91);
  if (log.message) {
    g.fillStyle = '#d9b77c';
    g.fillText(`“${log.message}”`, W / 2, H * 0.948);
  }
  g.fillStyle = '#6f685d';
  g.font = '400 20px Inter, system-ui, sans-serif';
  g.fillText(`Log #${number} · ${EVENT.title} · ${EVENT.year}`, W / 2, H * 0.982);

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

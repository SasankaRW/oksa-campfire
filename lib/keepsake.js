'use client';
import { EVENT } from './config';
import { shared } from './bus';
import { drawKeepsake } from './keepsakeArt';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n) =>
  new Promise((r) => {
    const step = () => (n-- <= 0 ? r() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

// Frames the fire in a steady close-up, renders it at full sharpness, and lays it
// out as a portrait card with your name (drawn in keepsakeArt.js). Returns when the download has started.
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

  const c = await drawKeepsake({
    shot,
    photo,
    seed: log.name.length * 131 + number,
    text: {
      org: EVENT.keepsakeOrg,
      name: log.name,
      line: `${EVENT.keepsakeLine}${log.batch ? ` · Batch of ${log.batch}` : ''}`,
      message: log.message,
      footer: EVENT.keepsakeFooter,
      caption: log.batch ? `Batch of '${String(log.batch).slice(-2)}` : 'a memory',
    },
  });

  const a = document.createElement('a');
  a.download = `campfire-${log.name.replace(/\s+/g, '-').toLowerCase()}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
}

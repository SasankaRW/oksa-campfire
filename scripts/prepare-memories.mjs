// Turns a folder of photos and videos into small web files for the memories slideshow.
//
//   npm run memories -- "C:\path\to\photos"
//
// Optional: put a captions.csv in that folder with lines like
//   IMG_0012.jpg,Jamboree · 1995
// Items play in file-name order. Output goes to public/memories/.
//
// Videos are cut to a short silent loop (a video is only on screen for ~15-20 s
// as the row slides past). Videos need ffmpeg: either on your PATH, or run
//   npm i --no-save ffmpeg-static
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import crypto from 'node:crypto';

const CLIP_SECONDS = 20;

const src = process.argv[2];
if (!src) {
  console.error('Usage: npm run memories -- <folder with photos>');
  process.exit(1);
}
const out = path.resolve('public/memories');
await fs.mkdir(out, { recursive: true });

// remove old generated files (sample-*.webp, m-*.webp and m-*.mp4)
for (const f of await fs.readdir(out)) {
  if (/^(sample|m)-\d+(-[0-9a-f]+)?\.(webp|mp4)$/.test(f)) await fs.rm(path.join(out, f));
}

const captions = {};
try {
  const csv = await fs.readFile(path.join(src, 'captions.csv'), 'utf8');
  for (const line of csv.split(/\r?\n/)) {
    const i = line.indexOf(',');
    if (i > 0) captions[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {}

const PHOTO = /\.(jpe?g|png|webp|heic|heif|tiff?)$/i;
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;
const files = (await fs.readdir(src))
  .filter((f) => PHOTO.test(f) || VIDEO.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

let ffmpeg = null;
function findFfmpeg() {
  if (ffmpeg) return ffmpeg;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return (ffmpeg = 'ffmpeg');
  } catch {}
  try {
    return (ffmpeg = createRequire(import.meta.url)('ffmpeg-static'));
  } catch {}
  throw new Error('ffmpeg not found (run: npm i --no-save ffmpeg-static)');
}

// short, silent, small H.264 loop that plays on every phone
async function clip(file) {
  const tmp = path.join(out, `.tmp-${process.pid}.mp4`);
  execFileSync(findFfmpeg(), [
    '-y', '-v', 'error', '-i', file, '-t', String(CLIP_SECONDS), '-an',
    '-vf', "scale='min(960,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-profile:v', 'main',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp,
  ]);
  const buf = await fs.readFile(tmp);
  await fs.rm(tmp);
  return buf;
}

const photos = [];
let total = 0;
let videos = 0;
for (let i = 0; i < files.length; i++) {
  try {
    const isVideo = VIDEO.test(files[i]);
    const buf = isVideo
      ? await clip(path.join(src, files[i]))
      : await sharp(path.join(src, files[i]))
          .rotate() // respect phone orientation
          .resize(1280, 960, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 72 })
          .toBuffer();
    // content hash in the name lets browsers and the CDN cache each file forever
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
    const name = `m-${String(i + 1).padStart(4, '0')}-${hash}.${isVideo ? 'mp4' : 'webp'}`;
    await fs.writeFile(path.join(out, name), buf);
    total += buf.length;
    if (isVideo) videos++;
    photos.push({ src: `/memories/${name}`, caption: captions[files[i]] || '', ...(isVideo && { video: true }) });
    process.stdout.write(`\r${i + 1}/${files.length}  ${files[i]}                `);
  } catch (e) {
    console.warn(`\nSkipped ${files[i]}: ${e.message}`);
  }
}
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify({ photos }, null, 1));
console.log(
  `\nDone: ${photos.length - videos} photos and ${videos} videos, ${(total / 1e6).toFixed(1)} MB total.`,
);

// Turns a folder of photos into small web images for the memories slideshow.
//
//   npm run memories -- "C:\path\to\photos"
//
// Optional: put a captions.csv in that folder with lines like
//   IMG_0012.jpg,Jamboree · 1995
// Photos play in file-name order. Output goes to public/memories/.
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import crypto from 'node:crypto';

const src = process.argv[2];
if (!src) {
  console.error('Usage: npm run memories -- <folder with photos>');
  process.exit(1);
}
const out = path.resolve('public/memories');
await fs.mkdir(out, { recursive: true });

// remove old generated images (sample-*.webp and m-*.webp)
for (const f of await fs.readdir(out)) {
  if (/^(sample|m)-\d+(-[0-9a-f]+)?\.webp$/.test(f)) await fs.rm(path.join(out, f));
}

const captions = {};
try {
  const csv = await fs.readFile(path.join(src, 'captions.csv'), 'utf8');
  for (const line of csv.split(/\r?\n/)) {
    const i = line.indexOf(',');
    if (i > 0) captions[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {}

const files = (await fs.readdir(src))
  .filter((f) => /\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

const photos = [];
let total = 0;
for (let i = 0; i < files.length; i++) {
  try {
    const buf = await sharp(path.join(src, files[i]))
      .rotate() // respect phone orientation
      .resize(1280, 960, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 72 })
      .toBuffer();
    // content hash in the name lets browsers and the CDN cache each photo forever
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8);
    const name = `m-${String(i + 1).padStart(4, '0')}-${hash}.webp`;
    await fs.writeFile(path.join(out, name), buf);
    total += buf.length;
    photos.push({ src: `/memories/${name}`, caption: captions[files[i]] || '' });
    process.stdout.write(`\r${i + 1}/${files.length}  ${files[i]}                `);
  } catch (e) {
    console.warn(`\nSkipped ${files[i]}: ${e.message}`);
  }
}
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify({ photos }, null, 1));
console.log(`\nDone: ${photos.length} photos, ${(total / 1e6).toFixed(1)} MB total (${Math.round(total / Math.max(1, photos.length) / 1000)} KB each).`);

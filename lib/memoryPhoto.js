'use client';
// The guest's own memory photo. It lives only in this browser (localStorage) and is
// never sent to the server; it is only used when drawing the keepsake card.
const KEY = 'campfire.photo';
const MAX_SIDE = 720;

export function loadPhoto() {
  try {
    const p = localStorage.getItem(KEY);
    return p && p.startsWith('data:image/') ? p : null;
  } catch {
    return null;
  }
}

export function clearPhoto() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

// Shrinks the picked image to a small JPEG and stores it. Returns the data URL.
export async function savePhoto(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Pick a photo.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That photo could not be opened.'));
      i.src = url;
    });
    const s = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s);
    c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', 0.85);
    try {
      localStorage.setItem(KEY, data);
    } catch {
      throw new Error('Not enough space on this device to keep the photo.');
    }
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

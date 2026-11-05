// Counts attempts per visitor (by IP address) so one person can't hammer a route.
// Uses the rate_hit function from supabase/migrations/2026-11-05-hardening.sql when it
// exists. Before that migration is run (or if the database call fails) it falls back to
// counting in this server's memory: best effort, since Vercel may run several copies.
// (The "_lib" folder name keeps Next.js from treating this file as a web address.)

const mem = new Map(); // key -> [timestamps in ms]

// The visitor's IP. Vercel puts the real one first in x-forwarded-for.
export function clientIp(req) {
  const xff = req.headers.get('x-forwarded-for') || '';
  return (xff.split(',')[0] || '').trim() || req.headers.get('x-real-ip') || 'unknown';
}

function memHits(key, windowMs, add) {
  const now = Date.now();
  const list = (mem.get(key) || []).filter((t) => now - t < windowMs);
  if (add) list.push(now);
  if (list.length) mem.set(key, list);
  else mem.delete(key);
  // don't let the map grow forever
  if (mem.size > 5000) {
    for (const k of mem.keys()) {
      mem.delete(k);
      if (mem.size < 4000) break;
    }
  }
  return list.length;
}

// How many hits `key` has had in the last `windowSec` seconds (counting this one if `add`).
// Never throws.
export async function hits(db, key, windowSec, add) {
  if (db) {
    try {
      const { data, error } = await db.rpc('rate_hit', { p_key: key, p_window: windowSec, p_add: add });
      if (!error && typeof data === 'number') return data;
    } catch {}
  }
  return memHits(key, windowSec * 1000, add);
}

// True when Supabase says a function or table doesn't exist yet (migration not run).
export function isMissing(error) {
  if (!error) return false;
  return ['PGRST202', 'PGRST205', '42883', '42P01'].includes(error.code) || /could not find the function|does not exist/i.test(error.message || '');
}

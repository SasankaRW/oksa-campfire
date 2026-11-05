// What changed since a moment in time, shared through Vercel's cache.
// Guests ask with a time rounded down to 5 seconds (?s=<ms>), so everyone asking at about
// the same moment asks the same question, and the database answers it about once every
// 4 seconds instead of once per person. The page drops anything it already has.
import { adminClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const BUCKET = 5000;
// errors must never be cached, or everyone would keep getting the error
const NO_STORE = { 'cache-control': 'no-store', 'cdn-cache-control': 'no-store' };

export async function GET(req) {
  const s = Number(new URL(req.url).searchParams.get('s'));
  if (!Number.isFinite(s) || s < 0 || s > Date.now() + 60000) {
    return Response.json({ error: 'Bad request' }, { status: 400, headers: NO_STORE });
  }
  const db = adminClient();
  if (!db) return Response.json({ error: 'Server is not configured.' }, { status: 500, headers: NO_STORE });
  const since = new Date(Math.floor(s / BUCKET) * BUCKET).toISOString();
  const { data, error } = await db.rpc('campfire_since', { p_since: since });
  if (error || !data) return Response.json({ error: 'Could not load the fire.' }, { status: 502, headers: NO_STORE });
  return Response.json(data, {
    headers: {
      'cache-control': 'public, max-age=0, s-maxage=4, stale-while-revalidate=10',
      'cdn-cache-control': 'public, s-maxage=4, stale-while-revalidate=10',
    },
  });
}

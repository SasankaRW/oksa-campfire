// The full state of the fire, cached for 2 seconds at Vercel's edge.
// When hundreds of people open the page at once, the database answers about
// once every 2 seconds instead of once per person.
import { adminClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

// errors must never be cached, or everyone would keep getting the error
const NO_STORE = { 'cache-control': 'no-store', 'cdn-cache-control': 'no-store' };

export async function GET() {
  const db = adminClient();
  if (!db) return Response.json({ error: 'Server is not configured.' }, { status: 500, headers: NO_STORE });
  const { data, error } = await db.rpc('campfire_since', { p_since: '1970-01-01T00:00:00Z' });
  if (error || !data) return Response.json({ error: 'Could not load the fire.' }, { status: 502, headers: NO_STORE });
  return Response.json(data, {
    headers: {
      'cache-control': 'public, max-age=0, s-maxage=2, stale-while-revalidate=30',
      'cdn-cache-control': 'public, s-maxage=2, stale-while-revalidate=30',
    },
  });
}

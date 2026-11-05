// A leader's personal link: look up who they are, and lay their honour log when called.
import { adminClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const pub = (l) => ({ slot: l.slot, name: l.name, title: l.title, called_at: l.called_at, laid_at: l.laid_at });
const busy = () => Response.json({ error: 'Could not reach the fire. Try again.' }, { status: 503 });

// Returns the leader, null if the link is not valid, or throws if the database failed.
async function find(db, token) {
  if (!token || typeof token !== 'string' || token.length < 10 || token.length > 100) return null;
  const { data, error } = await db.from('leaders').select('*').eq('token', token).maybeSingle();
  if (error) throw error;
  return data && data.name ? data : null;
}

export async function GET(req) {
  const db = adminClient();
  if (!db) return Response.json({ error: 'Server is not configured.' }, { status: 500 });
  try {
    const leader = await find(db, new URL(req.url).searchParams.get('t'));
    if (!leader) return Response.json({ error: 'This leader link is not valid.' }, { status: 404 });
    return Response.json({ leader: pub(leader) });
  } catch {
    return busy();
  }
}

export async function POST(req) {
  const db = adminClient();
  if (!db) return Response.json({ error: 'Server is not configured.' }, { status: 500 });
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({ error: 'Bad request' }, { status: 400 });
  try {
    const leader = await find(db, body.t);
    if (!leader) return Response.json({ error: 'This leader link is not valid.' }, { status: 404 });
    if (!leader.called_at) return Response.json({ error: 'Please wait until the fire keeper calls you.' }, { status: 409 });
    if (leader.laid_at) return Response.json({ leader: pub(leader) });
    const now = new Date().toISOString();
    // only if not laid yet, so a double tap (or a retry) lays it once
    const { data, error } = await db
      .from('leaders')
      .update({ laid_at: now, updated_at: now })
      .eq('slot', leader.slot)
      .is('laid_at', null)
      .select()
      .maybeSingle();
    if (error) return busy();
    if (!data) return Response.json({ leader: pub((await find(db, body.t)) || leader) });
    // any new value tells every screen "leaders changed, refresh". If this fails the log is
    // still laid, and screens pick it up on their next regular check, so don't report an error.
    await db.from('fire_state').update({ leaders_rev: Date.now() % 2000000000, updated_at: now }).eq('id', 1);
    return Response.json({ leader: pub(data) });
  } catch {
    return busy();
  }
}

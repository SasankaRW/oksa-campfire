// A leader's personal link: look up who they are, and lay their honour log when called.
import { adminClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const pub = (l) => ({ slot: l.slot, name: l.name, title: l.title, called_at: l.called_at, laid_at: l.laid_at });

async function find(db, token) {
  if (!token || typeof token !== 'string' || token.length < 10) return null;
  const { data } = await db.from('leaders').select('*').eq('token', token).maybeSingle();
  return data && data.name ? data : null;
}

export async function GET(req) {
  const db = adminClient();
  if (!db) return Response.json({ error: 'Server is not configured.' }, { status: 500 });
  const leader = await find(db, new URL(req.url).searchParams.get('t'));
  if (!leader) return Response.json({ error: 'This leader link is not valid.' }, { status: 404 });
  return Response.json({ leader: pub(leader) });
}

export async function POST(req) {
  const db = adminClient();
  if (!db) return Response.json({ error: 'Server is not configured.' }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const leader = await find(db, body.t);
  if (!leader) return Response.json({ error: 'This leader link is not valid.' }, { status: 404 });
  if (!leader.called_at) return Response.json({ error: 'Please wait until the fire keeper calls you.' }, { status: 409 });
  if (leader.laid_at) return Response.json({ leader: pub(leader) });
  const now = new Date().toISOString();
  const { data } = await db.from('leaders').update({ laid_at: now, updated_at: now }).eq('slot', leader.slot).select().single();
  const { data: f } = await db.from('fire_state').select('leaders_rev').eq('id', 1).single();
  await db.from('fire_state').update({ leaders_rev: (f?.leaders_rev || 0) + 1, updated_at: now }).eq('id', 1);
  return Response.json({ leader: pub(data) });
}

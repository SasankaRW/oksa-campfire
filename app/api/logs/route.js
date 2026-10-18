import { adminClient } from '@/lib/supabaseAdmin';
import { clean, isClean } from '@/lib/profanity';
import { MAX_NAME, MAX_BATCH, MAX_MESSAGE } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const db = adminClient();
  if (!db) return Response.json({ error: 'Server is not configured.' }, { status: 500 });
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  const deviceId = clean(body.deviceId, 64);
  const name = clean(body.name, MAX_NAME);
  const batch = clean(body.batch, MAX_BATCH).replace(/[^0-9]/g, '');
  const message = clean(body.message, MAX_MESSAGE);
  if (!deviceId || deviceId.length < 8) return Response.json({ error: 'Bad request' }, { status: 400 });
  if (!name) return Response.json({ error: 'Enter your name.' }, { status: 400 });
  if (!isClean(name) || !isClean(message))
    return Response.json({ error: 'Keep it clean, scout.' }, { status: 400 });

  const { data: existing } = await db.from('logs').select('*').eq('device_id', deviceId).maybeSingle();
  if (existing) return Response.json({ log: existing });

  const { count } = await db.from('logs').select('id', { count: 'exact', head: true });
  if ((count || 0) >= 320) return Response.json({ error: 'The fire is full tonight.' }, { status: 429 });

  const { data, error } = await db
    .from('logs')
    .insert({ device_id: deviceId, name, batch, message })
    .select()
    .single();
  if (error) {
    const { data: again } = await db.from('logs').select('*').eq('device_id', deviceId).maybeSingle();
    if (again) return Response.json({ log: again });
    return Response.json({ error: 'Could not lay your log. Try again.' }, { status: 500 });
  }
  return Response.json({ log: data });
}

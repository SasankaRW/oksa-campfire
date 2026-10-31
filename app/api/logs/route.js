import { adminClient } from '@/lib/supabaseAdmin';
import { clean, isClean } from '@/lib/profanity';
import { MAX_NAME, MAX_BATCH, MAX_MESSAGE } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const MAX_LOGS = 520;

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
  if (!isClean(name) || !isClean(message)) return Response.json({ error: 'Keep it clean, scout.' }, { status: 400 });

  // one round trip for both checks
  const [{ data: existing }, { count }, { data: fire }] = await Promise.all([
    db.from('logs').select('*').eq('device_id', deviceId).maybeSingle(),
    db.from('logs').select('id', { count: 'exact', head: true }),
    db.from('fire_state').select('*').eq('id', 1).maybeSingle(),
  ]);
  if (existing) return Response.json({ log: existing });
  // the fire keeper has not opened log placing yet (allowed if the column is missing, so an old database still works)
  if (fire && fire.logs_open === false) return Response.json({ error: 'Log placing is closed right now.' }, { status: 403 });
  if ((count || 0) >= MAX_LOGS) return Response.json({ error: 'The fire is full tonight.' }, { status: 429 });

  const { data, error } = await db.from('logs').insert({ device_id: deviceId, name, batch, message }).select().single();
  if (error) {
    // e.g. a double tap raced us: return the log that won
    const { data: again } = await db.from('logs').select('*').eq('device_id', deviceId).maybeSingle();
    if (again) return Response.json({ log: again });
    return Response.json({ error: 'Could not lay your log. Try again.' }, { status: 503 });
  }
  return Response.json({ log: data });
}

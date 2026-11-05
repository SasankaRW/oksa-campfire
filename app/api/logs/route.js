import { adminClient } from '@/lib/supabaseAdmin';
import { clean, isClean } from '@/lib/profanity';
import { MAX_NAME, MAX_BATCH, MAX_MESSAGE } from '@/lib/config';
import { hits, clientIp, isMissing } from '../_lib/limit';

export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const MAX_LOGS = 520; // real, visible logs (test logs and hidden ones don't count)
// New logs allowed from one network (IP) per 10 minutes. Generous on purpose: phone
// networks often put many guests behind one shared IP address.
const IP_LIMIT = 25;
const IP_WINDOW = 600;

const str = (v) => (typeof v === 'string' ? v : '');
const busy = () => Response.json({ error: 'Could not lay your log. Try again.' }, { status: 503 });

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
  const deviceId = clean(str(body.deviceId), 64);
  const name = clean(str(body.name), MAX_NAME);
  const batch = clean(body.batch == null ? '' : String(body.batch), MAX_BATCH).replace(/[^0-9]/g, '');
  const message = clean(str(body.message), MAX_MESSAGE);
  if (!deviceId || deviceId.length < 8) return Response.json({ error: 'Bad request' }, { status: 400 });
  if (!name) return Response.json({ error: 'Enter your name.' }, { status: 400 });
  if (!isClean(name) || !isClean(message)) return Response.json({ error: 'Keep it clean, scout.' }, { status: 400 });

  // Already laid one? Send it back (so retries and double taps are always safe).
  const [ex, fr] = await Promise.all([
    db.from('logs').select('*').eq('device_id', deviceId).maybeSingle(),
    db.from('fire_state').select('*').eq('id', 1).maybeSingle(),
  ]);
  if (ex.error || fr.error) return busy();
  if (ex.data) return Response.json({ log: ex.data });
  // the fire keeper has not opened log placing yet (allowed if the column is missing, so an old database still works)
  if (fr.data && fr.data.logs_open === false) return Response.json({ error: 'Log placing is closed right now.' }, { status: 403 });

  // one network can only add so many new logs (stops one person filling the fire)
  if ((await hits(db, 'log:' + clientIp(req), IP_WINDOW, true)) > IP_LIMIT) {
    return Response.json({ error: 'Too many logs from this network. Try again in a few minutes.' }, { status: 429 });
  }

  // Preferred: one database call that checks the limit and adds the log together,
  // so a rush of people can't slip past the limit at the same moment.
  const { data: res, error: rpcError } = await db.rpc('lay_log', {
    p_device: deviceId,
    p_name: name,
    p_batch: batch,
    p_message: message,
    p_max: MAX_LOGS,
  });
  if (!rpcError && res) {
    if ((res.status === 'ok' || res.status === 'existing') && res.log) return Response.json({ log: res.log });
    if (res.status === 'closed') return Response.json({ error: 'Log placing is closed right now.' }, { status: 403 });
    if (res.status === 'full') return Response.json({ error: 'The fire is full tonight.' }, { status: 429 });
    return busy();
  }
  if (!isMissing(rpcError)) return busy();

  // Older database (the 2026-11-05 migration has not been run): count, then add.
  const { count, error: countError } = await db
    .from('logs')
    .select('id', { count: 'exact', head: true })
    .eq('hidden', false)
    .not('device_id', 'like', 'test-%');
  if (countError) return busy();
  if ((count || 0) >= MAX_LOGS) return Response.json({ error: 'The fire is full tonight.' }, { status: 429 });

  const { data, error } = await db.from('logs').insert({ device_id: deviceId, name, batch, message }).select().single();
  if (error) {
    // e.g. a double tap raced us: return the log that won
    const { data: again } = await db.from('logs').select('*').eq('device_id', deviceId).maybeSingle();
    if (again) return Response.json({ log: again });
    return busy();
  }
  return Response.json({ log: data });
}

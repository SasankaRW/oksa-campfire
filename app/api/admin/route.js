import { timingSafeEqual } from 'crypto';
import { adminClient } from '@/lib/supabaseAdmin';
import { DEMO_NAMES } from '@/lib/demoNames';

export const dynamic = 'force-dynamic';

function ok(pass) {
  const real = process.env.ADMIN_PASSCODE || '';
  if (!real || typeof pass !== 'string') return false;
  const a = Buffer.from(pass);
  const b = Buffer.from(real);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req) {
  const db = adminClient();
  if (!db) return Response.json({ error: 'Server is not configured.' }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  if (!ok(body.passcode)) return Response.json({ error: 'Wrong passcode.' }, { status: 401 });

  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const { data: cur } = await db.from('fire_state').select('*').eq('id', 1).single();
  let patch = null;

  switch (body.action) {
    case 'login':
      return Response.json({ ok: true, fire: cur });
    case 'ignite': {
      const delay = Math.max(0, Math.min(60, Number(body.delay ?? 10)));
      patch = { ignite_at: iso(now + delay * 1000), mode: 'normal' };
      break;
    }
    case 'extinguish':
      patch = { ignite_at: null, mode: 'normal' };
      break;
    case 'stoke':
      patch = { stoke_at: iso(now) };
      break;
    case 'embers':
      patch = { mode: cur?.mode === 'embers' ? 'normal' : 'embers' };
      break;
    case 'hide':
      await db.from('logs').update({ hidden: true }).eq('id', body.id);
      return Response.json({ ok: true });
    case 'reset':
      await db.from('logs').delete().neq('device_id', '');
      patch = { ignite_at: null, stoke_at: null, mode: 'normal', reset_at: iso(now) };
      break;
    case 'seed': {
      const n = Math.max(1, Math.min(200, Number(body.count || 20)));
      const spread = Number(body.spread ?? 350);
      const rows = Array.from({ length: n }, (_, i) => ({
        device_id: 'test-' + crypto.randomUUID(),
        name: DEMO_NAMES[i % DEMO_NAMES.length],
        batch: String(1985 + Math.floor(Math.random() * 38)),
        message: '',
        created_at: iso(now + i * spread),
      }));
      await db.from('logs').insert(rows);
      return Response.json({ ok: true });
    }
    default:
      return Response.json({ error: 'Unknown action' }, { status: 400 });
  }
  const { data } = await db
    .from('fire_state')
    .update({ ...patch, updated_at: iso(now) })
    .eq('id', 1)
    .select()
    .single();
  return Response.json({ ok: true, fire: data });
}

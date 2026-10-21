import { timingSafeEqual } from 'crypto';
import { adminClient } from '@/lib/supabaseAdmin';
import { DEMO_NAMES } from '@/lib/demoNames';
import { randomBytes } from 'crypto';
import { clean } from '@/lib/profanity';

export const dynamic = 'force-dynamic';
// Run next to the Supabase database (Singapore) so each query is a few ms, not a trip across the Pacific.
export const preferredRegion = 'sin1';

function ok(pass) {
  const real = process.env.ADMIN_PASSCODE || '';
  if (!real || typeof pass !== 'string') return false;
  const a = Buffer.from(pass);
  const b = Buffer.from(real);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (!ok(body.passcode)) return Response.json({ error: 'Wrong passcode.' }, { status: 401 });
  // keeps the function warm while the admin page is open (no database work)
  if (body.action === 'ping') return Response.json({ ok: true });
  const db = adminClient();
  if (!db) return Response.json({ error: 'Server is not configured.' }, { status: 500 });

  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  let patch = null;

  // any new value tells every screen "leaders changed, refresh" (no read needed first)
  const rev = now % 2000000000;
  const bump = () => db.from('fire_state').update({ leaders_rev: rev, updated_at: iso(now) }).eq('id', 1);
  const listLeaders = async () => (await db.from('leaders').select('*').order('slot')).data || [];

  switch (body.action) {
    case 'login': {
      const [{ data: cur }, leaders] = await Promise.all([
        db.from('fire_state').select('*').eq('id', 1).single(),
        listLeaders(),
      ]);
      return Response.json({ ok: true, fire: cur, leaders });
    }
    case 'leaders_save': {
      const existing = await listLeaders();
      const rows = (body.leaders || []).slice(0, 5).map((l, slot) => ({
        slot,
        name: clean(l.name, 40),
        title: clean(l.title, 60),
        token: existing.find((e) => e.slot === slot)?.token || randomBytes(12).toString('hex'),
        updated_at: iso(now),
      }));
      await Promise.all([db.from('leaders').upsert(rows, { onConflict: 'slot' }), bump()]);
      return Response.json({ ok: true, leaders: await listLeaders() });
    }
    case 'leader_call':
    case 'leader_lay':
    case 'leader_reset': {
      const slot = Number(body.slot);
      const patch =
        body.action === 'leader_call'
          ? { called_at: iso(now) }
          : body.action === 'leader_lay'
            ? { called_at: iso(now), laid_at: iso(now) }
            : { called_at: null, laid_at: null };
      await Promise.all([db.from('leaders').update({ ...patch, updated_at: iso(now) }).eq('slot', slot), bump()]);
      return Response.json({ ok: true, leaders: await listLeaders() });
    }
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
    case 'memories_start':
      patch = { memories_at: iso(now + 1500) };
      break;
    case 'memories_stop':
      patch = { memories_at: null };
      break;
    case 'cheer':
      patch = { cheer_at: iso(now + 1200), cheer_text: clean(body.text || '', 80) };
      break;
    case 'song_start':
      patch = { song_at: iso(now), song_title: clean(body.title || '', 80) };
      break;
    case 'song_stop':
      patch = { song_at: null };
      break;
    case 'embers':
      patch = { mode: body.mode === 'embers' ? 'embers' : 'normal' };
      break;
    case 'hide':
      await db.from('logs').update({ hidden: true }).eq('id', body.id);
      return Response.json({ ok: true });
    case 'reset':
      await Promise.all([
        db.from('logs').delete().neq('device_id', ''),
        db.from('leaders').update({ called_at: null, laid_at: null }).gte('slot', 0),
      ]);
      patch = { ignite_at: null, stoke_at: null, memories_at: null, cheer_at: null, song_at: null, mode: 'normal', reset_at: iso(now), leaders_rev: rev };
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

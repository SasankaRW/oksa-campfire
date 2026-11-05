import { timingSafeEqual, randomBytes } from 'crypto';
import { adminClient } from '@/lib/supabaseAdmin';
import { DEMO_NAMES } from '@/lib/demoNames';
import { clean } from '@/lib/profanity';
import { COUNTDOWN_SECONDS, MAX_COUNTDOWN_SECONDS } from '@/lib/config';
import { resumeStart } from '@/lib/memories';
import { hits, clientIp } from '../_lib/limit';

export const dynamic = 'force-dynamic';
// Run next to the Supabase database (Singapore) so each query is a few ms, not a trip across the Pacific.
export const preferredRegion = 'sin1';

// Wrong passcodes allowed from one IP in 10 minutes before we stop listening for a while.
const MAX_FAILS = 5;
const FAIL_WINDOW = 600;
// The panel retries when the network is slow. If the same big moment (light the fire,
// start the photos, ...) was already started this recently, the retry changes nothing.
const REPEAT_MS = 20000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ok(pass) {
  const real = process.env.ADMIN_PASSCODE || '';
  if (!real || typeof pass !== 'string') return false;
  const a = Buffer.from(pass);
  const b = Buffer.from(real);
  return a.length === b.length && timingSafeEqual(a, b);
}

const isLink = (s) => {
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
};

const fail = (error, status) => Response.json({ error }, { status });
const ms = (v) => (v ? Date.parse(v) : 0);

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return fail('Bad request', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Bad request', 400);
  const db = adminClient();

  // too many wrong passcodes from this address: someone may be guessing
  const ipKey = 'admin:' + clientIp(req);
  if ((await hits(db, ipKey, FAIL_WINDOW, false)) >= MAX_FAILS) {
    return fail('Too many wrong passcodes. Wait 10 minutes and try again.', 429);
  }
  if (!ok(body.passcode)) {
    await hits(db, ipKey, FAIL_WINDOW, true);
    return fail('Wrong passcode.', 401);
  }
  // keeps the function warm while the admin page is open
  if (body.action === 'ping') return Response.json({ ok: true });
  if (!db) return fail('Server is not configured.', 500);

  try {
    return await run(db, body);
  } catch (error) {
    const hint = /memories_paused_at|quiz_|logs_open/.test(error?.message || '') ? ' Run supabase/schema.sql again in Supabase.' : '';
    return fail('Could not update the fire. Try again.' + hint, 500);
  }
}

// Every database call below throws on error, so the panel never sees "ok" for a change that didn't happen.
async function run(db, body) {
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();
  const must = ({ data, error }) => {
    if (error) throw error;
    return data;
  };

  // any new value tells every screen "leaders changed, refresh" (no read needed first).
  // Not fatal: the change is already saved and screens also catch it on their regular check.
  const rev = now % 2000000000;
  const bump = async () => {
    await db.from('fire_state').update({ leaders_rev: rev, updated_at: iso(now) }).eq('id', 1);
  };
  const listLeaders = async () => must(await db.from('leaders').select('*').order('slot')) || [];
  const getFire = async () => must(await db.from('fire_state').select('*').eq('id', 1).single());
  const fireReply = (fire, repeat) => Response.json({ ok: true, fire, ...(repeat ? { repeat: true } : {}) });

  // Write a change to the fire. `guard` only lets it through if the row still looks the
  // way we just read it, so a retry that lands while the first try is still running
  // can't start the moment a second time. If nothing changed, send back how it is now.
  const writeFire = async (patch, guard) => {
    let q = db.from('fire_state').update({ ...patch, updated_at: iso(now) }).eq('id', 1);
    if (guard) q = guard(q);
    const data = must(await q.select().maybeSingle());
    return data || (await getFire());
  };
  // "column is still `value`" (null-safe)
  const same = (col, value) => (q) => (value == null ? q.is(col, null) : q.eq(col, value));
  const recent = (t) => t && Math.abs(now - t) < REPEAT_MS;

  const slotOf = () => {
    const slot = Number(body.slot);
    return Number.isInteger(slot) && slot >= 0 && slot <= 4 ? slot : null;
  };

  switch (body.action) {
    case 'login': {
      const [fire, leaders] = await Promise.all([getFire(), listLeaders()]);
      return Response.json({ ok: true, fire, leaders });
    }
    case 'leaders_save': {
      if (!Array.isArray(body.leaders)) return fail('Bad request', 400);
      const existing = await listLeaders();
      const rows = body.leaders.slice(0, 5).map((l, slot) => {
        const v = l && typeof l === 'object' ? l : {};
        return {
          slot,
          name: clean(typeof v.name === 'string' ? v.name : '', 40),
          title: clean(typeof v.title === 'string' ? v.title : '', 60),
          token: existing.find((e) => e.slot === slot)?.token || randomBytes(12).toString('hex'),
          updated_at: iso(now),
        };
      });
      must(await db.from('leaders').upsert(rows, { onConflict: 'slot' }));
      await bump();
      return Response.json({ ok: true, leaders: await listLeaders() });
    }
    case 'leader_call':
    case 'leader_lay':
    case 'leader_reset': {
      const slot = slotOf();
      if (slot === null) return fail('Bad request', 400);
      const cur = must(await db.from('leaders').select('*').eq('slot', slot).maybeSingle());
      if (!cur) return Response.json({ ok: true, leaders: await listLeaders() });
      let q;
      if (body.action === 'leader_call') {
        // called moments ago (a retry): leave it alone
        if (recent(ms(cur.called_at))) return Response.json({ ok: true, repeat: true, leaders: await listLeaders() });
        q = same('called_at', cur.called_at)(db.from('leaders').update({ called_at: iso(now), updated_at: iso(now) }).eq('slot', slot));
      } else if (body.action === 'leader_lay') {
        // a log is only laid once (until the fire keeper resets that leader)
        if (cur.laid_at) return Response.json({ ok: true, repeat: true, leaders: await listLeaders() });
        q = db.from('leaders').update({ called_at: iso(now), laid_at: iso(now), updated_at: iso(now) }).eq('slot', slot).is('laid_at', null);
      } else {
        q = db.from('leaders').update({ called_at: null, laid_at: null, updated_at: iso(now) }).eq('slot', slot);
      }
      const changed = must(await q.select());
      if (changed?.length) await bump();
      return Response.json({ ok: true, leaders: await listLeaders() });
    }
    case 'ignite': {
      const n = Number(body.delay ?? COUNTDOWN_SECONDS);
      const delay = Number.isFinite(n) ? Math.max(0, Math.min(MAX_COUNTDOWN_SECONDS, n)) : COUNTDOWN_SECONDS;
      const cur = await getFire();
      // the same countdown was started moments ago (a retry): don't restart it
      if (cur.ignite_at && recent(ms(cur.ignite_at) - delay * 1000)) return fireReply(cur, true);
      return fireReply(await writeFire({ ignite_at: iso(now + delay * 1000), mode: 'normal' }, same('ignite_at', cur.ignite_at)));
    }
    case 'extinguish':
      return fireReply(await writeFire({ ignite_at: null, mode: 'normal' }));
    case 'stoke':
      return fireReply(await writeFire({ stoke_at: iso(now) }));
    case 'memories_start': {
      const cur = await getFire();
      if (cur.memories_at && !cur.memories_paused_at && recent(ms(cur.memories_at) - 1500)) return fireReply(cur, true);
      return fireReply(await writeFire({ memories_at: iso(now + 1500), memories_paused_at: null }, same('memories_at', cur.memories_at)));
    }
    case 'memories_stop':
      return fireReply(await writeFire({ memories_at: null, memories_paused_at: null }));
    case 'memories_pause':
    case 'memories_resume': {
      const cur = await getFire();
      if (!cur?.memories_at) return fail('Photos are not playing.', 400);
      const paused = cur.memories_paused_at ? Date.parse(cur.memories_paused_at) : null;
      if (body.action === 'memories_pause') {
        if (paused) return fireReply(cur); // already paused: keep the first pause time
        return fireReply(await writeFire({ memories_paused_at: iso(now) }, same('memories_paused_at', null)));
      }
      if (!paused) return fireReply(cur);
      // carry on from the photo everyone was focused on
      return fireReply(
        await writeFire(
          { memories_at: iso(resumeStart(Date.parse(cur.memories_at), paused, now)), memories_paused_at: null },
          same('memories_paused_at', cur.memories_paused_at),
        ),
      );
    }
    case 'cheer':
      return fireReply(await writeFire({ cheer_at: iso(now + 1200), cheer_text: clean(typeof body.text === 'string' ? body.text : '', 80) }));
    case 'song_start': {
      const title = clean(typeof body.title === 'string' ? body.title : '', 80);
      const cur = await getFire();
      // the same song was started moments ago (a retry): don't start it again
      if (cur.song_at && cur.song_title === title && recent(ms(cur.song_at))) return fireReply(cur, true);
      return fireReply(await writeFire({ song_at: iso(now), song_title: title }, same('song_at', cur.song_at)));
    }
    case 'song_stop':
      return fireReply(await writeFire({ song_at: null }));
    case 'quiz': {
      // save the Kahoot link and show or hide the quiz button for everyone
      const url = typeof body.url === 'string' ? body.url.trim().slice(0, 500) : null;
      if (url !== null && url && !isLink(url)) return fail('Paste a full link that starts with https://', 400);
      const patch = { quiz_on: !!body.on };
      if (url !== null) patch.quiz_url = url;
      if (body.on) {
        const link = url ?? (await getFire()).quiz_url;
        if (!link) return fail('Add the quiz link first.', 400);
      }
      return fireReply(await writeFire(patch));
    }
    case 'logs_open':
      // show or hide the "Place my log" button on every guest's screen
      return fireReply(await writeFire({ logs_open: !!body.on }));
    case 'embers':
      return fireReply(await writeFire({ mode: body.mode === 'embers' ? 'embers' : 'normal' }));
    case 'hide': {
      if (typeof body.id !== 'string' || !UUID.test(body.id)) return fail('Bad request', 400);
      must(await db.from('logs').update({ hidden: true }).eq('id', body.id));
      // Logs aren't sent live any more, so nudge every screen to check now (same signal as
      // a leader change) and the hidden log disappears within seconds, not at the next slow poll.
      await bump();
      return Response.json({ ok: true });
    }
    case 'reset': {
      const cur = await getFire();
      // reset moments ago (a retry): everything is already cleared
      if (recent(ms(cur.reset_at))) return Response.json({ ok: true, repeat: true, fire: cur, leaders: await listLeaders() });
      const [logsDel, leadersClear] = await Promise.all([
        db.from('logs').delete().neq('device_id', ''),
        db.from('leaders').update({ called_at: null, laid_at: null }).gte('slot', 0),
      ]);
      must(logsDel);
      must(leadersClear);
      return fireReply(
        await writeFire({
          ignite_at: null,
          stoke_at: null,
          memories_at: null,
          memories_paused_at: null,
          cheer_at: null,
          song_at: null,
          quiz_on: false,
          logs_open: false,
          mode: 'normal',
          reset_at: iso(now),
          leaders_rev: rev,
        }),
      );
    }
    case 'seed': {
      const n = Math.max(1, Math.min(200, Number(body.count || 20) || 20));
      const s = Number(body.spread ?? 350);
      const spread = Number.isFinite(s) ? Math.max(0, Math.min(5000, s)) : 350;
      const rows = Array.from({ length: n }, (_, i) => ({
        device_id: 'test-' + crypto.randomUUID(),
        name: DEMO_NAMES[i % DEMO_NAMES.length],
        batch: String(1985 + Math.floor(Math.random() * 38)),
        message: '',
        created_at: iso(now + i * spread),
      }));
      must(await db.from('logs').insert(rows));
      return Response.json({ ok: true });
    }
    default:
      return fail('Unknown action', 400);
  }
}

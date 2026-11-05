-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to run again (it only adds what is missing).

-- ---------- logs: one per person ----------
create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  name text not null check (char_length(name) between 1 and 32),
  batch text default '' check (char_length(batch) <= 4),
  message text default '' check (char_length(message) <= 48),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.logs add column if not exists updated_at timestamptz not null default now();
create index if not exists logs_created_idx on public.logs (created_at);
create index if not exists logs_updated_idx on public.logs (updated_at);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists logs_touch on public.logs;
create trigger logs_touch before update on public.logs for each row execute function public.touch_updated_at();

-- ---------- the fire itself (single row) ----------
create table if not exists public.fire_state (
  id int primary key default 1 check (id = 1),
  ignite_at timestamptz,
  stoke_at timestamptz,
  mode text not null default 'normal',
  reset_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.fire_state (id) values (1) on conflict (id) do nothing;

alter table public.fire_state add column if not exists leaders_rev integer not null default 0;
-- after-lighting moments: memory photos, cheers and sing-alongs
alter table public.fire_state add column if not exists memories_at timestamptz;
alter table public.fire_state add column if not exists cheer_at timestamptz;
alter table public.fire_state add column if not exists cheer_text text not null default '';
alter table public.fire_state add column if not exists song_at timestamptz;
alter table public.fire_state add column if not exists song_title text not null default '';
-- memory photos paused by the fire keeper (null = playing)
alter table public.fire_state add column if not exists memories_paused_at timestamptz;
-- Kahoot quiz button: the link, and whether everyone can see the button
alter table public.fire_state add column if not exists quiz_url text not null default '';
alter table public.fire_state add column if not exists quiz_on boolean not null default false;
-- whether guests can lay their logs right now (the fire keeper opens and closes it)
alter table public.fire_state add column if not exists logs_open boolean not null default false;

-- ---------- the 5 leaders' honour logs (private: links carry a secret token) ----------
create table if not exists public.leaders (
  slot int primary key check (slot between 0 and 4),
  name text not null default '',
  title text not null default '',
  token text not null unique,
  called_at timestamptz,
  laid_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.leaders enable row level security;
-- (no read policy: only the server can see tokens; the public view comes from campfire_since)

-- ---------- who is around the fire (heartbeat) ----------
create table if not exists public.presence (
  device_id text primary key check (char_length(device_id) between 8 and 64),
  last_seen timestamptz not null default now()
);

-- Everyone may read logs and the fire. Only the server (secret key) may write them.
alter table public.logs enable row level security;
alter table public.fire_state enable row level security;
alter table public.presence enable row level security;
drop policy if exists "read logs" on public.logs;
create policy "read logs" on public.logs for select using (true);
drop policy if exists "read fire" on public.fire_state;
create policy "read fire" on public.fire_state for select using (true);

-- Heartbeat: records this device and returns how many are around the fire.
create or replace function public.heartbeat(p_device text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_device is null or char_length(p_device) < 8 or char_length(p_device) > 64 then
    return 0;
  end if;
  insert into presence (device_id, last_seen) values (p_device, now())
    on conflict (device_id) do update set last_seen = excluded.last_seen;
  if random() < 0.02 then
    delete from presence where last_seen < now() - interval '1 hour';
  end if;
  select count(*) into n from presence where last_seen > now() - interval '100 seconds';
  return n;
end $$;

-- One cheap call that returns everything that changed since a moment in time.
create or replace function public.campfire_since(p_since timestamptz) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'now', now(),
    'fire', (select row_to_json(f) from fire_state f where id = 1),
    'logs', coalesce((select json_agg(l order by l.created_at) from logs l where l.updated_at > p_since), '[]'::json),
    'leaders', coalesce((select json_agg(json_build_object(
        'slot', slot, 'name', name, 'title', title, 'called_at', called_at, 'laid_at', laid_at) order by slot)
      from leaders where name <> ''), '[]'::json)
  );
$$;

grant execute on function public.heartbeat(text) to anon, authenticated;
grant execute on function public.campfire_since(timestamptz) to anon, authenticated;

-- Live updates (for the first ~200 people; everyone else is kept in sync by polling)
alter table public.logs replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.logs; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.fire_state; exception when duplicate_object then null; end;
end $$;

-- ===== 2026-11-05 hardening (same as supabase/migrations/2026-11-05-hardening.sql) =====
-- ---------- rate limits (wrong admin passcodes, new logs per network) ----------
create table if not exists public.rate_hits (
  key text not null,
  at timestamptz not null default now()
);
create index if not exists rate_hits_key_at_idx on public.rate_hits (key, at);
-- no policies: only the server (secret key) can touch it
alter table public.rate_hits enable row level security;

-- Records a hit for `p_key` (if p_add) and returns how many it had in the last p_window seconds.
create or replace function public.rate_hit(p_key text, p_window integer, p_add boolean)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_add then
    insert into rate_hits (key) values (left(p_key, 200));
  end if;
  if random() < 0.02 then
    delete from rate_hits where at < now() - interval '1 day';
  end if;
  select count(*) into n from rate_hits
    where key = left(p_key, 200) and at > now() - make_interval(secs => greatest(p_window, 1));
  return n;
end $$;

-- ---------- lay a log: check the limit and add it in one step ----------
-- Returns {status: 'ok'|'existing'|'closed'|'full', log}. One at a time, so a rush of
-- people can't all slip past the limit together. Hidden and test logs don't count.
create or replace function public.lay_log(p_device text, p_name text, p_batch text, p_message text, p_max integer)
returns json language plpgsql security definer set search_path = public as $$
declare r public.logs%rowtype; n integer;
begin
  select * into r from logs where device_id = p_device;
  if found then return json_build_object('status', 'existing', 'log', row_to_json(r)); end if;
  perform pg_advisory_xact_lock(hashtext('campfire.lay_log'));
  select * into r from logs where device_id = p_device;
  if found then return json_build_object('status', 'existing', 'log', row_to_json(r)); end if;
  if exists (select 1 from fire_state where id = 1 and logs_open = false) then
    return json_build_object('status', 'closed');
  end if;
  select count(*) into n from logs where not hidden and device_id not like 'test-%';
  if n >= p_max then return json_build_object('status', 'full'); end if;
  -- stamped with the time it is really added (after waiting its turn), so polling can't miss it
  insert into logs (device_id, name, batch, message, created_at, updated_at)
    values (p_device, p_name, coalesce(p_batch, ''), coalesce(p_message, ''), clock_timestamp(), clock_timestamp())
    returning * into r;
  return json_build_object('status', 'ok', 'log', row_to_json(r));
end $$;

-- Only the server may call these (otherwise anyone could skip the name check and limits).
revoke execute on function public.rate_hit(text, integer, boolean) from public, anon, authenticated;
revoke execute on function public.lay_log(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.rate_hit(text, integer, boolean) to service_role;
grant execute on function public.lay_log(text, text, text, text, integer) to service_role;

-- ---------- live updates: only the fire, not every log ----------
-- Guests now fetch new logs through the shared cache, so stop sending every log to everyone.
alter table public.logs replica identity default;
do $$ begin
  begin alter publication supabase_realtime drop table public.logs; exception when others then null; end;
end $$;

-- tell the Supabase API about the new functions straight away
notify pgrst, 'reload schema';

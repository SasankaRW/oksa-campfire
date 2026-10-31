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

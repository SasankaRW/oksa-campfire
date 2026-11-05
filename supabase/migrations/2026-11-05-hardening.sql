-- 2026-11-05 hardening. Run once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to run again. The site keeps working without it (it falls back to the old way);
-- this makes it sturdier on the night. Run supabase/schema.sql first if you haven't.

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

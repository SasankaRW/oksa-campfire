-- Run this once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  name text not null check (char_length(name) between 1 and 32),
  batch text default '' check (char_length(batch) <= 4),
  message text default '' check (char_length(message) <= 48),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists logs_created_idx on public.logs (created_at);

create table if not exists public.fire_state (
  id int primary key default 1 check (id = 1),
  ignite_at timestamptz,
  stoke_at timestamptz,
  mode text not null default 'normal',
  reset_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.fire_state (id) values (1) on conflict (id) do nothing;

-- Everyone may read. Only the server (service role key) may write.
alter table public.logs enable row level security;
alter table public.fire_state enable row level security;
drop policy if exists "read logs" on public.logs;
create policy "read logs" on public.logs for select using (true);
drop policy if exists "read fire" on public.fire_state;
create policy "read fire" on public.fire_state for select using (true);

-- Live updates
alter table public.logs replica identity full;
alter publication supabase_realtime add table public.logs;
alter publication supabase_realtime add table public.fire_state;

-- Registry of desktop installations signed in to a Polymux account.
-- Devices heartbeat into their own row; rows belonging to the same account
-- discover each other and auto-pair using the published pairing secret,
-- which row-level security scopes to the owning account only.
create table public.devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text primary key,
  device_name text not null,
  device_type text,
  platform text,
  app_version text,
  host_id text,
  host_name text,
  pairing_secret text,
  relay_origin text,
  last_heartbeat timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint device_id_length check (char_length(device_id) <= 120),
  constraint host_id_length check (char_length(host_id) <= 120)
);

comment on table public.devices is
  'Desktop installations signed in to a Polymux account. pairing_secret is
  readable only by the owning account so signed-in devices can auto-pair.';

create index devices_user_id_idx on public.devices (user_id);
create index devices_last_heartbeat_idx on public.devices (last_heartbeat);

alter table public.devices enable row level security;

create policy "accounts manage their own devices"
  on public.devices
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

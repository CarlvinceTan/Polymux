-- A signed-out installation may be unable to withdraw its old account row.
-- Keep that row owned by its original account while allowing a new account
-- to register the same physical device independently under the existing RLS.
alter table public.devices
  drop constraint devices_pkey,
  add primary key (user_id, device_id);

comment on column public.devices.device_id is
  'Stable physical installation identity, unique within each owning account.';

notify pgrst, 'reload schema';

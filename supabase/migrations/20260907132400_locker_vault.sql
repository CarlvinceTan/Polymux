-- Account-linked Locker vault. The object is an encrypted KeePass kdbx blob.
-- Metadata never stores passwords, TOTP secrets, recovery codes, or keys.
create table public.locker_vaults (
  user_id uuid primary key references auth.users (id) on delete cascade,
  revision bigint not null default 1,
  updated_at timestamptz not null default now(),
  checksum text not null,
  object_name text not null,
  byte_size integer not null default 0,
  constraint locker_vault_revision_positive check (revision > 0),
  constraint locker_vault_checksum check (checksum ~ '^[a-f0-9]{64}$'),
  constraint locker_vault_object_name check (object_name ~ '^[1-9][0-9]*-[a-f0-9]{64}[.]kdbx$'),
  constraint locker_vault_byte_size check (byte_size >= 0 and byte_size <= 20971520)
);

comment on table public.locker_vaults is
  'Per-account Locker vault metadata. The secret store is the encrypted kdbx
  object in the locker storage bucket; this row has no plaintext secrets.';

alter table public.locker_vaults enable row level security;

create policy "accounts manage their own locker vault"
  on public.locker_vaults
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('locker', 'locker', false, 20971520, array['application/octet-stream']::text[])
on conflict (id) do nothing;

create policy "accounts read their locker objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'locker'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "accounts create immutable locker objects"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'locker'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.filename(name)) ~ '^[1-9][0-9]*-[a-f0-9]{64}[.]kdbx$'
  );

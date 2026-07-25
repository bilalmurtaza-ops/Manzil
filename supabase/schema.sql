-- ============================================================================
-- Manzil cloud backup — database schema
--
-- HOW TO USE: Supabase dashboard -> SQL Editor -> New query -> paste ALL of this
-- -> Run. It is safe to re-run (every statement is idempotent).
--
-- Design: exactly one backup row per user. Disaster recovery only — newest
-- upload wins, no per-record merging.
-- ============================================================================

create table if not exists public.backups (
  user_id         uuid        primary key references auth.users(id) on delete cascade,

  -- Stored as TEXT, never jsonb. jsonb normalizes and reorders object keys, which
  -- would invalidate the client-side checksum computed over the exact serialization.
  payload         text        not null,

  schema_version  integer     not null,
  app_version     text        not null default '',
  device_label    text        not null default '',
  platform        text        not null default '',
  byte_size       integer     not null,
  checksum        text        not null,
  item_counts     jsonb       not null default '{}'::jsonb,

  -- Server-owned optimistic-concurrency counter. The client never writes this;
  -- it is what stops a stale device overwriting a newer backup.
  rev             bigint      not null default 1,

  -- One level of server-side undo, so "newest wins" is never a one-way door.
  prev_payload    text,
  prev_rev        bigint,
  prev_updated_at timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- 3 MB ceiling. Real payloads measure ~80 KB, so this is ~35x headroom while
  -- still bounding what one account can store on the free tier.
  constraint backups_payload_size_chk
    check (octet_length(payload) <= 3145728),
  constraint backups_byte_size_chk
    check (byte_size >= 0 and byte_size <= 3145728),
  constraint backups_schema_version_chk
    check (schema_version between 1 and 100)
);

-- ----------------------------------------------------------------------------
-- Trigger: the server owns rev, timestamps, ownership and the prev_* snapshot.
-- A malicious client cannot forge rev, backdate updated_at, or write a row
-- belonging to another user.
-- ----------------------------------------------------------------------------
create or replace function public.backups_bump_rev()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- coalesce lets you INSERT a test row from the SQL Editor, where auth.uid() is null.
  new.user_id := coalesce(auth.uid(), new.user_id);

  if tg_op = 'INSERT' then
    new.rev             := 1;
    new.created_at      := pg_catalog.now();
    new.updated_at      := pg_catalog.now();
    new.prev_payload    := null;
    new.prev_rev        := null;
    new.prev_updated_at := null;
  else
    new.rev             := old.rev + 1;
    new.created_at      := old.created_at;
    new.updated_at      := pg_catalog.now();
    new.prev_payload    := old.payload;
    new.prev_rev        := old.rev;
    new.prev_updated_at := old.updated_at;
  end if;

  return new;
end;
$$;

drop trigger if exists backups_bump_rev_trg on public.backups;
create trigger backups_bump_rev_trg
  before insert or update on public.backups
  for each row execute function public.backups_bump_rev();

-- ----------------------------------------------------------------------------
-- Row Level Security.
--
-- THIS is what makes shipping the anon key inside the app safe. Note there is
-- deliberately NO policy for the `anon` role, so an unauthenticated request
-- carrying that key can read and write absolutely nothing.
--
-- `(select auth.uid())` rather than bare `auth.uid()` so Postgres caches it as an
-- InitPlan instead of re-evaluating per row.
-- ----------------------------------------------------------------------------
alter table public.backups enable row level security;

drop policy if exists "backups_select_own" on public.backups;
create policy "backups_select_own"
  on public.backups for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "backups_insert_own" on public.backups;
create policy "backups_insert_own"
  on public.backups for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "backups_update_own" on public.backups;
create policy "backups_update_own"
  on public.backups for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "backups_delete_own" on public.backups;
create policy "backups_delete_own"
  on public.backups for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- Belt and braces: strip any blanket grants Supabase's default privileges may
-- have handed the anonymous role.
revoke all on public.backups from anon;
grant select, insert, update, delete on public.backups to authenticated;

-- ============================================================================
-- Verify (optional): run these after the script above.
--   select relrowsecurity from pg_class where relname = 'backups';   -- expect: true
--   select polname from pg_policies where tablename = 'backups';     -- expect: 4 rows
-- ============================================================================

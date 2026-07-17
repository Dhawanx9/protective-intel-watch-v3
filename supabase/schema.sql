-- Protective Intel Watch v2 — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Database > SQL Editor > New query).

-- =========================================================================
-- 1. Feeds table — the live, single source of truth for feed configuration.
--    Both the browser (Feed Manager UI) and the GitHub Actions pipeline
--    read/write this via Supabase's auto-generated REST API.
-- =========================================================================
create table if not exists public.feeds (
  id text primary key,                 -- kebab-case slug, e.g. "bbc-world"
  label text not null,
  url text not null,
  region text not null default 'Custom',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep updated_at current on every edit.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_feeds_updated_at on public.feeds;
create trigger trg_feeds_updated_at
  before update on public.feeds
  for each row execute function public.set_updated_at();

-- =========================================================================
-- 2. Admin allowlist — controls WHO is allowed to write, independent of
--    "is this person logged in at all." Supabase magic-link sign-in will
--    create an account for literally any email that requests one, so
--    gating writes on auth.role() = 'authenticated' alone is NOT enough —
--    it must be gated on membership in this table.
-- =========================================================================
create table if not exists public.admins (
  email text primary key
);

-- Add your team's emails here (repeat for each teammate who should manage feeds):
-- insert into public.admins (email) values ('you@yourcompany.com');

-- =========================================================================
-- 3. Row Level Security — this is the actual security boundary. The anon
--    key embedded in the frontend is *meant* to be public; RLS is what
--    makes that safe. Do not skip enabling this.
-- =========================================================================
alter table public.feeds enable row level security;
alter table public.admins enable row level security;

-- Anyone (including the unauthenticated GitHub Actions pipeline and the
-- read-only dashboard view) can read the feed list.
drop policy if exists "public_read_feeds" on public.feeds;
create policy "public_read_feeds" on public.feeds
  for select using (true);

-- Only signed-in users whose email is in public.admins can add feeds.
drop policy if exists "admins_insert_feeds" on public.feeds;
create policy "admins_insert_feeds" on public.feeds
  for insert with check (
    auth.jwt() ->> 'email' in (select email from public.admins)
  );

-- Only admins can edit feeds (label, url, region, enabled toggle).
drop policy if exists "admins_update_feeds" on public.feeds;
create policy "admins_update_feeds" on public.feeds
  for update using (
    auth.jwt() ->> 'email' in (select email from public.admins)
  );

-- Only admins can delete feeds.
drop policy if exists "admins_delete_feeds" on public.feeds;
create policy "admins_delete_feeds" on public.feeds
  for delete using (
    auth.jwt() ->> 'email' in (select email from public.admins)
  );

-- No public policy on public.admins at all — nobody can read or write the
-- allowlist through the API. Manage it from the Supabase SQL Editor only.

-- =========================================================================
-- 4. Recommended: in Supabase Dashboard > Authentication > Providers > Email,
--    turn OFF "Allow new users to sign up" once your admins table is
--    populated. Magic-link sign-in still works for existing users; it just
--    stops anyone else from creating an account at all. Combined with the
--    admins-table check above, this gives you two independent layers.
-- =========================================================================

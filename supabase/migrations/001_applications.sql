-- Applications that Sarah collects in chat (people who want to join YSC,
-- an event, a committee, etc.). Previously these were only emailed and
-- written to /tmp on Vercel, where they were lost.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create table if not exists public.applications (
  id              text primary key,
  user_id         text,
  conversation_id text,
  full_name       text not null default '',
  phone           text not null default '',
  email           text not null default '',
  university      text not null default '',
  faculty         text not null default '',
  academic_year   text not null default '',
  request         text not null default '',
  role            text not null default '',
  skills          text not null default '',
  notes           text not null default '',
  status          text not null default 'new',   -- new | contacted | accepted | rejected
  created_at      timestamptz not null default now()
);

create index if not exists applications_created_at_idx on public.applications (created_at desc);
create index if not exists applications_status_idx on public.applications (status);

-- The server uses the service role key, which bypasses RLS. Enabling RLS with
-- no policies keeps this table unreadable from the public anon key.
alter table public.applications enable row level security;

-- Speeds up the per-request lookups now that users and sessions are read
-- from the database instead of an in-memory copy.
create index if not exists users_email_idx on public.users (email);
create index if not exists sessions_user_id_idx on public.sessions (user_id);

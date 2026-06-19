create extension if not exists pgcrypto;

create table if not exists public.loot_log_bundles (
  id uuid primary key default gen_random_uuid(),
  start_at timestamptz not null,
  end_at timestamptz not null,
  combined_loot_summary jsonb not null default '{"rows":[],"totals":{}}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loot_log_submissions (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.loot_log_bundles(id) on delete cascade,
  submitted_by text not null,
  event_start_at timestamptz not null,
  event_end_at timestamptz not null,
  raw_log_text text not null,
  skipped_rows integer[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.loot_log_events (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.loot_log_bundles(id) on delete cascade,
  submission_id uuid not null references public.loot_log_submissions(id) on delete cascade,
  event_hash text not null,
  dedupe_key text not null,
  event_type text not null check (event_type in ('looted', 'lost')),
  player_name text not null,
  alliance text not null default '',
  guild text not null default '',
  item_id text not null default '',
  item_name text not null,
  enchantment integer not null default 0,
  quantity integer not null check (quantity > 0),
  timestamp_utc timestamptz not null,
  lost_to text not null default '',
  created_at timestamptz not null default now(),
  unique (bundle_id, event_hash)
);

create table if not exists public.chest_log_submissions (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.loot_log_bundles(id) on delete cascade,
  submitted_by text not null,
  raw_log_text text not null,
  parsed_chest_summary jsonb not null default '{"rows":[],"totals":{}}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists loot_log_bundles_time_idx
  on public.loot_log_bundles (start_at, end_at);

create index if not exists loot_log_submissions_bundle_idx
  on public.loot_log_submissions (bundle_id, created_at);

create index if not exists loot_log_events_bundle_idx
  on public.loot_log_events (bundle_id, timestamp_utc);

create index if not exists chest_log_submissions_bundle_idx
  on public.chest_log_submissions (bundle_id, created_at);

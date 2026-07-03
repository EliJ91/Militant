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
  emv_each numeric,
  emv_total numeric,
  emv_source_city text,
  emv_priced_at timestamptz,
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

create table if not exists public.siphoned_energy_transactions (
  id uuid primary key default gen_random_uuid(),
  event_hash text not null unique,
  occurred_at timestamp without time zone not null,
  player_name text not null,
  reason text not null check (reason in ('Deposit', 'Withdrawal')),
  amount integer not null check (
    (reason = 'Deposit' and amount > 0)
    or (reason = 'Withdrawal' and amount < 0)
  ),
  created_at timestamptz not null default now()
);

create index if not exists siphoned_energy_transactions_occurred_idx
  on public.siphoned_energy_transactions (occurred_at desc, id);

create index if not exists siphoned_energy_transactions_player_idx
  on public.siphoned_energy_transactions (lower(player_name));

create table if not exists public.siphoned_energy_starred_players (
  id uuid primary key default gen_random_uuid(),
  player_name text not null,
  player_key text not null unique,
  starred boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists siphoned_energy_starred_players_starred_idx
  on public.siphoned_energy_starred_players (starred, player_name);

create table if not exists public.siphoned_energy_guild_members (
  id uuid primary key default gen_random_uuid(),
  guild_id text not null,
  player_name text not null,
  player_key text not null,
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guild_id, player_key)
);

create index if not exists siphoned_energy_guild_members_guild_idx
  on public.siphoned_energy_guild_members (guild_id, refreshed_at);

alter table public.siphoned_energy_transactions enable row level security;

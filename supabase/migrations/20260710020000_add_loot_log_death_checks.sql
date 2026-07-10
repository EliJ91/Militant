create table if not exists public.loot_log_death_checks (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.loot_log_bundles(id) on delete cascade,
  player_name text not null,
  player_key text not null,
  player_id text not null default '',
  status text not null check (status in ('found', 'not_found')),
  event_id text not null default '',
  death_at timestamptz,
  matched_items jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bundle_id, player_key)
);

create index if not exists loot_log_death_checks_bundle_idx
  on public.loot_log_death_checks (bundle_id, player_key);

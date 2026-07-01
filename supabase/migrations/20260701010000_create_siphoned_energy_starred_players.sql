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

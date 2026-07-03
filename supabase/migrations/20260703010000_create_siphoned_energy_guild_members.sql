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

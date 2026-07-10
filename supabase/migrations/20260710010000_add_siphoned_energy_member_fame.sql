alter table public.siphoned_energy_guild_members
  add column if not exists player_id text not null default '',
  add column if not exists pvp_kill_fame bigint not null default 0,
  add column if not exists pve_kill_fame bigint not null default 0,
  add column if not exists death_fame bigint not null default 0,
  add column if not exists pvp_death_fame_ratio numeric;

create index if not exists siphoned_energy_guild_members_player_id_idx
  on public.siphoned_energy_guild_members (player_id);

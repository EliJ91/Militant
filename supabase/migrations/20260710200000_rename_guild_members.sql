alter table if exists public.siphoned_energy_guild_members
  rename to guild_members;

alter index if exists public.siphoned_energy_guild_members_guild_idx
  rename to guild_members_guild_idx;

alter index if exists public.siphoned_energy_guild_members_player_id_idx
  rename to guild_members_player_id_idx;

alter table public.loot_log_death_checks
  add column if not exists death_url text not null default '';

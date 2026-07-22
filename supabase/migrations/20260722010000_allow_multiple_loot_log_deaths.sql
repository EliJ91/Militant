alter table public.loot_log_death_checks
  drop constraint if exists loot_log_death_checks_bundle_id_player_key_key;

create unique index if not exists loot_log_death_checks_bundle_event_idx
  on public.loot_log_death_checks (bundle_id, event_id)
  where event_id <> '';

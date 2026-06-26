alter table public.loot_log_events
  add column if not exists emv_each numeric,
  add column if not exists emv_total numeric,
  add column if not exists emv_source_city text,
  add column if not exists emv_priced_at timestamptz;

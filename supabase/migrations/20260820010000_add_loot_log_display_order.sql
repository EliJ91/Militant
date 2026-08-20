alter table public.loot_log_bundles
  add column if not exists display_order integer;

create index if not exists loot_log_bundles_display_order_idx
  on public.loot_log_bundles (display_order desc, created_at desc);

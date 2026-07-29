create table if not exists public.loot_log_ignored_items (
  item_key text primary key,
  item_id text not null default '',
  item_name text not null,
  enchantment integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loot_log_ignored_items_name_idx
  on public.loot_log_ignored_items (lower(item_name));

alter table public.loot_log_ignored_items enable row level security;

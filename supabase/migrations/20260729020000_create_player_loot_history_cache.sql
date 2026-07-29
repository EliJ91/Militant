create table if not exists public.player_loot_history_cache (
  cache_key text primary key,
  players jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.player_loot_history_cache enable row level security;

insert into public.player_loot_history_cache (cache_key, players)
values ('global', '[]'::jsonb)
on conflict (cache_key) do nothing;

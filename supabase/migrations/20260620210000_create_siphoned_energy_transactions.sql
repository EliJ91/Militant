create extension if not exists pgcrypto;

create table if not exists public.siphoned_energy_transactions (
  id uuid primary key default gen_random_uuid(),
  event_hash text not null unique,
  occurred_at timestamp without time zone not null,
  player_name text not null,
  reason text not null check (reason in ('Deposit', 'Withdrawal')),
  amount integer not null check (
    (reason = 'Deposit' and amount > 0)
    or (reason = 'Withdrawal' and amount < 0)
  ),
  created_at timestamptz not null default now()
);

create index if not exists siphoned_energy_transactions_occurred_idx
  on public.siphoned_energy_transactions (occurred_at desc, id);

create index if not exists siphoned_energy_transactions_player_idx
  on public.siphoned_energy_transactions (lower(player_name));

alter table public.siphoned_energy_transactions enable row level security;

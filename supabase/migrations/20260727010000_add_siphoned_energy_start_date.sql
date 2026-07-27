create table if not exists public.siphoned_energy_settings (
  id text primary key check (id = 'tracker'),
  start_date date,
  updated_at timestamptz not null default now()
);

insert into public.siphoned_energy_settings (id)
values ('tracker')
on conflict (id) do nothing;

alter table public.siphoned_energy_settings enable row level security;

create table if not exists public.webapp_permission_settings (
  id text primary key default 'default',
  settings jsonb not null default '{"roles":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.webapp_permission_settings (id, settings)
values ('default', '{"roles":[]}'::jsonb)
on conflict (id) do nothing;

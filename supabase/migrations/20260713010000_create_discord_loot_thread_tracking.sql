create table if not exists public.discord_loot_threads (
  thread_id text primary key,
  channel_id text not null,
  bundle_id uuid references public.loot_log_bundles(id) on delete set null,
  thread_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists discord_loot_threads_bundle_idx
  on public.discord_loot_threads (bundle_id);

create table if not exists public.discord_loot_attachments (
  attachment_id text primary key,
  thread_id text not null references public.discord_loot_threads(thread_id) on delete cascade,
  message_id text not null,
  bundle_id uuid references public.loot_log_bundles(id) on delete set null,
  file_name text not null,
  log_type text not null check (log_type in ('loot', 'chest')),
  submitted_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists discord_loot_attachments_thread_idx
  on public.discord_loot_attachments (thread_id, created_at);

create index if not exists discord_loot_attachments_bundle_idx
  on public.discord_loot_attachments (bundle_id);

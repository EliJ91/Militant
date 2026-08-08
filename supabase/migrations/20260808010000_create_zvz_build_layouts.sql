create table if not exists public.zvz_build_layouts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  builds jsonb not null default '[]'::jsonb,
  source_file_name text not null default '',
  uploaded_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zvz_build_layouts_updated_idx
  on public.zvz_build_layouts (updated_at desc);

alter table public.zvz_build_layouts enable row level security;

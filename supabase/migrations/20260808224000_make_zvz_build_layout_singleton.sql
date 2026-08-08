alter table public.zvz_build_layouts
  add column if not exists singleton_key text not null default 'master';

with ranked as (
  select id, row_number() over (order by updated_at desc, created_at desc, id desc) as row_number
  from public.zvz_build_layouts
)
delete from public.zvz_build_layouts
where id in (select id from ranked where row_number > 1);

update public.zvz_build_layouts
set singleton_key = 'master';

create unique index if not exists zvz_build_layouts_singleton_idx
  on public.zvz_build_layouts (singleton_key);

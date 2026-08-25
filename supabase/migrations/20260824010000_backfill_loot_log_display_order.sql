with existing_order as (
  select coalesce(max(display_order), 0) as max_display_order
  from public.loot_log_bundles
  where display_order is not null
),
missing_order as (
  select
    id,
    row_number() over (order by created_at asc, id asc) as position
  from public.loot_log_bundles
  where display_order is null
)
update public.loot_log_bundles as bundle
set display_order = existing_order.max_display_order + missing_order.position
from missing_order, existing_order
where bundle.id = missing_order.id;

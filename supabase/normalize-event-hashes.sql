create extension if not exists pgcrypto;

with ranked_events as (
  select
    id,
    row_number() over (
      partition by
        bundle_id,
        event_type,
        lower(trim(player_name)),
        lower(trim(item_id)),
        lower(trim(item_name)),
        enchantment,
        to_char(timestamp_utc at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        lower(trim(alliance)),
        lower(trim(guild)),
        lower(trim(lost_to))
      order by quantity desc, created_at asc
    ) as event_rank
  from public.loot_log_events
)
delete from public.loot_log_events events
using ranked_events
where events.id = ranked_events.id
  and ranked_events.event_rank > 1;

update public.loot_log_events
set
  dedupe_key = concat_ws('|',
    event_type,
    lower(trim(player_name)),
    lower(trim(item_id)),
    lower(trim(item_name)),
    enchantment::text,
    to_char(timestamp_utc at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    lower(trim(alliance)),
    lower(trim(guild)),
    lower(trim(lost_to))
  ),
  event_hash = encode(digest(concat_ws('|',
    event_type,
    lower(trim(player_name)),
    lower(trim(item_id)),
    lower(trim(item_name)),
    enchantment::text,
    to_char(timestamp_utc at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    lower(trim(alliance)),
    lower(trim(guild)),
    lower(trim(lost_to))
  ), 'sha256'), 'hex');

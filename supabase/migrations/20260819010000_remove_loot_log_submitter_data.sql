update public.loot_log_submissions
set submitted_by = ''
where submitted_by <> '';

alter table public.loot_log_submissions
alter column submitted_by set default '';

update public.chest_log_submissions
set submitted_by = ''
where submitted_by <> '';

alter table public.chest_log_submissions
alter column submitted_by set default '';

update public.discord_loot_attachments
set submitted_by = ''
where submitted_by <> '';

alter table public.discord_loot_attachments
alter column submitted_by set default '';

update public.loot_log_bundles
set combined_loot_summary = combined_loot_summary - 'displaySubmitters' - 'mergedBy'
where combined_loot_summary ? 'displaySubmitters'
   or combined_loot_summary ? 'mergedBy';

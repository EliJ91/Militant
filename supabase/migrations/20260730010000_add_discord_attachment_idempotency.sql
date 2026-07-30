alter table public.loot_log_submissions
  add column if not exists discord_attachment_id text;

create unique index if not exists loot_log_submissions_discord_attachment_id_idx
  on public.loot_log_submissions (discord_attachment_id)
  where discord_attachment_id is not null;

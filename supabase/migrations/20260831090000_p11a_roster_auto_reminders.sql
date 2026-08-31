-- P11a: team_roster members were only ever reminded when the SMD clicked
-- "Send reminder" (send_roster_training_reminder, p9c), rate-limited to
-- once per 7 days. Product ask: every roster member should automatically
-- get a training reminder every Wednesday and Saturday, no manual click
-- required. The manual button + its 7-day cooldown stay as-is for an
-- on-demand nudge; this adds a separate, cron-driven cadence on top.

alter table public.team_roster
  add column auto_reminders_enabled boolean not null default true;

-- One row per (roster entry, local calendar day) the automatic Wed/Sat
-- reminder was sent -- same idempotency-via-unique-index shape as
-- notification_log (p55a): insert first, then send, so two overlapping
-- cron runs can't double-send.
create table public.team_roster_reminder_log (
  id         uuid primary key default gen_random_uuid(),
  roster_id  uuid not null references public.team_roster(id) on delete cascade,
  local_date date not null,
  sent_at    timestamptz not null default now(),
  unique (roster_id, local_date)
);
create index team_roster_reminder_log_roster_idx on public.team_roster_reminder_log (roster_id, sent_at);
alter table public.team_roster_reminder_log enable row level security;
-- No policies: written only by the cron route's service-role client, same
-- lockdown pattern as notification_log.
revoke all on public.team_roster_reminder_log from anon, authenticated;

-- P15a: two new call sources -- "Existing client" and "Existing recruit" --
-- for calls/recruiting conversations against people already in the book,
-- not a fresh lead. Schema-only (enum values + the daily_metrics breakdown
-- columns that will hold their counts): a new enum value can't be read by
-- the same transaction that adds it, so the functions that filter on these
-- values (recompute_day, agent_aggregate, team_breakdown) are updated in
-- the next migration, same split as 20260825220000_p8a's recruit_status
-- change.
alter type public.call_source add value if not exists 'existing_client';
alter type public.call_source add value if not exists 'existing_recruit';

alter table public.daily_metrics
  add column if not exists src_existing_client int not null default 0,
  add column if not exists src_existing_recruit int not null default 0;

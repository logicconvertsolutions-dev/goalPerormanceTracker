-- Damage assessment for P25 findings F1 and F2 — run BEFORE the Phase A
-- migration (`.github/Spec Sheets/12-appointment-lifecycle-remediation.md`
-- §6 step 2). The numbers it returns belong in the Phase A PR body and in
-- the agent-facing announcement (§9): days that come back, and days that
-- cannot.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/metrics-damage-report.sql
--
-- Counts only. No prospect PII.

\echo '== F1: agent-days with appointment activity but NO daily_metrics row =='
\echo '   (recoverable — Phase A re-marks these dirty and the drain rebuilds them)'

select
  a.org_id,
  ap.agent_id,
  count(*)                        as missing_days,
  min(ap.appt_date)               as earliest,
  max(ap.appt_date)               as latest
from (
  select distinct agent_id, appt_date
  from public.appointments
) ap
join public.agents a on a.id = ap.agent_id
where not exists (
  select 1 from public.daily_metrics m
  where m.agent_id = ap.agent_id and m.activity_date = ap.appt_date
)
group by a.org_id, ap.agent_id
order by missing_days desc;

\echo ''
\echo '== F1 total =='

select count(*) as total_missing_agent_days
from (
  select distinct agent_id, appt_date from public.appointments
) ap
where not exists (
  select 1 from public.daily_metrics m
  where m.agent_id = ap.agent_id and m.activity_date = ap.appt_date
);

\echo ''
\echo '== F2: days already past each org''s retention window =='
\echo '   Call logs there may already be purged. Where the raw rows are gone,'
\echo '   the daily_metrics row cannot be rebuilt from source — it is lost.'
\echo '   A nonzero "orgs_with_retention" means the fuse is lit even if'
\echo '   purged_days is still 0 today.'

select
  o.id                             as org_id,
  o.name                           as org_name,
  o.call_log_retention_months,
  (current_date - (o.call_log_retention_months || ' months')::interval)::date
                                   as purge_horizon,
  (select count(*) from public.call_logs cl
    where cl.org_id = o.id
      and cl.call_date < current_date - (o.call_log_retention_months || ' months')::interval)
                                   as call_logs_awaiting_purge
from public.organizations o
where o.call_log_retention_months is not null
order by o.name;

\echo ''
\echo '== F2: daily_metrics rows already missing behind the purge horizon =='
\echo '   (unrecoverable — reported so the loss is named, not left as zeroes)'

select
  o.id   as org_id,
  o.name as org_name,
  count(*) as agent_days_missing_behind_horizon
from public.organizations o
join public.agents a on a.org_id = o.id
cross join lateral generate_series(
  (current_date - interval '5 years')::date,
  (current_date - (o.call_log_retention_months || ' months')::interval)::date,
  interval '1 day'
) as d(day)
where o.call_log_retention_months is not null
  and not exists (
    select 1 from public.daily_metrics m
    where m.agent_id = a.id and m.activity_date = d.day::date
  )
  and exists (
    select 1 from public.daily_metrics m2
    where m2.agent_id = a.id and m2.activity_date > d.day::date
  )
group by o.id, o.name
order by agent_days_missing_behind_horizon desc;

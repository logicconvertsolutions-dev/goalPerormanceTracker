-- Damage assessment for P25 findings F1 and F2 — run BEFORE the Phase A
-- migration (`.github/Spec Sheets/12-appointment-lifecycle-remediation.md`
-- §6 step 2). The numbers belong in the Phase A PR body and in the
-- agent-facing announcement (§9): days that come back, and days that cannot.
--
-- Read-only. Counts and dates only, no prospect PII.
--
-- PORTABLE ON PURPOSE: one statement, no psql meta-commands, so it runs
-- unchanged in the Supabase SQL editor, in psql, or through any client.
-- (An earlier revision used `\echo` and failed in the SQL editor with
-- `syntax error at or near "\"` — don't reintroduce meta-commands here.)
--
--   psql "$DATABASE_URL" -f scripts/metrics-damage-report.sql
--   ...or paste the whole file into the Supabase SQL editor.
--
-- HOW TO READ THE RESULT
--   F1 (recoverable)  — agent-days that have appointment activity but no
--                       daily_metrics row, because the delete guard dropped
--                       them. Phase A re-marks these dirty and the drain
--                       rebuilds them from source. Expect this to fall to 0.
--   F2 (unrecoverable) — "call logs already past horizon" is the live
--                       exposure: those rows are eligible for the nightly
--                       purge, and once purged their daily_metrics rows
--                       cannot be rebuilt. Compare "oldest call_date"
--                       against "purge horizon": if the oldest is NEWER than
--                       the horizon, nothing has been lost yet.

with f1_missing as (
  select ap.agent_id, count(*)::bigint as missing_days
  from (select distinct agent_id, appt_date from public.appointments) ap
  where not exists (
    select 1 from public.daily_metrics m
    where m.agent_id = ap.agent_id
      and m.activity_date = ap.appt_date
  )
  group by ap.agent_id
),
f2_org as (
  select
    o.id,
    o.name,
    o.call_log_retention_months as months,
    (current_date - (o.call_log_retention_months || ' months')::interval)::date as horizon,
    (select min(cl.call_date) from public.call_logs cl where cl.org_id = o.id) as oldest_call,
    (select count(*) from public.call_logs cl
      where cl.org_id = o.id
        and cl.call_date < current_date - (o.call_log_retention_months || ' months')::interval
    )::bigint as past_horizon
  from public.organizations o
  where o.call_log_retention_months is not null
)
select section, metric, value from (
  select 1 as sort, 'SCALE' as section, 'daily_metrics rows' as metric,
         count(*)::text as value from public.daily_metrics
  union all
  select 1, 'SCALE', 'appointments rows', count(*)::text from public.appointments
  union all
  select 1, 'SCALE', 'call_logs rows', count(*)::text from public.call_logs

  union all
  select 2, 'F1 (recoverable)', 'agent-days with appointments but no daily_metrics row',
         coalesce(sum(missing_days), 0)::text from f1_missing
  union all
  select 3, 'F1 (recoverable)', '  agent ' || agent_id::text, missing_days::text
    from f1_missing

  union all
  select 4, 'F2 (unrecoverable)', o.name || ' — oldest call_date',
         coalesce(o.oldest_call::text, 'no call logs') from f2_org o
  union all
  select 5, 'F2 (unrecoverable)', o.name || ' — purge horizon (' || o.months || ' months)',
         o.horizon::text from f2_org o
  union all
  select 6, 'F2 (unrecoverable)', o.name || ' — call logs already past horizon',
         o.past_horizon::text from f2_org o
) x
order by sort, section, metric;

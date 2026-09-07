-- Restores the pg_cron pipeline that every fresh Supabase branch/project has
-- been silently missing since the baseline reset.
--
-- Root cause: `pg_dump` (what the baseline was built from) only captures
-- schema objects. Both of the things below are NOT schema objects, so
-- neither ever made it into a migration file -- they existed only as
-- one-off actions taken directly against production at some point:
--   1. The pg_cron / pg_net extensions themselves (enabled via the
--      Dashboard's Extensions UI, not `CREATE EXTENSION` in a migration).
--   2. Every `cron.schedule(...)` call -- each one is a plain INSERT into
--      cron.job, i.e. data, not DDL.
-- Confirmed via list_extensions: production has both pg_cron and pg_net
-- installed; the staging branch (created fresh from this repo's migrations)
-- has neither. Same failure mode as the pgmq/auth-trigger gaps documented
-- elsewhere in this file's neighbors (00000000000002/3) -- this is the same
-- class of gap, just never hit until a fresh branch actually needed the
-- daily_metrics pipeline to run.
--
-- Symptom this fixes: activity (calls/appointments/sales/recruiting) logs
-- fine and correctly marks (agent_id, date) dirty via the enqueue_metrics
-- trigger (that part IS schema, so every branch already has it) -- but
-- nothing was ever draining private.metrics_dirty into public.daily_metrics
-- on a branch missing this pipeline, so the dashboard and team dashboard
-- (which read ONLY daily_metrics, per CLAUDE.md) stayed empty no matter how
-- much activity was logged.
--
-- Not covered here (deliberately -- these are secrets, not schema): the
-- Vault secrets `app_base_url` and `cron_secret` that
-- private.ping_app_route() needs for the three notification-related jobs
-- below to actually reach the app. Every job here is still safe to
-- schedule without them -- ping_app_route() no-ops with a `raise notice`
-- when they're unset (see its definition), and the three daily_metrics/
-- retention jobs (drain-metrics, reconcile-metrics, purge-old-call-logs)
-- don't touch Vault or HTTP at all, so they start working the moment this
-- migration runs.

CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";

-- daily_metrics pipeline (02-data-model.md, "Maintenance: recompute, don't
-- increment"). cron.schedule(job_name, ...) upserts by name, so re-running
-- this migration (or applying it to an environment that already has these
-- jobs) is safe.

SELECT cron.schedule(
  'drain-metrics',
  '* * * * *',
  $$SELECT public.drain_metrics(1000)$$
);

-- No dedicated reconcile function exists (this job's body was never
-- captured anywhere either -- reconstructed here from the documented
-- behavior: "re-mark the last 3 days dirty for every agent"). Feeds
-- drain-metrics' own dirty queue rather than recomputing directly, so it
-- inherits the same idempotent, one-agent-day-at-a-time recompute path.
SELECT cron.schedule(
  'reconcile-metrics',
  '15 3 * * *',
  $$
    INSERT INTO private.metrics_dirty (agent_id, activity_date)
    SELECT a.id, d::date
    FROM public.agents a
    CROSS JOIN generate_series(CURRENT_DATE - 2, CURRENT_DATE, INTERVAL '1 day') AS d
    ON CONFLICT DO NOTHING
  $$
);

SELECT cron.schedule(
  'purge-old-call-logs',
  '30 3 * * *',
  $$SELECT private.purge_old_call_logs()$$
);

-- Notification pipeline (P14a). Scheduled the same way, but see the note
-- above -- these no-op until app_base_url/cron_secret exist in Vault for
-- this environment.

SELECT cron.schedule(
  'enqueue-due-notifications',
  '*/5 * * * *',
  $$SELECT private.enqueue_due_notifications()$$
);

SELECT cron.schedule(
  'ping-notification-drain',
  '* * * * *',
  $$SELECT private.ping_notification_drain()$$
);

SELECT cron.schedule(
  'ping-legacy-notifications',
  '*/5 * * * *',
  $$SELECT private.ping_legacy_notifications()$$
);

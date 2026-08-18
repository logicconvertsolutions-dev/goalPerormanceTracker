-- pg_cron must live in its own `cron` schema on Supabase.
create extension if not exists pg_cron;

-- Drain every minute. A logged call reaches the SMD roster within ~60s; the
-- agent's own screens read their raw rows for today, so their view is instant.
select cron.schedule(
  'drain-metrics', '* * * * *',
  $$select public.drain_metrics(1000);$$);

-- Nightly reconcile of the last 3 days, so a missed trigger self-heals.
select cron.schedule(
  'reconcile-metrics', '15 3 * * *',
  $$insert into private.metrics_dirty (agent_id, activity_date)
    select a.id, d::date from public.agents a,
      generate_series(current_date - 3, current_date, interval '1 day') d
    on conflict do nothing;$$);

-- P14b: fix ping-notification-drain's cadence.
--
-- P14a scheduled it as a 6-field pg_cron sub-minute schedule
-- ('*/30 * * * * *', "every 30 seconds"). That syntax is accepted without
-- error by cron.schedule() on this project, but Supabase's managed pg_cron
-- scheduler only evaluates jobs at whole-minute boundaries -- the job was
-- registered and marked active, yet never actually fired (confirmed after
-- go-live: zero rows in cron.job_run_details for it, while the pre-existing
-- once-a-minute drain-metrics job kept firing exactly on schedule the whole
-- time). Reschedule it as a standard 5-field, once-a-minute cadence, same
-- shape as every other cron job in this project. cron.schedule() with an
-- existing job name updates that job in place rather than creating a new
-- one, so this doesn't touch enqueue-due-notifications or
-- ping-legacy-notifications.
select cron.schedule(
  'ping-notification-drain', '* * * * *',
  $$select private.ping_notification_drain();$$
);

-- P14a: bulk-load-safe notification delivery pipeline.
--
-- Problem this replaces: the per-agent evening_nudge/sunday_summary/
-- monday_digest path lived entirely inside one HTTP request
-- (src/app/api/cron/notifications/route.ts), triggered by a GitHub Actions
-- schedule (best-effort, can slip by hours under load -- confirmed by a
-- live missed-reminder incident), looping through every candidate agent and
-- `await`ing one Resend HTTP call per recipient. At real scale (thousands
-- of agents clustered in a handful of North American time zones), a single
-- 7pm-local tick can have thousands of people due at once -- a sequential
-- per-recipient loop inside one request would blow past any serverless
-- function's execution-time limit long before finishing, silently dropping
-- everyone after the timeout.
--
-- Fix: split "who's due" (cheap, set-based SQL, can never time out
-- regardless of agent count) from "send it" (bounded per invocation, so
-- more due agents means more invocations, never a longer one). The two
-- halves talk via a queue (pgmq) instead of a shared in-memory loop.
--
-- Scope: only the three per-agent kinds (evening_nudge, sunday_summary,
-- monday_digest) move onto the new queue -- team_roster's auto-reminders
-- (p11a) and the SMD's auto_call_nudges (p12a) keep their existing
-- request-per-tick logic in the same route (src/app/api/cron/
-- notifications/route.ts), unbatched, since both are bounded by a much
-- smaller set (a roster an SMD manually built, or agents explicitly opted
-- into auto-nudging) that will never hit the scale wall this migration
-- solves for. What *does* change for them is the trigger: this migration
-- also retires GitHub Actions entirely (not just for the per-agent kinds)
-- so every scheduled job in this product lives in one place -- Postgres --
-- instead of split across GitHub and Supabase. Both routes' own eligibility
-- windows (window.ts) were separately widened to the same self-healing
-- "any time from the target hour through end of local day" shape, since
-- they're now driven by a different scheduler and it costs nothing to keep
-- them consistent.

create extension if not exists pg_net;
create extension if not exists pgmq;

select pgmq.create('notification_sends');

-- notification_log's insert-first claim (agent_id, kind, local_date unique)
-- is still the rate limit and still means exactly what it always has:
-- "this send has been claimed, don't claim it again today." What changes is
-- *when* the row lands -- now at enqueue time, not confirmed-send time --
-- so `status` distinguishes "claimed, in flight" from "actually delivered."
create type public.notification_send_status as enum ('queued', 'sent', 'failed');
alter table public.notification_log
  add column status public.notification_send_status not null default 'queued',
  add column attempts int not null default 0,
  add column last_error text;

-- ---------------------------------------------------------------------
-- Producer: pure SQL, no HTTP hop, runs on every pg_cron tick regardless of
-- how many of the (eventually thousands of) agents are due -- a filter over
-- an indexed, active-only slice of `agents` costs microseconds no matter
-- the total row count.
--
-- Mirrors the deleted src/lib/notifications/eligibility.ts's agentsDueNow()
-- and window.ts's kindsInWindow(), widened from an exact 15-minute slot to
-- "any time from the target local hour through the end of the local day" --
-- the self-healing counterpart to the trigger-reliability fix below: even
-- if a tick is late or one gets skipped entirely, the next one that does
-- fire still finds and claims anyone still due today, rather than losing
-- that day's reminder for them. monday_digest is capped below 19:00 for
-- the same reason window.ts's own copy is (see that file's doc comment):
-- Monday is the one day two windows could otherwise both be open at once.
-- Role already makes that impossible here (an agent is never both
-- associate and leader/admin), but the cap keeps the two implementations
-- honestly identical rather than relying on that as the only reason.
-- ---------------------------------------------------------------------
create or replace function private.enqueue_due_notifications()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_enqueued int := 0;
  rec record;
begin
  -- A single WITH-chain feeding one statement, iterated by the loop below --
  -- `claimed` (an insert ... returning CTE) only stays in scope for the
  -- query it's defined in, so the claim and the pgmq.send() for each claimed
  -- row have to happen inside that same statement, not two statements
  -- sharing a CTE across a semicolon (which doesn't work).
  for rec in
    with local_now as (
      select
        a.id as agent_id,
        a.role,
        -- Same "unset/invalid -> America/New_York" fallback as resolveTimeZone().
        (now() at time zone coalesce(nullif(a.time_zone, ''), 'America/New_York')) as local_ts
      from public.agents a
      where a.status = 'active'
    ),
    candidates as (
      select
        agent_id, role,
        local_ts::date as local_date,
        case
          when role = 'associate'
               and extract(isodow from local_ts) between 1 and 5
               and extract(hour from local_ts) >= 19
          then 'evening_nudge'
          when role = 'associate'
               and extract(isodow from local_ts) = 7
               and extract(hour from local_ts) >= 18
          then 'sunday_summary'
          when role in ('leader', 'admin')
               and extract(isodow from local_ts) = 1
               and extract(hour from local_ts) >= 8
               and extract(hour from local_ts) < 19
          then 'monday_digest'
          else null
        end as kind
      from local_now
    ),
    eligible as (
      select c.agent_id, c.kind, c.local_date
      from candidates c
      left join public.notification_prefs p on p.agent_id = c.agent_id
      where c.kind is not null
        and case c.kind
              when 'evening_nudge' then coalesce(p.evening_nudge, true)
              when 'sunday_summary' then coalesce(p.sunday_summary, true)
              else coalesce(p.monday_digest, true)
            end
        -- evening_nudge only: skip anyone who already logged activity today --
        -- it's a reminder, not an unconditional summary (agentsDueNow's own
        -- rule, preserved exactly).
        and not (
          c.kind = 'evening_nudge'
          and exists (
            select 1 from public.daily_metrics dm
            where dm.agent_id = c.agent_id
              and dm.activity_date = c.local_date
              and (dm.calls_made > 0 or dm.appts_set > 0 or dm.sales_count > 0 or dm.recruiting_convos > 0)
          )
        )
    ),
    claimed as (
      insert into public.notification_log (agent_id, kind, local_date)
      select agent_id, kind, local_date from eligible
      on conflict (agent_id, kind, local_date) do nothing
      returning agent_id, kind, local_date
    )
    select agent_id, kind, local_date from claimed
  loop
    perform pgmq.send('notification_sends', jsonb_build_object(
      'agent_id', rec.agent_id, 'kind', rec.kind, 'local_date', rec.local_date
    ));
    v_enqueued := v_enqueued + 1;
  end loop;

  return v_enqueued;
end $$;
revoke all on function private.enqueue_due_notifications() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- pgmq's own functions live in the `pgmq` schema, which PostgREST doesn't
-- expose for RPC by default -- these thin wrappers in `public` are the only
-- way the drain route (using the service-role client) can pop/ack messages
-- over supabase-js's .rpc(). Restricted to service_role: nothing about the
-- send queue should be reachable by an ordinary authenticated session.
-- ---------------------------------------------------------------------
create or replace function public.pgmq_read(queue_name text, vt int, qty int)
returns table (msg_id bigint, read_ct int, enqueued_at timestamptz, vt timestamptz, message jsonb)
language sql security definer set search_path = '' as $$
  select msg_id, read_ct, enqueued_at, vt, message from pgmq.read(queue_name, vt, qty);
$$;
revoke all on function public.pgmq_read(text, int, int) from public, anon, authenticated;
grant execute on function public.pgmq_read(text, int, int) to service_role;

create or replace function public.pgmq_delete(queue_name text, msg_id bigint)
returns boolean language sql security definer set search_path = '' as $$
  select pgmq.delete(queue_name, msg_id);
$$;
revoke all on function public.pgmq_delete(text, bigint) from public, anon, authenticated;
grant execute on function public.pgmq_delete(text, bigint) to service_role;

create or replace function public.pgmq_archive(queue_name text, msg_id bigint)
returns boolean language sql security definer set search_path = '' as $$
  select pgmq.archive(queue_name, msg_id);
$$;
revoke all on function public.pgmq_archive(text, bigint) from public, anon, authenticated;
grant execute on function public.pgmq_archive(text, bigint) to service_role;

-- ---------------------------------------------------------------------
-- Trigger reliability: pg_cron instead of GitHub Actions' explicitly
-- best-effort `schedule:` trigger (the root cause of the missed-reminder
-- incident this migration follows from). pg_cron already reliably drives
-- drain-metrics (every minute), reconcile-metrics, and purge-old-call-logs
-- in this project -- this reuses that same proven mechanism rather than
-- adding a new one.
--
-- enqueue-due-notifications: pure SQL, direct function call, no HTTP hop.
-- 5 minutes, not 1 -- the widened "any time from the target local hour
-- through end of local day" eligibility window (see the function above)
-- means precision beyond "within a few minutes of the hour turning over"
-- buys nothing; the once-per-day-per-agent guarantee is enforced by
-- notification_log's unique index regardless of how often this runs.
select cron.schedule(
  'enqueue-due-notifications', '*/5 * * * *',
  $$select private.enqueue_due_notifications();$$
);

-- Both ping functions below share the same two Vault secrets -- one app
-- base URL, one bearer secret -- rather than a URL+secret pair per route,
-- since they're hitting two endpoints on the same deployment with the same
-- auth. Guarded exactly like sendEmail() already is -- no-ops with a notice
-- instead of erroring every tick when the secrets haven't been stored in
-- Vault yet (see this migration's own trailing comment for how). Safe to
-- apply this migration before that manual step is done -- both jobs just
-- no-op harmlessly until then.
create or replace function private.ping_app_route(p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_base_url text;
  v_secret text;
begin
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_base_url is null or v_secret is null or v_base_url = '' or v_secret = '' then
    raise notice '[notifications] app_base_url/cron_secret not configured in Vault -- skipping ping to %', p_path;
    return;
  end if;

  perform net.http_post(
    url := v_base_url || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end $$;
revoke all on function private.ping_app_route(text) from public, anon, authenticated;

-- Every 30 seconds: a bounded batch per tick means more due agents just
-- means more ticks doing useful work, never one tick doing unbounded work.
create or replace function private.ping_notification_drain()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ping_app_route('/api/cron/notifications/drain');
end $$;
revoke all on function private.ping_notification_drain() from public, anon, authenticated;

select cron.schedule(
  'ping-notification-drain', '*/30 * * * * *',
  $$select private.ping_notification_drain();$$
);

-- The GitHub-Actions-triggered route (roster auto-reminders, p11a; SMD
-- auto_call_nudges, p12a) -- unbounded work was never the problem here
-- (both are small, bounded sets), only the trigger reliability was.
-- 5 minutes, matching enqueue-due-notifications: window.ts's own windows
-- for both were widened the same way (see src/lib/notifications/window.ts),
-- so, same as above, precision beyond "within a few minutes" buys nothing.
create or replace function private.ping_legacy_notifications()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.ping_app_route('/api/cron/notifications');
end $$;
revoke all on function private.ping_legacy_notifications() from public, anon, authenticated;

select cron.schedule(
  'ping-legacy-notifications', '*/5 * * * *',
  $$select private.ping_legacy_notifications();$$
);

-- ---------------------------------------------------------------------
-- Manual follow-up required before either ping function actually does
-- anything (run once, interactively, via the SQL editor -- never commit
-- real secret values into a migration file):
--
--   select vault.create_secret('<your deployed app URL, no trailing slash>', 'app_base_url');
--   select vault.create_secret('<same value as the CRON_SECRET Vercel env var>', 'cron_secret');
--
-- Until both exist, ping-notification-drain and ping-legacy-notifications
-- no-op harmlessly on every tick (see private.ping_app_route() above);
-- enqueue-due-notifications keeps claiming + queuing as normal in the
-- meantime -- the queue just accumulates unsent messages until the drain
-- leg is wired up, nothing is lost.
--
-- This migration is also the point where GitHub Actions stops being
-- involved in this product's scheduling at all -- .github/workflows/
-- notifications-cron.yml is deleted in the same change, since pg_cron now
-- triggers every cron-shaped job (daily_metrics' own three jobs already
-- did; these three complete the move).
-- ---------------------------------------------------------------------

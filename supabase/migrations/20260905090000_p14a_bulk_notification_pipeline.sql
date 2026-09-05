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
-- monday_digest) move to this pipeline. team_roster's auto-reminders (p11a)
-- and the SMD's auto_call_nudges (p12a) stay on the existing
-- request-per-tick path in the same route -- both are bounded by a much
-- smaller set (a roster an SMD manually built, or agents explicitly opted
-- into auto-nudging), so they don't hit the same wall this migration is
-- solving, and moving them isn't worth the added complexity yet. Revisit if
-- either grows into the thousands.

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
-- Mirrors kindsInWindow()/agentsDueNow() (src/lib/notifications/{window,
-- eligibility}.ts), but widened from an exact 15-minute slot to "any time
-- from the target local hour through the end of the local day" -- the
-- self-healing counterpart to the trigger-reliability fix below: even if a
-- tick is late or one gets skipped entirely, the next one that does fire
-- still finds and claims anyone still due today, rather than losing that
-- day's reminder for them.
-- ---------------------------------------------------------------------
create or replace function private.enqueue_due_notifications()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_enqueued int := 0;
begin
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
  select count(*) into v_enqueued from claimed;

  perform pgmq.send('notification_sends', jsonb_build_object(
    'agent_id', claimed.agent_id, 'kind', claimed.kind, 'local_date', claimed.local_date
  ))
  from claimed;

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

-- ping-notification-drain: the only step that needs HTTP (composing email
-- HTML and calling Resend's API is application logic, not something worth
-- reimplementing in PL/pgSQL). Guarded exactly like sendEmail() and the
-- GitHub Actions workflow already are -- no-ops with a warning instead of
-- erroring every tick when CRON_TARGET_URL/CRON_SECRET haven't been stored
-- in Vault yet (see this migration's own follow-up notes for how to set
-- those). Safe to apply this migration before that manual step is done.
create or replace function private.ping_notification_drain()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notifications_drain_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notifications_drain_secret';
  if v_url is null or v_secret is null or v_url = '' or v_secret = '' then
    raise notice '[notifications] drain URL/secret not configured in Vault -- skipping ping';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end $$;
revoke all on function private.ping_notification_drain() from public, anon, authenticated;

-- Every 30 seconds: a bounded batch per tick means more due agents just
-- means more ticks doing useful work, never one tick doing unbounded work.
select cron.schedule(
  'ping-notification-drain', '*/30 * * * * *',
  $$select private.ping_notification_drain();$$
);

-- ---------------------------------------------------------------------
-- Manual follow-up required before the drain leg actually does anything
-- (run once, interactively, via the SQL editor -- never commit real secret
-- values into a migration file):
--
--   select vault.create_secret(
--     '<your deployed app URL>/api/cron/notifications/drain',
--     'notifications_drain_url'
--   );
--   select vault.create_secret(
--     '<same value as the existing CRON_SECRET GitHub secret>',
--     'notifications_drain_secret'
--   );
--
-- Until both exist, ping-notification-drain no-ops harmlessly every 30s
-- (see private.ping_notification_drain() above) and enqueue-due-
-- notifications keeps claiming + queuing as normal -- the queue just
-- accumulates unsent messages until the drain leg is wired up, nothing is
-- lost.
-- ---------------------------------------------------------------------

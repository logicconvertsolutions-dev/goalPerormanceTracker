-- P28: stop enqueueing the team cycle digest for admins.
--
-- private.enqueue_due_notifications() has gated monday_digest on
-- `n.role in ('leader', 'admin')` since P14a. An admin has no downline --
-- agent_closure holds only their own depth-0 self row -- so
-- team_period_summary_for() resolves to a one-row "team" consisting of the
-- admin, and composeCycleDigest()'s `roster.length === 0` guard does not
-- fire because the length is 1, not 0. The admin receives a digest of all
-- zeros naming themselves as the only quiet agent, every cycle-start day.
--
-- It is also the one notification nobody can turn off from the app:
-- ROWS_BY_ROLE in src/app/(app)/settings/notification-toggles.tsx maps
-- admin to [], so /settings shows an admin no notification toggles at all.
-- The only way out was the unsubscribe link in the email itself.
--
-- Confirmed in production on 2026-09-22: the sole active admin has a
-- downline of 0 and monday_digest enabled, and did receive the 2026-09-21
-- digest. Every active leader has a real downline (2, 4, 5 and 6), so
-- narrowing this predicate to 'leader' removes exactly the meaningless sends
-- and no useful ones.
--
-- 09-account-and-auth.md has carried this as a known loose end since P14a
-- ("worth fixing by excluding admin from that predicate in a follow-up").
-- This is that follow-up.
--
-- Built from pg_get_functiondef() of the live function, not from
-- 00000000000000_baseline.sql -- see P26's note on why the baseline is not a
-- safe starting point. The two agree here; checking was the point. Only the
-- monday_digest role predicate changes.

CREATE OR REPLACE FUNCTION "private"."enqueue_due_notifications"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_enqueued int := 0;
  rec record;
begin
  for rec in
    with local_now as (
      select
        a.id as agent_id,
        a.role,
        (now() at time zone coalesce(nullif(a.time_zone, ''), 'America/New_York')) as local_ts
      from public.agents a
      where a.status = 'active'
    ),
    candidates as (
      select n.agent_id, n.local_ts::date as local_date, k.kind
      from local_now n
      cross join unnest(array['evening_nudge', 'sunday_summary', 'monday_digest']) as k(kind)
      where
        (k.kind = 'evening_nudge'
         and n.role in ('associate', 'leader')
         and extract(hour from n.local_ts) >= 19)
        or (k.kind = 'sunday_summary'
            and n.role in ('associate', 'leader')
            and extract(hour from n.local_ts) >= 18
            and (
              extract(day from n.local_ts) in (10, 20)
              or n.local_ts::date = (date_trunc('month', n.local_ts) + interval '1 month' - interval '1 day')::date
            ))
        or (k.kind = 'monday_digest'
            -- P28: was `n.role in ('leader', 'admin')`. An admin has no
            -- downline, so their digest is all zeros and unturnoffable.
            and n.role = 'leader'
            and extract(day from n.local_ts) in (1, 11, 21)
            and extract(hour from n.local_ts) >= 8
            and extract(hour from n.local_ts) < 19)
    ),
    eligible as (
      select c.agent_id, c.kind, c.local_date
      from candidates c
      left join public.notification_prefs p on p.agent_id = c.agent_id
      where case c.kind
              when 'evening_nudge' then coalesce(p.evening_nudge, true)
              when 'sunday_summary' then coalesce(p.sunday_summary, true)
              else coalesce(p.monday_digest, true)
            end
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

ALTER FUNCTION "private"."enqueue_due_notifications"() OWNER TO "postgres";

REVOKE ALL ON FUNCTION "private"."enqueue_due_notifications"() FROM PUBLIC, "anon", "authenticated";

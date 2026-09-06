-- P18a: the associate summary and leader digest move from a weekly cadence
-- (Sunday evening / Monday morning) to the 10-day cycle cadence introduced
-- in P16/P17 -- cycle-end evening (day 10, day 20, or the last day of the
-- month) for the summary, cycle-start morning (day 1, 11, or 21) for the
-- digest. Internal identifiers are intentionally NOT renamed here --
-- 'sunday_summary'/'monday_digest' stay the notification_log/
-- notification_prefs/NotificationKind values, only what makes each one fire
-- changes. Renaming those too would need a notification_prefs column
-- migration and care around in-flight unsubscribe links, for no
-- user-visible benefit (the user-facing copy is what actually says
-- "Sunday"/"Monday" today, and that's fixed in P18b's template/label
-- changes instead). evening_nudge is untouched -- it already runs every
-- day (P14c) with no isodow/day-of-month gate at all.
create or replace function private.enqueue_due_notifications()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_enqueued int := 0;
  rec record;
begin
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
      select n.agent_id, n.local_ts::date as local_date, k.kind
      from local_now n
      cross join unnest(array['evening_nudge', 'sunday_summary', 'monday_digest']) as k(kind)
      where
        (k.kind = 'evening_nudge'
         and n.role = 'associate'
         and extract(hour from n.local_ts) >= 19)
        or (k.kind = 'sunday_summary'
            and n.role = 'associate'
            and extract(hour from n.local_ts) >= 18
            and (
              extract(day from n.local_ts) in (10, 20)
              or n.local_ts::date = (date_trunc('month', n.local_ts) + interval '1 month' - interval '1 day')::date
            ))
        or (k.kind = 'monday_digest'
            and n.role in ('leader', 'admin')
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

-- P14c: evening_nudge runs every day of the week, not just Mon-Fri
-- (product decision -- associates who log activity on weekends still get
-- reminded). This means Sunday from 19:00 local can now independently
-- qualify an associate for BOTH evening_nudge and sunday_summary in the
-- same enqueue tick -- a deliberate exception, not a bug: the two serve
-- different purposes (a daily reminder vs. a weekly recap) and each has
-- its own notification_log dedup key (agent_id, kind, local_date), so
-- claiming one never blocks or duplicates the other.
--
-- The old `candidates` CTE used a single CASE expression, which can only
-- ever produce one kind per agent per row -- structurally incompatible
-- with "the same agent can be a candidate for two kinds at once" that this
-- change requires. Replaced with a cross join against the three kinds,
-- each with its own independent condition, so any number of kinds can
-- become separate candidate rows for the same agent.
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
            and extract(isodow from n.local_ts) = 7
            and extract(hour from n.local_ts) >= 18)
        or (k.kind = 'monday_digest'
            and n.role in ('leader', 'admin')
            and extract(isodow from n.local_ts) = 1
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

-- P17b: team_week_summary(p_week_start) and its cron twin
-- (system_team_week_summary/private.team_week_summary_for) hardcode
-- [p_week_start, p_week_start+7) -- a fixed +7 can't express a 10-day cycle,
-- whose third chunk is 8-11 days depending on the month. Both callers move
-- to the already-generalized team_period_summary(p_from, p_to) (added in
-- P7c specifically to handle non-week ranges, same output shape including
-- has_override) -- team/targets/page.tsx directly, and a new service-role
-- cron-facing twin for the digest email path, which had no period-general
-- equivalent yet.

create or replace function private.team_period_summary_for(p_leader_id uuid, p_from date, p_to date)
returns table (
  agent_id uuid, full_name text, depth int,
  calls_made int, appts_set int, appts_held int, premium_cents bigint,
  calls_target int, appts_held_target int, premium_cents_target bigint,
  pct_calls numeric, streak_days int, last_logged_at timestamptz,
  has_override boolean
) language sql stable security definer set search_path = '' as $$
  with scope as (
    select c.descendant_id id, c.depth
    from public.agent_closure c
    where c.ancestor_id = p_leader_id
  ), agg as (
    select m.agent_id,
           sum(m.calls_made)::int calls, sum(m.appts_set)::int aset,
           sum(m.appt_held)::int aheld, sum(m.premium_cents)::bigint prem,
           max(m.updated_at) last_at
    from public.daily_metrics m
    join scope s on s.id = m.agent_id
    where m.activity_date >= p_from
      and m.activity_date <= p_to
    group by m.agent_id
  ), cycles as (
    select greatest(1.0, (p_to - p_from + 1) / 10.0) as n
  )
  select a.id, a.full_name, s.depth,
         coalesce(g.calls,0), coalesce(g.aset,0), coalesce(g.aheld,0), coalesce(g.prem,0),
         round(t.calls_per_cycle * c.n)::int,
         round(t.appts_held_per_cycle * c.n)::int,
         round(t.premium_cents_per_cycle * c.n)::bigint,
         round(100.0 * coalesce(g.calls,0) / nullif(round(t.calls_per_cycle * c.n), 0), 1),
         (select count(*)::int from public.daily_metrics d
          where d.agent_id = a.id and d.activity_date <= p_to
            and d.calls_made >= t.min_calls_per_day),
         g.last_at,
         exists (
           select 1 from public.targets ov
           where ov.agent_id = a.id and ov.effective_from <= p_from
         )
  from scope s
  join public.agents a on a.id = s.id and a.status = 'active'
  left join agg g on g.agent_id = a.id
  cross join cycles c
  cross join lateral private.effective_target(a.id, p_from) t;
$$;

create or replace function public.system_team_period_summary(p_leader_id uuid, p_from date, p_to date)
returns table (
  agent_id uuid, full_name text, depth int,
  calls_made int, appts_set int, appts_held int, premium_cents bigint,
  calls_target int, appts_held_target int, premium_cents_target bigint,
  pct_calls numeric, streak_days int, last_logged_at timestamptz,
  has_override boolean
) language sql stable security definer set search_path = '' as $$
  select * from private.team_period_summary_for(p_leader_id, p_from, p_to);
$$;
revoke all on function public.system_team_period_summary(uuid, date, date) from public, anon, authenticated;
grant execute on function public.system_team_period_summary(uuid, date, date) to service_role;

-- Now unreachable -- team/targets/page.tsx and the digest email path both
-- moved to the period-general RPCs above.
drop function if exists public.team_week_summary(date);
drop function if exists public.system_team_week_summary(uuid, date);
drop function if exists private.team_week_summary_for(uuid, date);

-- agent_daily_activity resolves each day's target against *that day's*
-- period -- swap the week lookup for the cycle one.
create or replace function public.agent_daily_activity(
  p_agent_id uuid, p_from date, p_to date)
returns table (
  activity_date date, calls_made int, appts_set int, appts_held int,
  premium_cents bigint, min_calls_target int, min_met boolean
) language sql stable security definer set search_path = '' as $$
  select d::date,
         coalesce(m.calls_made,0), coalesce(m.appts_set,0), coalesce(m.appt_held,0),
         coalesce(m.premium_cents,0), t.min_calls_per_day,
         coalesce(m.calls_made,0) >= t.min_calls_per_day
  from generate_series(p_from, p_to, interval '1 day') d
  left join public.daily_metrics m
    on m.agent_id = p_agent_id and m.activity_date = d::date
  cross join lateral private.effective_target(p_agent_id, public.cycle_start(d::date)) t
  where (select private.is_upline_of(p_agent_id))
  order by d;
$$;

-- team_trend stays an 8-*week* chart by product decision (a separate,
-- longer-range historical view, out of scope for the cycle-cadence change)
-- -- but its calls_target column sums the now-renamed calls_per_cycle
-- (10-day-sized) directly into a weekly bucket, which would silently
-- overstate a week's goal line by ~40%. Convert it back to a
-- weekly-equivalent number for display here, same fix as the dashboard's
-- own trend chart (dashboard-view-model.ts).
create or replace function public.team_trend(p_weeks int default 8, p_agent_ids uuid[] default null)
returns table (week_start date, calls_made bigint, premium_cents bigint,
               calls_target bigint)
language sql stable security definer set search_path = '' as $$
  with scope as (
    select descendant_id id from public.agent_closure
    where ancestor_id = (select auth.uid())
      and (p_agent_ids is null or descendant_id = any(p_agent_ids))
  ), weeks as (
    select public.week_start(current_date) - (7 * n) as ws
    from generate_series(0, p_weeks - 1) n
  )
  select w.ws,
         coalesce(sum(m.calls_made),0)::bigint,
         coalesce(sum(m.premium_cents),0)::bigint,
         coalesce(round((select sum(t.calls_per_cycle) from scope s
                   cross join lateral private.effective_target(s.id, w.ws) t)::numeric * 7 / 10), 0)::bigint
  from weeks w
  left join public.daily_metrics m
    on m.agent_id in (select id from scope)
   and m.activity_date >= w.ws and m.activity_date < w.ws + 7
  group by w.ws
  order by w.ws;
$$;

-- P7c: fixes a real bug on /team (Summary view) and its CSV export --
-- both call team_week_summary(p_week_start), which is hardcoded to exactly
-- the 7 days [p_week_start, p_week_start+7). Selecting "This Month" (or
-- "Last 30 Days") on the FilterBar still only ever showed one week's
-- actuals AND one week's target, mislabeled as the selected period -- the
-- donut/bar charts (team_breakdown) and trend chart already used the full
-- range correctly, so this was the one piece of /team stuck on a single
-- week. team_week_summary itself is left alone: team/targets/page.tsx uses
-- it deliberately for "this week's" editable target row, and
-- system_team_week_summary (the Monday digest email) is unrelated.
--
-- team_period_summary generalizes it to an arbitrary [p_from, p_to] range,
-- scaling the per-agent weekly target by the number of weeks spanned (same
-- auto-derive policy as the dashboard's per-agent fix) so a month's totals
-- are compared against a monthly-equivalent target instead of one week's.
create or replace function public.team_period_summary(p_from date, p_to date)
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
    where c.ancestor_id = (select auth.uid())
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
  ), weeks as (
    select greatest(1.0, (p_to - p_from + 1) / 7.0) as n
  )
  select a.id, a.full_name, s.depth,
         coalesce(g.calls,0), coalesce(g.aset,0), coalesce(g.aheld,0), coalesce(g.prem,0),
         round(t.calls_per_week * w.n)::int,
         round(t.appts_held_per_week * w.n)::int,
         round(t.premium_cents_per_week * w.n)::bigint,
         round(100.0 * coalesce(g.calls,0) / nullif(round(t.calls_per_week * w.n), 0), 1),
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
  cross join weeks w
  cross join lateral private.effective_target(a.id, p_from) t
  order by round(100.0 * coalesce(g.calls,0) / nullif(round(t.calls_per_week * w.n), 0), 1) asc nulls first;
$$;
revoke all on function public.team_period_summary(date, date) from public, anon;
grant execute on function public.team_period_summary(date, date) to authenticated;

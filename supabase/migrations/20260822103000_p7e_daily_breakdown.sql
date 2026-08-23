-- P7e: new "Daily" activity table -- Date | Calls | Appts Set | Appts Held |
-- Recruits | Sales, calendar-month filterable, with an associate filter for
-- an SMD. One RPC serves both /dashboard (an agent's own numbers) and
-- /team (an SMD's, optionally filtered to a subset of their downline): an
-- associate has no descendants, so p_agent_ids stays effectively "self" for
-- them without a separate code path. Same generate_series-left-join shape
-- as agent_daily_activity (p1i) so days with no activity still get a zero
-- row, and the same p_agent_ids-intersected-with-downline shape as
-- team_breakdown (p5d) so a filter can only narrow scope, never widen it.
create or replace function public.agent_daily_breakdown(
  p_from date, p_to date, p_agent_ids uuid[] default null
)
returns table (
  activity_date date, calls_made int, appts_set int, appt_held int,
  recruiting_convos int, sales_count int
) language sql stable security definer set search_path = '' as $$
  select d::date,
         coalesce(sum(m.calls_made), 0)::int,
         coalesce(sum(m.appts_set), 0)::int,
         coalesce(sum(m.appt_held), 0)::int,
         coalesce(sum(m.recruiting_convos), 0)::int,
         coalesce(sum(m.sales_count), 0)::int
  from generate_series(p_from, p_to, interval '1 day') d
  left join public.daily_metrics m
    on m.activity_date = d::date
   and m.agent_id in (select private.my_downline())
   and (p_agent_ids is null or m.agent_id = any(p_agent_ids))
  group by d
  order by d;
$$;
revoke all on function public.agent_daily_breakdown(date, date, uuid[]) from public, anon;
grant execute on function public.agent_daily_breakdown(date, date, uuid[]) to authenticated;

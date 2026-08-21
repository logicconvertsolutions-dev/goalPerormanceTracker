-- Same gap as team_breakdown: team_trend always summed the whole downline,
-- so the 8-Week Team Trend chart on /team didn't respect the agent
-- multi-select filter either.
drop function if exists public.team_trend(int);
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
         coalesce((select sum(t.calls_per_week) from scope s
                   cross join lateral private.effective_target(s.id, w.ws) t), 0)::bigint
  from weeks w
  left join public.daily_metrics m
    on m.agent_id in (select id from scope)
   and m.activity_date >= w.ws and m.activity_date < w.ws + 7
  group by w.ws
  order by w.ws;
$$;
revoke all on function public.team_trend(int, uuid[]) from public, anon;
grant execute on function public.team_trend(int, uuid[]) to authenticated;

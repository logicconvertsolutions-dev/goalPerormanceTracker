-- P19a: public.team_period_summary (the RPC /team, /team/targets, and the
-- CSV export all call for the leader's roster) was missed by P17's targets
-- rename. private.effective_target's return row lost its *_per_week
-- columns in favor of *_per_cycle (20260906091000_p17a), and P17b
-- (20260906092000) updated every other consumer -- private.
-- team_period_summary_for, agent_daily_activity, team_trend -- but not this
-- one, even though its own header comment says the intent was to move
-- team/targets/page.tsx and the digest path onto "the already-generalized
-- team_period_summary(p_from, p_to)". Left stale, every call to this
-- function raises 42703 (column t.calls_per_week does not exist), which
-- supabase-js surfaces as { data: null, error }; /team's page only reads
-- `data`, so the error silently renders as "No one in your downline yet"
-- for every leader, regardless of actual roster size.
--
-- Fix: rename the three column references to match effective_target's
-- current shape, and switch the weekly scaling factor to the 10-day cycle
-- divisor already used by private.team_period_summary_for (P17b) instead of
-- the stale /7.0 week divisor.
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
  cross join lateral private.effective_target(a.id, p_from) t
  order by round(100.0 * coalesce(g.calls,0) / nullif(round(t.calls_per_cycle * c.n), 0), 1) asc nulls first;
$$;
revoke all on function public.team_period_summary(date, date) from public, anon;
grant execute on function public.team_period_summary(date, date) to authenticated;

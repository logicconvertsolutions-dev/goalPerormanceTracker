-- P17a: Goals move from a weekly cadence to the 10-day cycle (day 1-10,
-- 11-20, 21-end-of-month) introduced in P16. Column rename only -- existing
-- rows keep their historical numbers verbatim (CLAUDE.md rule 8: never
-- mutate a past target row), so a past week is still scored against
-- whatever number was live then; only targets inserted after this ships
-- carry numbers actually sized for 10 days.
alter table public.targets rename column calls_per_week to calls_per_cycle;
alter table public.targets rename column appts_held_per_week to appts_held_per_cycle;
alter table public.targets rename column premium_cents_per_week to premium_cents_per_cycle;
-- min_calls_per_day is unchanged -- already a daily figure, not a weekly
-- one, and currentStreak (lib/metrics.ts) is day-by-day already.

-- private.effective_target() itself has zero week-specific logic -- it just
-- resolves "the most recent target row with effective_from <= the given
-- date," agent override first, then org default, then hardcoded fallback.
-- Only the column names it selects change, and the misleading `p_week` name
-- (it was already just "a date," never anything week-specific) becomes
-- `p_period_start` now that callers pass a cycle-start date. Parameter
-- renames don't change the function's (uuid, date) signature, so this is a
-- plain create-or-replace, no drop needed.
create or replace function private.effective_target(p_agent_id uuid, p_period_start date)
returns table (
  calls_per_cycle int, appts_held_per_cycle int,
  premium_cents_per_cycle bigint, min_calls_per_day int, md_deadline date
) language sql stable security definer set search_path = '' as $$
  with a as (
    select t.* from public.targets t
    where t.agent_id = p_agent_id and t.effective_from <= p_period_start
    order by t.effective_from desc limit 1
  ), o as (
    select t.* from public.targets t
    where t.agent_id is null
      and t.org_id = (select ag.org_id from public.agents ag where ag.id = p_agent_id)
      and t.effective_from <= p_period_start
    order by t.effective_from desc limit 1
  )
  select
    coalesce((select a.calls_per_cycle from a),        (select o.calls_per_cycle from o),        50),
    coalesce((select a.appts_held_per_cycle from a),   (select o.appts_held_per_cycle from o),   3),
    coalesce((select a.premium_cents_per_cycle from a),(select o.premium_cents_per_cycle from o),18800::bigint),
    coalesce((select a.min_calls_per_day from a),      (select o.min_calls_per_day from o),      15),
    coalesce((select a.md_deadline from a),            (select o.md_deadline from o),            null);
$$;

create or replace function public.my_target(p_period_start date)
returns table (
  calls_per_cycle int, appts_held_per_cycle int,
  premium_cents_per_cycle bigint, min_calls_per_day int, md_deadline date
) language sql stable security definer set search_path = '' as $$
  select * from private.effective_target((select auth.uid()), p_period_start);
$$;
revoke all on function public.my_target(date) from public, anon;
grant execute on function public.my_target(date) to authenticated;

create or replace function public.team_target(p_agent_id uuid, p_period_start date)
returns table (
  calls_per_cycle int, appts_held_per_cycle int,
  premium_cents_per_cycle bigint, min_calls_per_day int, md_deadline date
) language sql stable security definer set search_path = '' as $$
  select * from private.effective_target(p_agent_id, p_period_start)
  where (select private.is_upline_of(p_agent_id));
$$;
revoke all on function public.team_target(uuid, date) from public, anon;
grant execute on function public.team_target(uuid, date) to authenticated;

create or replace function public.system_effective_target(p_agent_id uuid, p_period_start date)
returns table (
  calls_per_cycle int, appts_held_per_cycle int,
  premium_cents_per_cycle bigint, min_calls_per_day int, md_deadline date
) language sql stable security definer set search_path = '' as $$
  select * from private.effective_target(p_agent_id, p_period_start);
$$;
revoke all on function public.system_effective_target(uuid, date) from public, anon, authenticated;
grant execute on function public.system_effective_target(uuid, date) to service_role;

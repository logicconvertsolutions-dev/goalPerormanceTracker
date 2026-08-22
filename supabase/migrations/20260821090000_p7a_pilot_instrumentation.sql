-- P7: pilot instrumentation. 06-build-phases.md's whole engineering ask for
-- this phase: "Instrument daily active loggers, not signups. If fewer than
-- 2 of 3 log on 8 of 10 working days, the problem is the logging flow --
-- fix P3, do not build features." Everything else in P7 (recruiting the
-- pilot, running it for two weeks, deciding pass/fail) is Deepak's job, not
-- a migration's.
--
-- "Logged" means any of the four activity types that day, same definition
-- the notifications cron uses for "did this agent log anything today"
-- (src/app/api/cron/notifications/route.ts). Working days = weekdays,
-- matching the spec's own "10 working days" framing -- weekends are never
-- counted against anyone.
create or replace function public.admin_daily_active_loggers(p_days int default 10)
returns table (
  org_id uuid, org_name text, agent_id uuid, full_name text,
  activity_date date, logged boolean
) language sql stable security definer set search_path = '' as $$
  with business_days as (
    select d::date as activity_date
    from generate_series(current_date - (p_days * 2 + 14), current_date, interval '1 day') d
    where extract(isodow from d) < 6
    order by d desc
    limit p_days
  ),
  active_agents as (
    select a.id, a.full_name, a.org_id, o.name as org_name
    from public.agents a
    join public.organizations o on o.id = a.org_id
    where a.status = 'active'
  )
  select aa.org_id, aa.org_name, aa.id, aa.full_name, bd.activity_date,
    exists (
      select 1 from public.daily_metrics m
      where m.agent_id = aa.id and m.activity_date = bd.activity_date
        and (m.calls_made > 0 or m.appts_set > 0 or m.sales_count > 0 or m.recruiting_convos > 0)
    ) as logged
  from active_agents aa
  cross join business_days bd
  order by aa.org_name, aa.full_name, bd.activity_date;
$$;
revoke all on function public.admin_daily_active_loggers(int) from public, anon, authenticated;
grant execute on function public.admin_daily_active_loggers(int) to service_role;

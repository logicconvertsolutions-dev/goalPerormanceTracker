-- Every one is SECURITY DEFINER with an empty search_path and fully-qualified
-- names, or it is a privilege-escalation vector via a shadowed table.

create or replace function private.my_org()
returns uuid language sql stable security definer set search_path = '' as $$
  select a.org_id from public.agents a where a.id = (select auth.uid());
$$;

create or replace function private.my_role()
returns public.agent_role language sql stable security definer set search_path = '' as $$
  select a.role from public.agents a where a.id = (select auth.uid());
$$;

-- True for self (depth 0) and for anyone in the caller's downline.
create or replace function private.is_upline_of(target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.agent_closure c
    where c.ancestor_id = (select auth.uid())
      and c.descendant_id = target
  );
$$;

create or replace function private.my_downline()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select c.descendant_id from public.agent_closure c
  where c.ancestor_id = (select auth.uid());
$$;

-- Monday-start week. Every date calculation goes through this.
create or replace function public.week_start(d date)
returns date language sql immutable set search_path = '' as $$
  select (d - ((extract(isodow from d)::int - 1)))::date;
$$;

-- Single resolution path for targets: agent override > org default > fallback.
-- Resolving this in two places is how a dashboard and a roster end up
-- disagreeing about the same week.
create or replace function private.effective_target(p_agent_id uuid, p_week date)
returns table (
  calls_per_week int, appts_held_per_week int,
  premium_cents_per_week bigint, min_calls_per_day int, md_deadline date
) language sql stable security definer set search_path = '' as $$
  with a as (
    select t.* from public.targets t
    where t.agent_id = p_agent_id and t.effective_from <= p_week
    order by t.effective_from desc limit 1
  ), o as (
    select t.* from public.targets t
    where t.agent_id is null
      and t.org_id = (select ag.org_id from public.agents ag where ag.id = p_agent_id)
      and t.effective_from <= p_week
    order by t.effective_from desc limit 1
  )
  select
    coalesce((select a.calls_per_week from a),        (select o.calls_per_week from o),        50),
    coalesce((select a.appts_held_per_week from a),   (select o.appts_held_per_week from o),   3),
    coalesce((select a.premium_cents_per_week from a),(select o.premium_cents_per_week from o),18800::bigint),
    coalesce((select a.min_calls_per_day from a),     (select o.min_calls_per_day from o),     15),
    coalesce((select a.md_deadline from a),           (select o.md_deadline from o),           null);
$$;

grant usage on schema private to postgres;

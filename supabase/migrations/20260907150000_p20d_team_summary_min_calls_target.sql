-- P20d: expose each agent's own resolved min-calls-per-day target on the
-- team roster RPCs.
--
-- Bug: /team/targets ("Goals") showed "Min Calls / Day" for the SMD's own
-- card and every per-agent override card by reading the org default row
-- directly (defaultTarget.min_calls_per_day) instead of that agent's own
-- resolved target -- because neither public.team_period_summary nor
-- private.team_period_summary_for returned a per-agent value for it at all.
-- Every other field (calls/appts/premium target) already came from these
-- RPCs correctly; min_calls_per_day was the one metric missing from their
-- output. Effect: changing the org default's min-calls number appeared to
-- change it for every agent at once, even agents with their own override,
-- because the page had no per-agent source to show instead.
--
-- Fix: add a `min_calls_target` column (naming matches the existing
-- convention in public.agent_daily_activity) sourced from the same
-- `cross join lateral private.effective_target(a.id, p_from) t` these
-- functions already compute per agent -- t.min_calls_per_day was already
-- being read internally (for the streak_days subquery) but never selected
-- into the output row.
--
-- Postgres cannot change a function's OUT column list via CREATE OR
-- REPLACE, so the three affected functions are dropped and recreated in
-- dependency order: system_team_period_summary (public) wraps
-- team_period_summary_for (private) via `select *`, so it must be dropped
-- first and recreated after. team_period_summary (public) has its own
-- inline query and no dependents, but is included for the same column
-- addition and is dropped/recreated for consistency.

drop function if exists "public"."system_team_period_summary"("p_leader_id" "uuid", "p_from" "date", "p_to" "date");
drop function if exists "private"."team_period_summary_for"("p_leader_id" "uuid", "p_from" "date", "p_to" "date");
drop function if exists "public"."team_period_summary"("p_from" "date", "p_to" "date");

CREATE FUNCTION "private"."team_period_summary_for"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") RETURNS TABLE("agent_id" "uuid", "full_name" "text", "depth" integer, "calls_made" integer, "appts_set" integer, "appts_held" integer, "premium_cents" bigint, "calls_target" integer, "appts_held_target" integer, "premium_cents_target" bigint, "min_calls_target" integer, "pct_calls" numeric, "streak_days" integer, "last_logged_at" timestamp with time zone, "has_override" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
         t.min_calls_per_day,
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

ALTER FUNCTION "private"."team_period_summary_for"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";

CREATE FUNCTION "public"."team_period_summary"("p_from" "date", "p_to" "date") RETURNS TABLE("agent_id" "uuid", "full_name" "text", "depth" integer, "calls_made" integer, "appts_set" integer, "appts_held" integer, "premium_cents" bigint, "calls_target" integer, "appts_held_target" integer, "premium_cents_target" bigint, "min_calls_target" integer, "pct_calls" numeric, "streak_days" integer, "last_logged_at" timestamp with time zone, "has_override" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
         t.min_calls_per_day,
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

ALTER FUNCTION "public"."team_period_summary"("p_from" "date", "p_to" "date") OWNER TO "postgres";

CREATE FUNCTION "public"."system_team_period_summary"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") RETURNS TABLE("agent_id" "uuid", "full_name" "text", "depth" integer, "calls_made" integer, "appts_set" integer, "appts_held" integer, "premium_cents" bigint, "calls_target" integer, "appts_held_target" integer, "premium_cents_target" bigint, "min_calls_target" integer, "pct_calls" numeric, "streak_days" integer, "last_logged_at" timestamp with time zone, "has_override" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select * from private.team_period_summary_for(p_leader_id, p_from, p_to);
$$;

ALTER FUNCTION "public"."system_team_period_summary"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";

-- DROP FUNCTION discards prior grants; restore them exactly as before,
-- naming anon/authenticated explicitly per CLAUDE.md rule 4 rather than
-- relying on a bare REVOKE ... FROM PUBLIC.
REVOKE ALL ON FUNCTION "public"."team_period_summary"("p_from" "date", "p_to" "date") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."team_period_summary"("p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."team_period_summary"("p_from" "date", "p_to" "date") TO "service_role";

REVOKE ALL ON FUNCTION "public"."system_team_period_summary"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."system_team_period_summary"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";

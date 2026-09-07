-- New org default goal values (per-cycle, 10-day cycle): Calls 50 -> 72,
-- Appointments Held 3 -> 24, Premium $188.00 -> $250.00, and Min Calls/Day
-- 15 -> 7 (72 calls-per-cycle / 10-day cycle, rounded).
--
-- These numbers are the fallback used when an org has no targets row yet
-- (provision_org deliberately doesn't insert one -- "org default is created
-- by the SMD on first login") and, once a targets row does exist, the
-- table-column defaults for any insert that doesn't specify a value.
-- private.effective_target()'s own COALESCE literals are the ones that
-- actually govern a brand-new org in practice; the table defaults are kept
-- in sync as a second, direct-insert safety net (same two-fences spirit as
-- every other org_id/hierarchy check in this schema).

ALTER TABLE "public"."targets"
  ALTER COLUMN "calls_per_cycle" SET DEFAULT 72,
  ALTER COLUMN "appts_held_per_cycle" SET DEFAULT 24,
  ALTER COLUMN "premium_cents_per_cycle" SET DEFAULT 25000,
  ALTER COLUMN "min_calls_per_day" SET DEFAULT 7;

CREATE OR REPLACE FUNCTION "private"."effective_target"("p_agent_id" "uuid", "p_period_start" "date") RETURNS TABLE("calls_per_cycle" integer, "appts_held_per_cycle" integer, "premium_cents_per_cycle" bigint, "min_calls_per_day" integer, "md_deadline" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
    coalesce((select a.calls_per_cycle from a),        (select o.calls_per_cycle from o),        72),
    coalesce((select a.appts_held_per_cycle from a),   (select o.appts_held_per_cycle from o),   24),
    coalesce((select a.premium_cents_per_cycle from a),(select o.premium_cents_per_cycle from o),25000::bigint),
    coalesce((select a.min_calls_per_day from a),      (select o.min_calls_per_day from o),      7),
    coalesce((select a.md_deadline from a),            (select o.md_deadline from o),            null);
$$;

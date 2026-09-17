-- P22: Admin Reports tab.
--
-- Renumbered from P21 to P22 -- 20260917100000_p21a_admin_org_roster.sql
-- (unrelated work: admin adding roster members from /admin/orgs/[orgId])
-- landed on dev/master under the P21 label and the exact same leading
-- timestamp this migration originally used, while this branch was still
-- based on an older commit. Two migration files sharing one leading
-- timestamp would collide in supabase_migrations.schema_migrations (the
-- timestamp *is* the version), so this file was renamed to a later
-- timestamp after merging dev in, rather than picking a fresh P21 that's
-- already spoken for.
--
-- Admin gets a curated set of cross-org report types (Agent Roster, Org
-- Summary, Activity Summary, Targets vs Actuals) instead of a generic
-- object/join builder -- CLAUDE.md rule 2 forbids exposing raw activity
-- tables (contacts/call_logs/appointments/sales/recruiting_logs) to a
-- cross-agent reader at all, and rule 10 requires dashboards to read
-- daily_metrics, never raw tables. Agent Roster and Org Summary read
-- public.agents/public.organizations directly -- already safe for admin via
-- the existing agents_admin_read/organizations_admin_read RLS policies
-- (00000000000000_baseline.sql), no new grant needed there. Activity
-- Summary and Targets vs Actuals need cross-agent daily_metrics/targets
-- reads that no existing RLS policy allows (daily_metrics' only policy is
-- "own rows" and targets' policies are leader-of-downline-scoped), so this
-- adds two new SECURITY DEFINER RPCs for those two report types.
--
-- Both RPCs follow the same access-control shape as
-- public.admin_daily_active_loggers (P7, see supabase/tests/004_pilot_...):
-- EXECUTE is granted to service_role only, never to anon/authenticated, so
-- there is no internal role check to get wrong -- the DB simply refuses
-- any call that didn't come through createAdminClient() from a page/action
-- already gated by requireAdmin(). This is deliberately the same pattern
-- as admin_daily_active_loggers rather than agent_aggregate/
-- team_period_summary's "grant to authenticated, self-scope by auth.uid()"
-- shape, because these two functions are cross-org by design and have no
-- caller-identity column to self-scope by.
--
-- admin_targets_vs_actuals copies team_period_summary's target-scaling
-- query shape (supabase/migrations/20260907150000_p20d_...sql) -- same
-- effective_target() lookup, same cycle scaling, same min_calls_target/
-- pct_calls/streak_days columns -- minus its agent_closure-based downline
-- scope, replaced with an optional org filter and role <> 'admin' (admin
-- accounts have no org, so effective_target() would only ever return the
-- global hardcoded defaults for them, which isn't a target vs. actual
-- comparison worth showing).

CREATE OR REPLACE FUNCTION "public"."admin_activity_report"(
    "p_from" "date",
    "p_to" "date",
    "p_org_id" "uuid" DEFAULT NULL
) RETURNS TABLE(
    "agent_id" "uuid",
    "full_name" "text",
    "org_id" "uuid",
    "org_name" "text",
    "role" "public"."agent_role",
    "calls_made" integer,
    "appts_set" integer,
    "appts_held" integer,
    "sales_count" integer,
    "premium_cents" bigint
)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with agg as (
    select m.agent_id,
           sum(m.calls_made)::int calls,
           sum(m.appts_set)::int aset,
           sum(m.appt_held)::int aheld,
           sum(m.sales_count)::int sales,
           sum(m.premium_cents)::bigint prem
    from public.daily_metrics m
    where m.activity_date >= p_from
      and m.activity_date <= p_to
    group by m.agent_id
  )
  select a.id, a.full_name, a.org_id, o.name, a.role,
         coalesce(g.calls, 0), coalesce(g.aset, 0), coalesce(g.aheld, 0),
         coalesce(g.sales, 0), coalesce(g.prem, 0)
  from public.agents a
  left join public.organizations o on o.id = a.org_id
  left join agg g on g.agent_id = a.id
  where a.status = 'active'
    and a.role <> 'admin'
    and (p_org_id is null or a.org_id = p_org_id)
  order by o.name nulls last, a.full_name;
$$;

ALTER FUNCTION "public"."admin_activity_report"("p_from" "date", "p_to" "date", "p_org_id" "uuid") OWNER TO "postgres";

CREATE OR REPLACE FUNCTION "public"."admin_targets_vs_actuals"(
    "p_from" "date",
    "p_to" "date",
    "p_org_id" "uuid" DEFAULT NULL
) RETURNS TABLE(
    "agent_id" "uuid",
    "full_name" "text",
    "org_id" "uuid",
    "org_name" "text",
    "calls_made" integer,
    "appts_set" integer,
    "appts_held" integer,
    "premium_cents" bigint,
    "calls_target" integer,
    "appts_held_target" integer,
    "premium_cents_target" bigint,
    "min_calls_target" integer,
    "pct_calls" numeric,
    "streak_days" integer,
    "has_override" boolean
)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with agg as (
    select m.agent_id,
           sum(m.calls_made)::int calls,
           sum(m.appts_set)::int aset,
           sum(m.appt_held)::int aheld,
           sum(m.premium_cents)::bigint prem
    from public.daily_metrics m
    where m.activity_date >= p_from
      and m.activity_date <= p_to
    group by m.agent_id
  ), cycles as (
    select greatest(1.0, (p_to - p_from + 1) / 10.0) as n
  )
  select a.id, a.full_name, a.org_id, o.name,
         coalesce(g.calls, 0), coalesce(g.aset, 0), coalesce(g.aheld, 0), coalesce(g.prem, 0),
         round(t.calls_per_cycle * c.n)::int,
         round(t.appts_held_per_cycle * c.n)::int,
         round(t.premium_cents_per_cycle * c.n)::bigint,
         t.min_calls_per_day,
         round(100.0 * coalesce(g.calls, 0) / nullif(round(t.calls_per_cycle * c.n), 0), 1),
         (select count(*)::int from public.daily_metrics d
          where d.agent_id = a.id and d.activity_date <= p_to
            and d.calls_made >= t.min_calls_per_day),
         exists (
           select 1 from public.targets ov
           where ov.agent_id = a.id and ov.effective_from <= p_from
         )
  from public.agents a
  left join public.organizations o on o.id = a.org_id
  left join agg g on g.agent_id = a.id
  cross join cycles c
  cross join lateral private.effective_target(a.id, p_from) t
  where a.status = 'active'
    and a.role <> 'admin'
    and (p_org_id is null or a.org_id = p_org_id)
  order by o.name nulls last, a.full_name;
$$;

ALTER FUNCTION "public"."admin_targets_vs_actuals"("p_from" "date", "p_to" "date", "p_org_id" "uuid") OWNER TO "postgres";

-- Service-role only, same as admin_daily_active_loggers -- name anon and
-- authenticated explicitly per CLAUDE.md rule 4, never rely on a bare
-- REVOKE ... FROM PUBLIC.
REVOKE ALL ON FUNCTION "public"."admin_activity_report"("p_from" "date", "p_to" "date", "p_org_id" "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."admin_activity_report"("p_from" "date", "p_to" "date", "p_org_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_targets_vs_actuals"("p_from" "date", "p_to" "date", "p_org_id" "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."admin_targets_vs_actuals"("p_from" "date", "p_to" "date", "p_org_id" "uuid") TO "service_role";

-- Saved report configurations (the object/filter/column picks), never raw
-- report rows -- re-run against live data on load. Shared across every
-- admin account, same trust model as the rest of /admin/*.
CREATE TABLE IF NOT EXISTS "public"."report_definitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "report_type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "filters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "columns" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "report_definitions_report_type_check" CHECK (
        "report_type" = ANY (ARRAY['agent_roster', 'org_summary', 'activity_summary', 'targets_vs_actuals'])
    ),
    CONSTRAINT "report_definitions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."agents"("id") ON DELETE CASCADE
);

ALTER TABLE "public"."report_definitions" OWNER TO "postgres";
ALTER TABLE "public"."report_definitions" ENABLE ROW LEVEL SECURITY;

-- One admin-only policy, matching the rest of /admin/*'s "any admin can see
-- any admin-owned row" trust model (e.g. organizations_admin_read).
CREATE POLICY "report_definitions_admin_all" ON "public"."report_definitions" TO "authenticated"
    USING ((( SELECT "private"."my_role"() AS "my_role") = 'admin'::"public"."agent_role"))
    WITH CHECK ((( SELECT "private"."my_role"() AS "my_role") = 'admin'::"public"."agent_role"));

GRANT ALL ON TABLE "public"."report_definitions" TO "anon";
GRANT ALL ON TABLE "public"."report_definitions" TO "authenticated";
GRANT ALL ON TABLE "public"."report_definitions" TO "service_role";

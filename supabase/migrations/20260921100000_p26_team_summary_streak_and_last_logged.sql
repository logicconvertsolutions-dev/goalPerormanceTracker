-- P26: private.team_period_summary_for() returned two columns that did not
-- mean what their names said. Both fed /team, the team CSV export, the
-- reports builder and the SMD cycle digest email.
--
-- 1. streak_days was a LIFETIME COUNT, not a streak:
--
--      (select count(*) from public.daily_metrics d
--       where d.agent_id = a.id and d.activity_date <= p_to
--         and d.calls_made >= t.min_calls_per_day)
--
--    No consecutiveness, no anchor to p_to. A real agent whose qualifying
--    days were Sep 6, Sep 7 and Sep 19 was shown as being on a "3d streak"
--    on Sep 20, having logged nothing qualifying for the previous day.
--    The number only ever grew, so it never once reported a broken streak.
--    It now counts the consecutive run of qualifying days ending exactly at
--    p_to, which is what currentStreak() in src/lib/metrics.ts (the evening
--    nudge's own streak) has always computed -- the two disagreed on every
--    row. Same "both sides must agree" convention as cycle_start/week_start.
--
-- 2. last_logged_at was max(daily_metrics.updated_at) -- the last time the
--    read model was RECOMPUTED, not the last time the agent logged anything.
--    The reconcile-metrics cron re-marks the last 3 days dirty every night,
--    so updated_at kept moving for agents who had done nothing at all, and
--    /team's "Quiet" badge (isQuiet(), roster-row.tsx) could effectively
--    never fire. It is now the last activity_date in the window carrying
--    any non-zero counter, cast to midnight UTC so the column type and
--    every existing `.slice(0, 10)` consumer are unchanged.
--
-- Signature and return type are untouched, so no consumer needs a code
-- change and no regenerated types are required -- only the values change.

CREATE OR REPLACE FUNCTION "private"."team_period_summary_for"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") RETURNS TABLE("agent_id" "uuid", "full_name" "text", "depth" integer, "calls_made" integer, "appts_set" integer, "appts_held" integer, "premium_cents" bigint, "calls_target" integer, "appts_held_target" integer, "premium_cents_target" bigint, "pct_calls" numeric, "streak_days" integer, "last_logged_at" timestamp with time zone, "has_override" boolean)
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
           -- Last day in the window that actually carried activity. Mirrors
           -- enqueue_due_notifications()'s own "did this agent log anything"
           -- test, plus the two appointment/referral counters a day can hold
           -- without any call being made.
           max(m.activity_date) filter (
             where m.calls_made > 0 or m.appts_set > 0 or m.sales_count > 0
                or m.recruiting_convos > 0 or m.appt_held > 0
                or m.referrals_given > 0
           ) last_active
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
         st.streak,
         -- date -> timestamptz at midnight UTC, explicitly rather than via a
         -- bare cast, so the value does not shift with the session TimeZone.
         (g.last_active::timestamp at time zone 'UTC'),
         exists (
           select 1 from public.targets ov
           where ov.agent_id = a.id and ov.effective_from <= p_from
         )
  from scope s
  join public.agents a on a.id = s.id and a.status = 'active'
  left join agg g on g.agent_id = a.id
  cross join cycles c
  cross join lateral private.effective_target(a.id, p_from) t
  -- Consecutive qualifying days ending at p_to. Ordered desc and numbered,
  -- a day is part of the run only while its date is exactly p_to - (rn - 1);
  -- the first gap breaks the equality for that row and every row after it,
  -- since rn keeps rising by 1 while the dates fall by more. LATERAL is what
  -- makes a.id / t.min_calls_per_day legal inside the derived table. The
  -- LIMIT caps a pathological scan -- a run longer than 400 days reports 400.
  cross join lateral (
    select count(*)::int as streak
    from (
      select d.activity_date,
             (row_number() over (order by d.activity_date desc))::int rn
      from public.daily_metrics d
      where d.agent_id = a.id
        and d.activity_date <= p_to
        and d.calls_made >= t.min_calls_per_day
      order by d.activity_date desc
      limit 400
    ) run
    where run.activity_date = p_to - (run.rn - 1)
  ) st;
$$;

ALTER FUNCTION "private"."team_period_summary_for"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";

-- Service-role-only, same as the original. REVOKE names anon/authenticated
-- explicitly (CLAUDE.md rule 4 -- REVOKE ... FROM PUBLIC does not undo an
-- ALTER DEFAULT PRIVILEGES grant made directly to those roles).
REVOKE ALL ON FUNCTION "private"."team_period_summary_for"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC, "anon", "authenticated";

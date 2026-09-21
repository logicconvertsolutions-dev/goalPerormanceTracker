-- P25 Phase D-1 -- an appointment becomes visible BEFORE the day it falls on.
--
-- Full context in
-- `.github/Spec Sheets/12-appointment-lifecycle-remediation.md` (§5 Phase D,
-- section D-1; finding F13; edge cases E5/E35).
--
-- ---------------------------------------------------------------------
-- THE FINDING (F13)
--
-- `my_followups` surfaces an appointment only once its own date has
-- arrived: both appointment branches filter `due date <= p_as_of`. Combine
-- that with `/appointments` showing only the current period (fixed in C2's
-- Upcoming section) and an appointment booked for next week was, until
-- that section shipped, invisible in the entire product until the morning
-- it happened. My Day -- the screen whose whole job is "who to call today"
-- -- still cannot see it at all.
--
-- There are no reminders of any kind in this product. D-2 adds Web Push.
-- This half needs no infrastructure whatsoever: the data is already there,
-- the query is simply refusing to look forward.
--
-- ---------------------------------------------------------------------
-- WHAT CHANGES
--
-- Exactly one thing: the two APPOINTMENT branches look ahead seven days.
--
--   branch 2  appointments, status = 'scheduled'
--   branch 3  legacy appointments living only on a call log
--
-- The two FOLLOW-UP branches (1 and 4) are deliberately NOT widened. A
-- follow-up dated next Tuesday is a task the agent scheduled for next
-- Tuesday; dragging it into today's queue is a different product decision
-- that nobody asked for, and it would make the queue a to-do list instead
-- of a callback list. An appointment is different in kind -- it is an
-- commitment to another person at a fixed time, and the cost of learning
-- about it late is missing it.
--
-- SEVEN DAYS, and not a week boundary. A rolling window means the horizon
-- is the same on a Monday as on a Friday. A Monday-anchored "rest of this
-- week" would show six days of warning on a Monday and none on a Saturday,
-- which is backwards -- the weekend is exactly when someone checks what is
-- coming. The app's own week (CLAUDE.md: weeks start Monday) still governs
-- the trend chart; this is a lookahead horizon, not a reporting period, so
-- it does not have to agree with it and should not pretend to.
--
-- ---------------------------------------------------------------------
-- WHAT DOES NOT CHANGE
--
-- The signature, the OUT columns, the branch count, the dedup clause, the
-- ordering, and every grant. This is a pure function-body swap: `CREATE OR
-- REPLACE` with an identical shape, so `types/database.ts` does not move
-- and no regeneration is required.
--
-- NO NUMBER MOVES. Nothing here touches daily_metrics, recompute_day, or
-- any aggregate. `my_followups` feeds one screen's queue and nothing else
-- -- no dashboard, no RPC, no export reads it. This migration cannot
-- restate a historical figure even in principle, which makes Phase D the
-- first P25 phase with nothing to announce (§9).
--
-- ---------------------------------------------------------------------
-- days_late GOES NEGATIVE, AND THAT IS THE POINT
--
-- `days_late` is `p_as_of - greatest(due date, set_on)` (C2, E5). A row
-- that is due in three days reports -3. Callers already branch on
-- `days_late > 0` for "overdue" and `= 0` for "due today", so both keep
-- working unchanged and the existing My Day KPI tiles stay correct without
-- being touched.
--
-- What does NOT survive is any caller that treats "not overdue" as
-- "due today" -- the Next Up card's badge did exactly that, and it is
-- fixed in the same release. A negative days_late is the signal that a row
-- is in the future; it is never an error.
--
-- E35 (a back-dated appointment must not produce a retroactive reminder)
-- is unaffected here -- this is a read-time widening with no send path --
-- but the same `greatest(..., set_on)` that E5 added is what keeps a row
-- entered after the fact from claiming to be a week overdue on arrival.
--
-- ---------------------------------------------------------------------
-- REVERT
--
-- Change both `<= (p_as_of + 7)` back to `<= p_as_of` and re-apply. The
-- app tolerates the narrow window with no change -- the forward bands
-- simply render empty -- so a revert here does not require an app revert.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."my_followups"("p_as_of" "date" DEFAULT CURRENT_DATE) RETURNS TABLE(
    "call_id" "uuid", "contact_id" "uuid", "contact_name" "text", "last_note" "text",
    "kind" "text", "due_date" "date", "appointment_at" timestamp with time zone,
    "days_late" integer, "times_called" integer
)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  -- Always exactly one row, even for a caller with no agents row: a
  -- zero-row CTE would make `(select tz from me)` NULL, and
  -- `at time zone NULL` is NULL, which would silently drop every dated
  -- branch below.
  with me as (
    select coalesce(
      (select a.time_zone from public.agents a where a.id = (select auth.uid())),
      'America/New_York'
    ) as tz
  )
  -- 1. Call follow-ups. Unchanged from P23 -- NOT widened (see header).
  select cl.id, ct.id, ct.full_name, cl.notes,
         'follow_up'::text, cl.follow_up_on, null::timestamptz,
         (p_as_of - cl.follow_up_on)::int,
         (select count(*)::int from public.call_logs x where x.contact_id = ct.id)
  from public.call_logs cl
  join public.contacts ct on ct.id = cl.contact_id
  where cl.agent_id = (select auth.uid())
    and cl.follow_up_on is not null
    and cl.follow_up_on <= p_as_of
    and cl.follow_up_done_at is null

  union all

  -- 2. Appointments still awaiting an outcome (P25 C1). Due on the day
  --    they are FOR -- scheduled_for's date in the agent's own zone, with
  --    appt_date as the fallback for a legacy or imported row that has no
  --    scheduled_for at all.
  --
  --    days_late measures from greatest(due date, set_on) (P25 C2, E5): an
  --    appointment entered after the fact has not been sitting unresolved
  --    since the day it was for -- the agent has only had it since they
  --    logged it. A normal appointment is booked on or before its own
  --    date, so greatest() picks the due date and nothing changes.
  --
  --    P25 D-1: the horizon is p_as_of + 7, not p_as_of. Everything still
  --    pending in the past keeps coming back (that is the "needs an
  --    outcome" nag), and the next seven days arrive early enough to be
  --    prepared for. days_late is negative for those, which is how the
  --    caller bands them.
  select ap.id, ct.id, ct.full_name, ap.notes,
         'appointment'::text,
         coalesce((ap.scheduled_for at time zone (select tz from me))::date, ap.appt_date),
         ap.scheduled_for,
         (p_as_of - greatest(
            coalesce((ap.scheduled_for at time zone (select tz from me))::date, ap.appt_date),
            ap.set_on))::int,
         (select count(*)::int from public.call_logs x where x.contact_id = ct.id)
  from public.appointments ap
  join public.contacts ct on ct.id = ap.contact_id
  where ap.agent_id = (select auth.uid())
    and ap.status = 'scheduled'
    and coalesce((ap.scheduled_for at time zone (select tz from me))::date, ap.appt_date) <= (p_as_of + 7)

  union all

  -- 3. Legacy appointments that live only on a call log. The `not exists`
  --    clause is the same dedup recompute_day uses: once the call form
  --    creates the appointment row, that row is branch 2's job and this
  --    branch must not show it a second time.
  --
  --    Same E5 rule, measured from the call's own date, and the same
  --    seven-day horizon as branch 2 -- these are appointments too, and
  --    splitting the horizon by which table happens to hold the row is
  --    exactly the "no identity of its own" mistake §2 is about.
  select cl.id, ct.id, ct.full_name, cl.notes,
         'call_appointment'::text,
         (cl.appointment_at at time zone (select tz from me))::date,
         cl.appointment_at,
         (p_as_of - greatest(
            (cl.appointment_at at time zone (select tz from me))::date,
            cl.call_date))::int,
         (select count(*)::int from public.call_logs x where x.contact_id = ct.id)
  from public.call_logs cl
  join public.contacts ct on ct.id = cl.contact_id
  where cl.agent_id = (select auth.uid())
    and cl.appointment_at is not null
    and cl.appointment_done_at is null
    and (cl.appointment_at at time zone (select tz from me))::date <= (p_as_of + 7)
    and not exists (
      select 1 from public.appointments ap2 where ap2.source_call_log_id = cl.id
    )

  union all

  -- 4. F12: a follow-up set on a resolved appointment. Restricted to
  --    resolved rows -- a scheduled one is already in branch 2, and
  --    including it here would queue one appointment twice under two
  --    different due dates. NOT widened, same reasoning as branch 1.
  select ap.id, ct.id, ct.full_name, ap.notes,
         'appointment_follow_up'::text, ap.follow_up_on, null::timestamptz,
         (p_as_of - ap.follow_up_on)::int,
         (select count(*)::int from public.call_logs x where x.contact_id = ct.id)
  from public.appointments ap
  join public.contacts ct on ct.id = ap.contact_id
  where ap.agent_id = (select auth.uid())
    and ap.status <> 'scheduled'
    and ap.follow_up_on is not null
    and ap.follow_up_on <= p_as_of
    and ap.follow_up_done_at is null

  order by 6, 7 nulls first;
$$;

REVOKE ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") TO "service_role";

-- ---------------------------------------------------------------------
-- WHAT AGENTS SEE ON DEPLOY -- run this BEFORE promoting, as C1 and C2 did.
--
-- No number moves (see the header), but My Day gains rows: every pending
-- appointment in the next seven days that the old horizon was hiding. It
-- is a strictly additive change to one screen, and this says by how much
-- and to whom, so "my queue suddenly grew" is answerable rather than
-- alarming.
--
-- Read-only. Runs as-is in the Supabase SQL editor.
--
--   select a.full_name,
--          count(*) filter (
--            where coalesce((ap.scheduled_for at time zone
--                            coalesce(nullif(a.time_zone,''), 'America/New_York'))::date,
--                           ap.appt_date) > current_date
--          ) as newly_visible,
--          min(coalesce((ap.scheduled_for at time zone
--                        coalesce(nullif(a.time_zone,''), 'America/New_York'))::date,
--                       ap.appt_date)) as soonest,
--          max(coalesce((ap.scheduled_for at time zone
--                        coalesce(nullif(a.time_zone,''), 'America/New_York'))::date,
--                       ap.appt_date)) as furthest
--     from public.appointments ap
--     join public.agents a on a.id = ap.agent_id
--    where ap.status = 'scheduled'
--      and coalesce((ap.scheduled_for at time zone
--                    coalesce(nullif(a.time_zone,''), 'America/New_York'))::date,
--                   ap.appt_date) between current_date + 1 and current_date + 7
--    group by a.full_name
--    having count(*) > 0
--    order by newly_visible desc;
--
-- The same for the legacy call-log branch, which the window also widened:
--
--   select a.full_name, count(*) as newly_visible_legacy
--     from public.call_logs cl
--     join public.agents a on a.id = cl.agent_id
--    where cl.appointment_at is not null
--      and cl.appointment_done_at is null
--      and not exists (select 1 from public.appointments ap
--                       where ap.source_call_log_id = cl.id)
--      and (cl.appointment_at at time zone
--           coalesce(nullif(a.time_zone,''), 'America/New_York'))::date
--          between current_date + 1 and current_date + 7
--    group by a.full_name
--    order by newly_visible_legacy desc;
--
-- Nothing here can return a row that was previously counted in a metric:
-- both queries are restricted to dates strictly AFTER today, which is
-- precisely the range the old horizon excluded from the queue and no
-- aggregate ever read from it.
-- ---------------------------------------------------------------------

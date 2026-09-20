-- P25 Phase C2 -- reschedule lineage, and what "overdue" means for an
-- appointment logged after the fact.
--
-- Full context in
-- `.github/Spec Sheets/12-appointment-lifecycle-remediation.md` (§5 Phase C
-- items 3-9, decisions D1/D2/D3, edge cases E5/E10/E11).
--
-- C1 made the call form create the appointment and pointed My Day at it.
-- C2 is the visible half: the resolve sheet, Upcoming, Open Pipeline, the
-- corrected no-show rate. Most of that is application code. Two things are
-- not, and they are what this migration does.
--
-- ---------------------------------------------------------------------
-- 1. RESCHEDULE IS A LINKED LIST, AND HAS TO STAY ONE (E11)
--
-- Decision D1: rescheduling terminates the old appointment and creates a
-- successor, linked by `rescheduled_to_id`. Phase B added the column and a
-- guard against a row pointing at itself. That is not enough once the app
-- can actually write it: A -> B -> A is a cycle the self-check misses, and
-- an unbounded chain makes every walk over it a potential hang.
--
-- So: one predecessor per successor (a unique index), no cycles, and a
-- depth cap. The cap is deliberately generous -- ten reschedules of one
-- appointment is already pathological -- because its job is to stop a
-- runaway, not to second-guess an agent whose prospect keeps moving.
--
-- ---------------------------------------------------------------------
-- 2. AN APPOINTMENT CANNOT BE MORE OVERDUE THAN IT IS OLD (E5)
--
-- `my_followups` reports `days_late` as "today minus the day it was due".
-- For an appointment booked before it happens -- every normal one -- that
-- is right. For one entered AFTER the fact, which is the whole point of
-- back-dating, it is not: log a pending appointment today for last month
-- and My Day immediately brands it "30d overdue", when in truth the agent
-- has had it for zero days.
--
-- days_late now measures from `greatest(due date, the day the row was
-- created)`. A normal appointment is unaffected, because it was always
-- booked on or before the day it is for. A back-dated one starts at 0 and
-- ages from there, which is what E5 asks for -- and it still appears in
-- the queue, because it genuinely does need an outcome.

-- ---------------------------------------------------------------------
-- WHAT THIS CHANGES IN PRODUCTION (measured 2026-09-20, before promotion)
--
--   appointments already carrying rescheduled_to_id ...... 0  <- guards are safe
--   rows with status = 'rescheduled' ..................... 0
--   scheduled appointments carrying a premium ............ 1  (imported)
--   sales linked to an appointment ....................... 1  <- F16's dialog has one live case
--
-- The no-show rate is RESTATED by this release, and the restatement is
-- invisible: scripts/noshow-restatement-preview.sql computes both formulas
-- side by side and returns zero rows. Across all 31 agent-cycles in the
-- product's history, not one contains a no-show, so every displayed rate
-- is 0% under both. No agent's number changes.
--
-- That will stop being true the first time anyone records a no-show, which
-- is exactly the argument for landing the correct formula now rather than
-- once it has a visible number attached.
--
-- Re-run the footer query before promoting; these move with ordinary use.

-- ---------------------------------------------------------------------
-- 1a. One predecessor per successor.
--
--     Without this, "which appointment did this one replace?" has no
--     single answer, and the backward chain walk below would have to pick
--     one arbitrarily. Partial, so the overwhelming majority of rows --
--     which were never rescheduled into -- are unconstrained.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "appointments_rescheduled_to_idx"
  ON "public"."appointments" USING "btree" ("rescheduled_to_id")
  WHERE ("rescheduled_to_id" IS NOT NULL);

COMMENT ON INDEX "public"."appointments_rescheduled_to_idx" IS
  'Unique: an appointment is the successor of at most one predecessor, so a reschedule chain is a list rather than a graph (P25 C2, E11).';

-- ---------------------------------------------------------------------
-- 1b. Cycle guard and depth cap.
--
--     Phase B's appointments_links_valid already rejects a row pointing at
--     itself and any link crossing an agent or org. This covers the longer
--     cases it cannot see: A -> B -> A, and a chain that just keeps going.
--
--     SECURITY DEFINER because it must see the whole chain to walk it, and
--     RLS would hide rows mid-walk. It returns no data -- it either raises
--     or lets the write through -- so nothing leaks by seeing them.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "private"."appointments_reschedule_chain_valid"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_cap constant int := 10;
  v_cursor uuid;
  v_ahead int := 0;
  v_behind int := 0;
begin
  if new.rescheduled_to_id is null then
    return new;
  end if;

  -- Forward: everything this appointment was rescheduled into. Reaching
  -- new.id again means the link would close a loop.
  v_cursor := new.rescheduled_to_id;
  while v_cursor is not null loop
    if v_cursor = new.id then
      raise exception 'appointments.rescheduled_to_id would close a cycle in the reschedule chain';
    end if;
    v_ahead := v_ahead + 1;
    if v_ahead > v_cap then
      raise exception 'reschedule chain would exceed % appointments', v_cap;
    end if;
    select ap.rescheduled_to_id into v_cursor
      from public.appointments ap where ap.id = v_cursor;
  end loop;

  -- Backward: everything that was rescheduled into this appointment.
  -- Single-valued thanks to the unique index above.
  v_cursor := new.id;
  loop
    select ap.id into v_cursor
      from public.appointments ap where ap.rescheduled_to_id = v_cursor;
    exit when v_cursor is null;
    v_behind := v_behind + 1;
    if v_behind > v_cap then
      raise exception 'reschedule chain would exceed % appointments', v_cap;
    end if;
  end loop;

  if v_behind + 1 + v_ahead > v_cap then
    raise exception 'reschedule chain would exceed % appointments', v_cap;
  end if;

  return new;
end $$;

ALTER FUNCTION "private"."appointments_reschedule_chain_valid"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."appointments_reschedule_chain_valid"() FROM PUBLIC, "anon", "authenticated";

DROP TRIGGER IF EXISTS "appointments_reschedule_chain_valid" ON "public"."appointments";
CREATE TRIGGER "appointments_reschedule_chain_valid"
  BEFORE INSERT OR UPDATE OF "rescheduled_to_id" ON "public"."appointments"
  FOR EACH ROW EXECUTE FUNCTION "private"."appointments_reschedule_chain_valid"();

-- Deliberately NOT enforced: that a row with status='rescheduled' has a
-- successor. The app always creates the pair together, but rows predating
-- C2 were marked rescheduled by hand with nothing to point at, and a
-- successor deleted later legitimately leaves its predecessor dangling
-- (E10 -- the FK is ON DELETE SET NULL). Neither can re-enter the no-show
-- denominator, because D3 keeps `rescheduled` out of it entirely.

-- ---------------------------------------------------------------------
-- 2. my_followups: days_late measures from when the agent actually got
--    the item (E5). Everything else about the function is byte-identical
--    to C1 -- same four branches, same OUT columns, same dedup.
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
  -- 1. Call follow-ups. Unchanged from P23.
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
    and coalesce((ap.scheduled_for at time zone (select tz from me))::date, ap.appt_date) <= p_as_of

  union all

  -- 3. Legacy appointments that live only on a call log. The `not exists`
  --    clause is the same dedup recompute_day uses: once the call form
  --    creates the appointment row, that row is branch 2's job and this
  --    branch must not show it a second time.
  --
  --    Same E5 rule, measured from the call's own date.
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
    and (cl.appointment_at at time zone (select tz from me))::date <= p_as_of
    and not exists (
      select 1 from public.appointments ap2 where ap2.source_call_log_id = cl.id
    )

  union all

  -- 4. F12: a follow-up set on a resolved appointment. Restricted to
  --    resolved rows -- a scheduled one is already in branch 2, and
  --    including it here would queue one appointment twice under two
  --    different due dates.
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
-- NO NUMBER MOVES HERE
--
-- Nothing in this file touches daily_metrics, recompute_day or any
-- aggregate. The unique index constrains a column nothing has written yet
-- (zero rows carry rescheduled_to_id); the chain trigger only ever raises;
-- my_followups changes one displayed integer on rows that were entered
-- after the fact, and returns the same rows either way.
--
-- The no-show rate DOES change in C2 -- from
-- `no_show / (scheduled + held + no_show + rescheduled + cancelled)` to
-- `no_show / (held + no_show + cancelled)` per §3 and D3 -- but that
-- formula lives in `src/lib/metrics.ts` and the pages that call it, not in
-- the database. It is a display change over unchanged stored counters, and
-- it is the §9 restatement to communicate alongside this release.
--
-- REVERT
--
--   1. Re-apply my_followups' body from
--      20260920140000_p25c1_call_creates_appointment.sql (identical but
--      for the two greatest() expressions).
--   2. drop trigger appointments_reschedule_chain_valid on public.appointments;
--      drop function private.appointments_reschedule_chain_valid();
--      drop index public.appointments_rescheduled_to_idx;
--
-- Reschedule pairs already created keep their links and keep counting --
-- the predecessor terminal, the successor with its own set_on -- so a
-- revert loses the guards, not the data.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- PRE-PROMOTION COUNTS (read-only)
--
--   with cyc as (select public.cycle_start(current_date) f, public.cycle_end(current_date) t),
--   agg as (
--     select m.agent_id,
--            sum(m.appt_scheduled) sched, sum(m.appt_held) held, sum(m.appt_no_show) ns,
--            sum(m.appt_rescheduled) resched, sum(m.appt_cancelled) canc
--     from public.daily_metrics m, cyc
--     where m.activity_date between cyc.f and cyc.t group by 1)
--   select
--     (select count(*) from public.appointments where rescheduled_to_id is not null) as existing_links,
--     (select coalesce(sum(sched+held+ns+resched+canc),0) from agg) as old_noshow_denominator,
--     (select coalesce(sum(held+ns+canc),0) from agg) as new_noshow_denominator,
--     (select count(*) from agg where ns > 0) as agents_with_a_noshow,
--     (select count(*) from public.sales where appointment_id is not null) as sales_linked;
--
-- `existing_links` must be 0 before the unique index is created. The two
-- denominators are the size of the no-show restatement; `agents_with_a_noshow`
-- is how many people will actually SEE it change.
-- ---------------------------------------------------------------------

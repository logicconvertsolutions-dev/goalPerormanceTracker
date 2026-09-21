-- P25 Phase C1 -- the call form creates the appointment, and My Day reads
-- the appointments table. Fixes F4 (for good) and F11, and lands the
-- appointments half of F12.
--
-- Full context in
-- `.github/Spec Sheets/12-appointment-lifecycle-remediation.md` (§5 Phase C
-- items 1-2, decisions D5/D6/D7, edge cases E15/E16).
--
-- C1 is the invisible half of Phase C. The visible half -- the resolve
-- sheet, the Upcoming section, Open Pipeline (F7) -- is C2.
--
-- ---------------------------------------------------------------------
-- WHAT CHANGES
--
-- Phase B shipped `source_call_log_id` and the recompute_day dedup clause
-- that reads it, both inert because nothing wrote the column. From this
-- phase on, logging a call with outcome='appointment_set' creates a real
-- appointments row and stamps the link, so:
--
--   * F4 closes. recompute_day already counts an appointment_set call log
--     only when no appointment points back at it; now every new one does,
--     so the pair counts ONCE instead of twice. No migration work here --
--     the clause is already live, it simply starts matching.
--   * F11 closes. An appointment booked from a call had no status and
--     could never become Held / No-show / Cancelled. It is now an ordinary
--     appointments row with the full status machine behind it.
--
-- The only DB-side work is `my_followups`, which still reads My Day's
-- queue entirely out of `call_logs`.
--
-- ---------------------------------------------------------------------
-- NO NUMBER MOVES FOR EXISTING DATA
--
-- Phase B verified zero linked rows in production, and this migration
-- backfills none (D4, and the Phase B header's reasoning about retro-
-- linking). The dedup clause therefore matches nothing that exists today;
-- it only ever applies to calls logged after this deploys. There is no
-- rebuild step in this file for exactly that reason, and no restatement
-- to announce -- unlike Phase A, which moved seven agent-days (§9a).

-- ---------------------------------------------------------------------
-- WHAT AGENTS WILL SEE ON THE DAY THIS DEPLOYS
--
-- No number moves, but My Day's queue does gain rows -- appointments that
-- already existed and were never surfaced anywhere. Measured against
-- production on 2026-09-20, before promotion:
--
--   already linked (source_call_log_id set) ........ 0   <- index is safe
--   scheduled appointments now reaching My Day ..... 4   (8, 8, 6 and 30 days late)
--   appointment follow-ups now reaching My Day ..... 5   (0, 3, 10, 16, 20 days late)
--   outstanding legacy call-log appointments ....... 0   <- branch 3 matches nothing live
--
-- Nine rows across the whole product, every one of them a real item that
-- was being silently dropped: the four appointments had no way to be
-- resolved at all (F11), and the five follow-ups were written by the
-- appointment form and read by nothing (F12). The Overdue tile will tick
-- up for the agents who own them. That is the feature working, not a
-- regression -- but it is the kind of thing worth saying out loud before
-- someone reports it as one.
--
-- Re-run the counts from this file's footer query before promoting, since
-- the numbers move with ordinary use.

-- ---------------------------------------------------------------------
-- 1. One appointment per call log, enforced rather than hoped for.
--
--    E16: a duplicate submit -- an offline replay, a double-tap, two
--    devices -- must not create a second appointment, and therefore must
--    not create a second appts_set event. The server action is idempotent
--    on client_request_id, but that only covers submissions that carry
--    one. This index makes "a call produces at most one appointment" an
--    invariant of the table itself.
--
--    Partial, so the many appointments with no source call (the
--    /appointments/new path, imports, and every legacy row) are unaffected
--    -- a partial unique index permits unlimited NULLs.
--
--    Safe to create: Phase B's staging and production verification both
--    reported zero rows with source_call_log_id set.
--
--    A Phase C2 reschedule successor is created from the resolve sheet,
--    not from a call, so it carries no source_call_log_id and never
--    collides with its predecessor here.
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS "public"."appointments_source_call_log_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "appointments_source_call_log_idx"
  ON "public"."appointments" USING "btree" ("source_call_log_id")
  WHERE ("source_call_log_id" IS NOT NULL);

COMMENT ON INDEX "public"."appointments_source_call_log_idx" IS
  'Unique: one call log produces at most one appointment (P25 C1, E16). Partial, so rows with no source call are unconstrained.';

-- ---------------------------------------------------------------------
-- 2. my_followups -- My Day's queue, now sourced from appointments.
--
--    The OUT column list is deliberately unchanged, so this is a
--    CREATE OR REPLACE rather than a drop-and-recreate and no grant has to
--    be restored. `call_id` keeps its name but now means "the id of the
--    row this item came from"; `kind` says which table that is, which is
--    what the client routes its actions on.
--
--    Four branches, from two tables:
--
--      follow_up             call_logs.follow_up_on        (unchanged)
--      appointment           appointments, status=scheduled     NEW
--      call_appointment      call_logs.appointment_at      (legacy only)
--      appointment_follow_up appointments.follow_up_on          NEW (F12)
--
--    `appointment` vs `call_appointment` is not cosmetic: the two need
--    different mutations (a status change on appointments, versus the old
--    appointment_done_at stamp on call_logs), so the client must be able
--    to tell them apart. The old single 'appointment' kind is retained for
--    the branch that still reads appointments out of call_logs.
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
  -- branch below. The old body coalesced at each use site instead.
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
  --    scheduled_for at all. Those rows have no time of day, so they
  --    surface on their date and sort first within it (null appointment_at).
  --
  --    Phase D widens this to a forward window and bands the result; C1
  --    keeps the same `<= p_as_of` horizon the call-log branch has always
  --    used, so the queue's contents do not change shape in this phase --
  --    only where they are read from.
  select ap.id, ct.id, ct.full_name, ap.notes,
         'appointment'::text,
         coalesce((ap.scheduled_for at time zone (select tz from me))::date, ap.appt_date),
         ap.scheduled_for,
         (p_as_of - coalesce((ap.scheduled_for at time zone (select tz from me))::date, ap.appt_date))::int,
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
  --    branch must not show it a second time. Without this, every
  --    appointment booked after C1 deploys would appear on My Day twice.
  select cl.id, ct.id, ct.full_name, cl.notes,
         'call_appointment'::text,
         (cl.appointment_at at time zone (select tz from me))::date,
         cl.appointment_at,
         (p_as_of - (cl.appointment_at at time zone (select tz from me))::date)::int,
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

  -- 4. F12: appointments.follow_up_on has been written by the appointment
  --    form since P20 and read by nothing. The column and its index both
  --    existed; the queue simply never looked at them, so "call them back
  --    in two weeks" set on a held appointment vanished.
  --
  --    Restricted to resolved rows on purpose. The form only offers a
  --    follow-up date for held/no_show/rescheduled/cancelled, and a
  --    scheduled row is already in branch 2 -- including it here would put
  --    one appointment in the queue twice under two different due dates.
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

-- CREATE OR REPLACE keeps the existing grants, but restate them anyway --
-- naming anon/authenticated explicitly per CLAUDE.md rule 4 -- so this file
-- is correct whether or not the function already existed.
REVOKE ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") TO "service_role";

-- ---------------------------------------------------------------------
-- REVERT
--
-- Pure function swap plus an index shape. To go back:
--
--   1. Re-apply my_followups' body from
--      20260920100000_p23_appt_set_from_call_log.sql (three branches, no
--      appointments table).
--   2. DROP INDEX public.appointments_source_call_log_idx; then recreate
--      it non-unique, exactly as 20260920130000_p25b did.
--
-- Appointment rows created by the call form survive either way and keep
-- counting through set_on, so no metric is lost by reverting -- appts_set
-- would simply return to double-counting linked pairs (F4).
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- DEPLOYMENT COUNTS (read-only, re-run before promoting)
--
--   select
--     (select count(*) from public.appointments where source_call_log_id is not null) as already_linked,
--     (select count(*) from public.appointments where status = 'scheduled'
--        and coalesce((scheduled_for at time zone 'America/New_York')::date, appt_date) <= current_date) as newly_on_my_day,
--     (select count(*) from public.appointments where status <> 'scheduled'
--        and follow_up_on is not null and follow_up_on <= current_date
--        and follow_up_done_at is null) as f12_followups,
--     (select count(*) from public.call_logs where outcome = 'appointment_set'
--        and appointment_at is not null and appointment_done_at is null) as legacy_call_appointments;
--
-- `already_linked` must be 0 before the unique index is created. The other
-- three are how many rows My Day gains on deploy.
-- ---------------------------------------------------------------------

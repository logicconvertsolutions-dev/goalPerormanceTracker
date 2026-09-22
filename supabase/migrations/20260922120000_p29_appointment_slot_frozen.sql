-- P29 -- a resolved appointment's slot cannot move.
--
-- Follow-up to P25 (`.github/Spec Sheets/12-appointment-lifecycle-remediation.md`,
-- edge case E19, finding F8).
--
-- ---------------------------------------------------------------------
-- WHY
--
-- Phase B made `scheduled_for` the appointment's own date and time, and
-- its column comment promises "immutable once the row is terminal". Only
-- half of that was enforced. `private.appointments_identity()` stops a
-- NULL from destroying the slot on resolution (F8's actual failure), but a
-- write that sets a DIFFERENT slot on a held / no-show / cancelled /
-- rescheduled row goes straight through. RLS lets the owning agent update
-- their own row, so any client could rewrite when a recorded meeting
-- happened -- and the P25 rule is that a resolved appointment's slot is a
-- recorded fact, not an editable field.
--
-- Per CLAUDE.md rule 1 this is a trigger, not a policy: the agent can
-- update the row, just not this column in this state.
--
-- ---------------------------------------------------------------------
-- THE RULE
--
--   old.status <> 'scheduled'  AND  new.status <> 'scheduled'
--   AND new.scheduled_for IS DISTINCT FROM old.scheduled_for   -> reject
--
-- Deliberately allowed:
--   * scheduled -> scheduled   moving a pending appointment (edit form,
--                              call-form sync, My Day snooze).
--   * scheduled -> terminal    resolving it, including in the same write.
--   * terminal  -> scheduled   an explicit reopen ("undo"); the row is
--                              pending again, so its slot is editable again.
--
-- Reschedule is unaffected: it never moves the original's slot, it books a
-- successor (D1).
--
-- ---------------------------------------------------------------------
-- WHAT THIS CHANGES IN PRODUCTION
--
-- Nothing already stored. The trigger only judges future UPDATEs, and no
-- application path writes `scheduled_for` on a row that stays terminal:
-- updateAppointmentAction sends it only for status 'scheduled', and the
-- call-form sync and snooze touch only rows still 'scheduled'. No number
-- moves, and nothing needs to be re-marked dirty.
--
-- Trigger order: Postgres fires BEFORE ROW triggers alphabetically, so
-- `appointments_identity` has already restored a NULLed slot from
-- `old.scheduled_for` by the time this runs -- a NULL write on a terminal
-- row is therefore a no-op here, not a rejection (008 relies on that).
--
-- ---------------------------------------------------------------------
-- REVERT
--
--   DROP TRIGGER IF EXISTS "appointments_slot_frozen" ON "public"."appointments";
--   DROP FUNCTION IF EXISTS "private"."appointments_slot_frozen"();
--
-- Pure guard; dropping it restores the previous behaviour exactly.

CREATE OR REPLACE FUNCTION "private"."appointments_slot_frozen"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if old.status <> 'scheduled'
     and new.status <> 'scheduled'
     and new.scheduled_for is distinct from old.scheduled_for then
    raise exception 'appointments.scheduled_for cannot change once the appointment has an outcome (status %)', old.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

ALTER FUNCTION "private"."appointments_slot_frozen"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "private"."appointments_slot_frozen"() FROM PUBLIC, "anon", "authenticated";

DROP TRIGGER IF EXISTS "appointments_slot_frozen" ON "public"."appointments";
CREATE TRIGGER "appointments_slot_frozen"
  BEFORE UPDATE ON "public"."appointments"
  FOR EACH ROW EXECUTE FUNCTION "private"."appointments_slot_frozen"();

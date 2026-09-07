-- Lets the appointment form's "Log as a Sale" / "Recruited?" toggles detect
-- a sale/recruiting log it already created from a given appointment, so
-- re-saving an edited appointment updates that linked record instead of
-- inserting a duplicate every time.
--
-- sales.appointment_id already existed in the schema (FK'd, ON DELETE SET
-- NULL) but was never wired up anywhere in the app -- this just adds the
-- uniqueness guarantee (at most one sale per appointment) that the app code
-- now relies on. recruiting_logs has no equivalent column yet, so it's
-- added here the same way.
--
-- ON DELETE SET NULL (not CASCADE): deleting an appointment shouldn't
-- silently delete a real sale/recruiting log -- it just stops being linked
-- to the (now-gone) appointment that originated it.

CREATE UNIQUE INDEX IF NOT EXISTS "sales_appointment_uq"
  ON "public"."sales" USING "btree" ("appointment_id")
  WHERE ("appointment_id" IS NOT NULL);

ALTER TABLE "public"."recruiting_logs"
  ADD COLUMN IF NOT EXISTS "appointment_id" "uuid";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recruiting_logs_appointment_id_fkey'
  ) THEN
    ALTER TABLE ONLY "public"."recruiting_logs"
      ADD CONSTRAINT "recruiting_logs_appointment_id_fkey"
      FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "recruiting_logs_appointment_uq"
  ON "public"."recruiting_logs" USING "btree" ("appointment_id")
  WHERE ("appointment_id" IS NOT NULL);

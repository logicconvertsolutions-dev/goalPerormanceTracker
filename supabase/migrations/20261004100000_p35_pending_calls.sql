-- P35: calls waiting for an outcome live in their own table, not in call_logs.
--
-- P34 saved a tap-to-call the agent closed the "how did it go?" prompt on
-- as a call_logs row with outcome null ("Outcome needed"). Staging testing
-- (2026-10-04, product owner): closing the prompt must NOT log a call.
-- It waits in a "Calls to finish" list until the agent adds the outcome --
-- only then is it a call (Calls logged, Activity Logs, daily_metrics, the
-- SMD's totals) -- or until they say "I didn't make this call", which
-- removes it without a trace.
--
-- So:
--   1. public.pending_calls: who, which button (phone/whatsapp), and the
--      agent-local day the call was made. Owner-only (RLS + org check, rule
--      8). Never read by any SECURITY DEFINER function or any leader/admin
--      RPC, and not counted anywhere (rule 2): a pending call is not a call
--      yet.
--   2. Any call_logs rows P34 already saved with no outcome (staging only;
--      P34 never reached production) move into pending_calls, keeping the
--      day they were made.
--   3. call_logs.outcome is NOT NULL again: every call_logs row is a
--      completed call. call_logs.channel (P34) stays.
--
-- When the agent completes a pending call, the app logs it with call_date =
-- the pending row's call_date -- the day the call happened (rule 12) -- and
-- deletes the pending row in the same server action.
--
-- Re-runnable (CLAUDE.md "Dumped SQL is not automatically safe to re-run").

-- ---------------------------------------------------------------------
-- 1. pending_calls
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."pending_calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "agent_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "channel" "text" NOT NULL,
    "call_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_request_id" "text",
    CONSTRAINT "pending_calls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pending_calls_channel_check" CHECK (("channel" = ANY (ARRAY['phone'::"text", 'whatsapp'::"text"]))),
    CONSTRAINT "pending_calls_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE,
    CONSTRAINT "pending_calls_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE,
    -- Deleting a contact takes its waiting calls with it, like its calls.
    CONSTRAINT "pending_calls_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "pending_calls_agent_idx" ON "public"."pending_calls" ("agent_id", "created_at");
-- A double close or a retry of the same prompt saves one row.
CREATE UNIQUE INDEX IF NOT EXISTS "pending_calls_client_request_uq"
  ON "public"."pending_calls" ("agent_id", "client_request_id") WHERE ("client_request_id" IS NOT NULL);

CREATE OR REPLACE TRIGGER "pending_calls_org" BEFORE INSERT OR UPDATE OF "agent_id" ON "public"."pending_calls"
  FOR EACH ROW EXECUTE FUNCTION "public"."set_org_from_agent"();
-- Only the agent's own contact (an FK alone accepts anyone's; see P30).
CREATE OR REPLACE TRIGGER "pending_calls_own_links" BEFORE INSERT OR UPDATE OF "contact_id", "agent_id" ON "public"."pending_calls"
  FOR EACH ROW EXECUTE FUNCTION "private"."assert_own_linked_records"();

ALTER TABLE "public"."pending_calls" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pending_calls_own" ON "public"."pending_calls";
CREATE POLICY "pending_calls_own" ON "public"."pending_calls" TO "authenticated"
  USING ((("agent_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org"))))
  WITH CHECK ((("agent_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org"))));

-- Default privileges grant ALL on new public tables to anon and
-- authenticated directly, so revoke by name (rule 4), then grant back what
-- the app needs: save, list, remove. No update -- a pending call is finished
-- by logging it, not by editing it.
REVOKE ALL ON TABLE "public"."pending_calls" FROM PUBLIC, "anon", "authenticated";
GRANT SELECT, INSERT, DELETE ON TABLE "public"."pending_calls" TO "authenticated";
GRANT ALL ON TABLE "public"."pending_calls" TO "service_role";

comment on table "public"."pending_calls" is
  'Tap-to-call calls waiting for the agent to add an outcome (P35). Not a call until logged; never counted.';

-- ---------------------------------------------------------------------
-- 2. Move P34's outcome-less call_logs rows (staging only)
-- ---------------------------------------------------------------------
-- Deleting them fires call_logs_metrics, so their days are re-marked and
-- recomputed without them -- they were never real calls. This is not the
-- retention purge, so the kautis.purging guard (rule 13) does not apply.
with moved as (
  delete from "public"."call_logs"
  where "outcome" is null
  returning "id", "org_id", "agent_id", "contact_id", "channel", "call_date", "created_at", "client_request_id"
)
insert into "public"."pending_calls" ("org_id", "agent_id", "contact_id", "channel", "call_date", "created_at", "client_request_id")
select "org_id", "agent_id", "contact_id", coalesce("channel", 'phone'), "call_date", "created_at", "client_request_id"
from moved
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 3. call_logs: every row is a completed call again
-- ---------------------------------------------------------------------
drop index if exists "public"."call_logs_outcome_needed_idx";
alter table "public"."call_logs" alter column "outcome" set not null;

comment on column "public"."call_logs"."outcome" is null;

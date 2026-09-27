-- P34: call tracking after tap-to-call / WhatsApp (P33).
--
-- 1. call_logs.channel -- which button the agent tapped: 'phone' (the
--    device dialer) or 'whatsapp' (a wa.me chat). Null for a call logged
--    the ordinary way, where nobody said how it was made.
--
-- 2. call_logs.outcome becomes nullable. When the agent comes back from the
--    dialer and closes the "how did it go?" prompt without answering, the
--    attempt is still saved -- a dismissed prompt must not mean no record
--    the call happened -- with outcome null, shown in the app as "Outcome
--    needed" until they fill it in.
--
--    What that means for the read model (reviewed against recompute_day,
--    unchanged here):
--      * calls_made counts every call_logs row, so the attempt counts as a
--        call on the day it was made, straight away. That is the event (rule
--        12): the dialer opened. Filling the outcome in later does not move
--        it to another day or change calls_made.
--      * every out_* counter filters `outcome = '<value>'`, which is never
--        true for null, so an unanswered attempt sits in no outcome bucket
--        until it gets one. call_logs_metrics fires on UPDATE, so completing
--        it re-marks the day and the bucket fills in.
--      * appts_set's "outcome = 'appointment_set' with no linked
--        appointment" branch, my_followups (needs follow_up_on) and
--        purge_old_call_logs are all null-safe as written.
--    Leaders still see counts only (rule 2); outcome, notes and channel stay
--    on the agent's own screens (call_logs is owner-only under RLS).
--
-- Re-runnable (CLAUDE.md "Dumped SQL is not automatically safe to re-run").

alter table "public"."call_logs" add column if not exists "channel" text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'call_logs_channel_check'
      and conrelid = 'public.call_logs'::regclass
  ) then
    alter table "public"."call_logs"
      add constraint "call_logs_channel_check"
      check ("channel" is null or "channel" in ('phone', 'whatsapp'));
  end if;
end $$;

alter table "public"."call_logs" alter column "outcome" drop not null;

-- The "Outcome needed" list on My Day: an agent's own unanswered attempts.
create index if not exists "call_logs_outcome_needed_idx"
  on "public"."call_logs" ("agent_id", "created_at")
  where "outcome" is null;

comment on column "public"."call_logs"."channel" is
  'phone | whatsapp when logged from tap-to-call (P34); null for an ordinary log.';
comment on column "public"."call_logs"."outcome" is
  'Null = attempt saved from a dismissed post-call prompt, shown as "Outcome needed" (P34).';

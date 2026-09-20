-- P23: capture the appointment date/time directly on the call log when the
-- outcome is "Appointment set", instead of relying on a second, disconnected
-- appointments-table row to know an appointment was set.
--
-- Bug this fixes: appts_set (My Dashboard / My Team Dashboard "Appts Set"
-- columns) was sourced from public.appointments, keyed by appt_date -- which
-- appointment-form.tsx caps at "cannot be in the future". So an agent who
-- logged a call with outcome "Appointment set" saw nothing in Appts Set
-- unless they *also* went and separately created an appointments row, and
-- even then the count landed on whatever date they typed there, disconnected
-- from the call that actually set it.
--
-- Fix, scoped to exactly what was asked for this pass:
--   1. call_logs gets appointment_at/appointment_done_at -- the call log
--      itself now carries the appointment's date+time. No appointments row
--      is created from this flow.
--   2. private.recompute_day sources appts_set from the same call_logs
--      outcome='appointment_set' count already computed for out_appt_set,
--      instead of from public.appointments. Every dashboard RPC
--      (agent_daily_breakdown, agent_aggregate, team_breakdown,
--      team_period_summary, agent_daily_activity, team_day_summary) reads
--      the resulting daily_metrics.appts_set column, so this one change
--      propagates everywhere without touching those RPCs individually.
--   3. Existing daily_metrics rows are backfilled under the new definition
--      so past periods don't show a seam between the old and new source.
--      This intentionally changes historical Appts Set numbers for any day
--      where the two sources previously disagreed (that disagreement was
--      the bug).
--   4. public.my_followups now also surfaces appointment_at items (kind =
--      'appointment') alongside call follow-ups (kind = 'follow_up'), so
--      "My Day" shows both in Due Today / Next Up / Overdue.
--
-- No CHECK constraint enforcing "appointment_at required when outcome =
-- appointment_set" -- the historical XLSX import path (lib/import/parse-
-- workbook.ts) can still write appointment_set rows with no appointment
-- time, and a DB-level constraint would break that import. "Mandatory" is
-- enforced in the app layer (log/actions.ts) for the live logging path only.

alter table "public"."call_logs"
  add column if not exists "appointment_at" timestamp with time zone,
  add column if not exists "appointment_done_at" timestamp with time zone;

-- Same signature as before (agent, date -> void); CREATE OR REPLACE is fine
-- since only the function body changes, not its OUT columns.
CREATE OR REPLACE FUNCTION "private"."recompute_day"("p_agent" "uuid", "p_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_org uuid;
begin
  select a.org_id into v_org from public.agents a where a.id = p_agent;
  if v_org is null then
    delete from public.daily_metrics where agent_id = p_agent and activity_date = p_date;
    return;
  end if;

  insert into public.daily_metrics as m (
    agent_id, org_id, activity_date,
    calls_made, appts_set, referrals_given, recruiting_convos, sales_count, premium_cents,
    follow_ups_due, follow_ups_done,
    out_connected, out_voicemail, out_no_answer, out_appt_set, out_not_interested,
    src_warm_market, src_referral, src_cold, src_social_media, src_friend, src_other,
    src_existing_client, src_existing_recruit,
    appt_scheduled, appt_held, appt_no_show, appt_rescheduled, appt_cancelled, updated_at
  )
  select p_agent, v_org, p_date,
    coalesce(c.n,0), coalesce(c.appt_set,0), coalesce(ap.refs,0), coalesce(rc.n,0),
    coalesce(s.n,0), coalesce(s.prem,0),
    coalesce(fu.due,0), coalesce(fu.done,0),
    coalesce(c.connected,0), coalesce(c.voicemail,0), coalesce(c.no_answer,0),
    coalesce(c.appt_set,0), coalesce(c.not_int,0),
    coalesce(c.warm,0), coalesce(c.refr,0), coalesce(c.cold,0),
    coalesce(c.social,0), coalesce(c.friend,0), coalesce(c.other,0),
    coalesce(c.exist_client,0), coalesce(c.exist_recruit,0),
    coalesce(ap.sched,0), coalesce(ap.held,0), coalesce(ap.noshow,0),
    coalesce(ap.resched,0), coalesce(ap.cancel,0), now()
  from (select 1) z
  left join lateral (
    select count(*) n,
      count(*) filter (where outcome='connected')        connected,
      count(*) filter (where outcome='voicemail')        voicemail,
      count(*) filter (where outcome='no_answer')        no_answer,
      count(*) filter (where outcome='appointment_set')  appt_set,
      count(*) filter (where outcome='not_interested')   not_int,
      count(*) filter (where source='warm_market')       warm,
      count(*) filter (where source='referral')          refr,
      count(*) filter (where source='cold')              cold,
      count(*) filter (where source='social_media')      social,
      count(*) filter (where source='friend')            friend,
      count(*) filter (where source='other')             other,
      count(*) filter (where source='existing_client')   exist_client,
      count(*) filter (where source='existing_recruit')  exist_recruit
    from public.call_logs where agent_id=p_agent and call_date=p_date
  ) c on true
  left join lateral (
    select coalesce(sum(referrals_given),0) refs,
      count(*) filter (where status='scheduled')   sched,
      count(*) filter (where status='held')        held,
      count(*) filter (where status='no_show')     noshow,
      count(*) filter (where status='rescheduled') resched,
      count(*) filter (where status='cancelled')   cancel
    from public.appointments where agent_id=p_agent and appt_date=p_date
  ) ap on true
  left join lateral (
    select count(*) n, coalesce(sum(premium_cents),0) prem
    from public.sales where agent_id=p_agent and sale_date=p_date
  ) s on true
  left join lateral (
    select count(*) n from public.recruiting_logs
    where agent_id=p_agent and log_date=p_date
  ) rc on true
  left join lateral (
    select count(*) filter (where follow_up_on=p_date) due,
           count(*) filter (where follow_up_on=p_date and follow_up_done_at is not null) done
    from public.call_logs where agent_id=p_agent
  ) fu on true
  on conflict (agent_id, activity_date) do update set
    calls_made=excluded.calls_made, appts_set=excluded.appts_set,
    referrals_given=excluded.referrals_given, recruiting_convos=excluded.recruiting_convos,
    sales_count=excluded.sales_count, premium_cents=excluded.premium_cents,
    follow_ups_due=excluded.follow_ups_due, follow_ups_done=excluded.follow_ups_done,
    out_connected=excluded.out_connected, out_voicemail=excluded.out_voicemail,
    out_no_answer=excluded.out_no_answer, out_appt_set=excluded.out_appt_set,
    out_not_interested=excluded.out_not_interested,
    src_warm_market=excluded.src_warm_market, src_referral=excluded.src_referral,
    src_cold=excluded.src_cold, src_social_media=excluded.src_social_media,
    src_friend=excluded.src_friend, src_other=excluded.src_other,
    src_existing_client=excluded.src_existing_client, src_existing_recruit=excluded.src_existing_recruit,
    appt_scheduled=excluded.appt_scheduled, appt_held=excluded.appt_held,
    appt_no_show=excluded.appt_no_show, appt_rescheduled=excluded.appt_rescheduled,
    appt_cancelled=excluded.appt_cancelled, updated_at=now();

  delete from public.daily_metrics
  where agent_id=p_agent and activity_date=p_date
    and calls_made=0 and appts_set=0 and sales_count=0 and recruiting_convos=0
    and follow_ups_due=0;
end $$;

-- Backfill: recompute appts_set for every existing daily_metrics row under
-- the new definition. This is a real, intended change to historical numbers
-- -- see the header comment above.
-- (out_appt_set already used this exact definition, so it needs no backfill.)
update public.daily_metrics m
set appts_set = coalesce((
  select count(*) from public.call_logs cl
  where cl.agent_id = m.agent_id
    and cl.call_date = m.activity_date
    and cl.outcome = 'appointment_set'
), 0);

-- Postgres cannot change a function's OUT column list via CREATE OR REPLACE.
drop function if exists "public"."my_followups"("p_as_of" "date");

CREATE FUNCTION "public"."my_followups"("p_as_of" "date" DEFAULT CURRENT_DATE) RETURNS TABLE(
    "call_id" "uuid", "contact_id" "uuid", "contact_name" "text", "last_note" "text",
    "kind" "text", "due_date" "date", "appointment_at" timestamp with time zone,
    "days_late" integer, "times_called" integer
)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with me as (
    select time_zone from public.agents where id = (select auth.uid())
  )
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

  select cl.id, ct.id, ct.full_name, cl.notes,
         'appointment'::text,
         (cl.appointment_at at time zone coalesce((select time_zone from me), 'America/New_York'))::date,
         cl.appointment_at,
         (p_as_of - (cl.appointment_at at time zone coalesce((select time_zone from me), 'America/New_York'))::date)::int,
         (select count(*)::int from public.call_logs x where x.contact_id = ct.id)
  from public.call_logs cl
  join public.contacts ct on ct.id = cl.contact_id
  where cl.agent_id = (select auth.uid())
    and cl.appointment_at is not null
    and cl.appointment_done_at is null
    and (cl.appointment_at at time zone coalesce((select time_zone from me), 'America/New_York'))::date <= p_as_of

  order by 6, 7 nulls first;
$$;

ALTER FUNCTION "public"."my_followups"("p_as_of" "date") OWNER TO "postgres";

-- DROP FUNCTION discards prior grants; restore them exactly as before,
-- naming anon/authenticated explicitly per CLAUDE.md rule 4 rather than
-- relying on a bare REVOKE ... FROM PUBLIC.
REVOKE ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") TO "service_role";

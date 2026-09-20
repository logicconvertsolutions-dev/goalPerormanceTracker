-- P25 Phase A -- metrics integrity. DB only: no schema change, no app
-- change, no UI change. Three function bodies and a re-drive of the read
-- model. Full context in
-- `.github/Spec Sheets/12-appointment-lifecycle-remediation.md`.
--
-- Fixes F1, F2, F3 and F5. F4 (double counting across call_logs and
-- appointments) is explicitly NOT fixed here -- see the note at the bottom
-- of this header.
--
-- ---------------------------------------------------------------------
-- F1 -- the delete guard dropped appointment-only days (DATA LOSS)
--
-- recompute_day ends by deleting a daily_metrics row whose counters are all
-- zero. That guard named only five of them: calls_made, appts_set,
-- sales_count, recruiting_convos, follow_ups_due. Since P23/P24 narrowed
-- appts_set so a *resolved* appointment contributes to none of the five, a
-- day whose only activity was marking an appointment held/no_show/
-- cancelled/rescheduled had the row inserted and then immediately deleted
-- again on the next statement -- taking appt_* and referrals_given with it.
-- An evening appointment on a day with no calls logged simply vanished.
--
-- Rewritten generically instead of as a longer hand-written list, because
-- "a counter column the guard doesn't know about" is precisely the class of
-- bug this was: any numeric column added to daily_metrics in future is now
-- covered with no further action.
--
-- ---------------------------------------------------------------------
-- F2 -- retention purge destroyed historical metrics (DATA LOSS)
--
-- purge_old_call_logs deletes aged call_logs. That fires the
-- call_logs_metrics AFTER DELETE trigger, which re-marks the purged day
-- dirty, which recomputes it from rows that no longer exist -- zeroing it --
-- and then F1's guard removed the row entirely. The read model exists
-- precisely so aggregates outlive raw-row purging.
-- organizations.call_log_retention_months defaults to 24 NOT NULL, so this
-- was armed for every org, not opt-in.
--
-- Fix: purge_old_call_logs sets a transaction-local GUC that enqueue_metrics
-- checks and honours by skipping the mark. Transaction-local (set_config's
-- third argument is true) so it cannot leak into an unrelated session, and
-- it is set only by the purge -- an ordinary user deleting a call log still
-- recomputes normally.
--
-- ---------------------------------------------------------------------
-- F3 -- appts_set eroded retroactively
--
-- P24 counted the appointments half of appts_set as rows *currently* in
-- status='scheduled'. A state filter is not an event count: resolving an
-- appointment removed it from the filter and so retroactively erased the
-- "set" event that created it. Book three on Monday, work them by Friday,
-- and Monday's Appts Set read 0. Appts Held could exceed Appts Set, and a
-- closed cycle's numbers changed after the fact.
--
-- Fix: count the booking event, regardless of what the appointment later
-- became.
--
-- ---------------------------------------------------------------------
-- F5 -- imported appointments counted on the import day
--
-- commit-import.ts never sets created_at, so it defaults to now(). Bucketing
-- the appointments half by created_at meant importing historical rows spiked
-- *today's* Appts Set by however many were still "Scheduled".
--
-- Fixed in the metric (bucket imported rows by appt_date) rather than by
-- rewriting their created_at. This deviates from the plan's §5 Phase A step,
-- deliberately: mutating created_at would destroy the record of when the
-- import ran, and would make this migration irreversible. As written, Phase
-- A remains a pure function swap with no app change at all, and Phase B's
-- `set_on` backfill uses this same rule.
--
-- ---------------------------------------------------------------------
-- NOT FIXED HERE: F4 -- double counting
--
-- appts_set still counts a call log with outcome='appointment_set' AND a
-- separately-created appointments row as two. Correctly deduping them needs
-- appointments.source_call_log_id, which lands in Phase B. The only Phase-A
-- alternative would be matching heuristically on (contact, appointment_at) --
-- rejected, because updateAppointmentAction nulls appointment_at on
-- resolution (F8), so the match would break on resolve and the number would
-- flap between 2 and 1 as an appointment moved through its lifecycle. A
-- stable wrong number is easier to reason about than an unstable one, and
-- Phase B fixes it properly at rest rather than on every recompute.
--
-- 007_appointment_lifecycle.sql pins this deferral explicitly.
--
-- ---------------------------------------------------------------------
-- REBUILD STRATEGY
--
-- This migration deliberately does NOT hand-write an UPDATE over
-- daily_metrics the way the P23 and P24 backfills did. A hand-written
-- backfill is a second, parallel definition of the metric that can silently
-- disagree with recompute_day -- and keeping those two in step is exactly
-- what went wrong twice already.
--
-- Instead it marks the affected agent-days dirty and lets the existing
-- drain-metrics cron rebuild them through recompute_day itself. One
-- definition, no divergence possible, and the rebuild happens at the
-- pipeline's existing rate (1000 agent-days/minute) rather than in one long
-- locking transaction.
--
-- Operator note: the rebuild is complete when private.metrics_dirty is
-- empty. To finish it immediately instead of waiting for the cron:
--     select public.drain_metrics(10000);  -- repeat until it returns 0
-- Take scripts/metrics-snapshot.sql before and after, and diff.

-- ---------------------------------------------------------------------
-- 1. enqueue_metrics -- honour the purge guard (F2)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."enqueue_metrics"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare d_old date; d_new date; s_old date; s_new date; v_tz text;
begin
  -- F2: set only by private.purge_old_call_logs(), only for the duration of
  -- its own transaction. Retention deletes raw rows on purpose; it must not
  -- also rewrite the aggregate that outlives them.
  if coalesce(current_setting('kautis.purging', true), '') = 'on' then
    return null;
  end if;

  if tg_table_name = 'call_logs' then
    d_old := (case when tg_op <> 'INSERT' then old.call_date end);
    d_new := (case when tg_op <> 'DELETE' then new.call_date end);
  elsif tg_table_name = 'appointments' then
    d_old := (case when tg_op <> 'INSERT' then old.appt_date end);
    d_new := (case when tg_op <> 'DELETE' then new.appt_date end);
    -- The appointments half of appts_set is bucketed by the booking day
    -- (see private.recompute_day), which differs from appt_date whenever an
    -- appointment is booked for a later date -- mark that day dirty too, or
    -- it never gets recomputed. (Not coalesce(new.agent_id, old.agent_id):
    -- NEW isn't assigned on DELETE nor OLD on INSERT, so this picks the one
    -- that actually exists.)
    if tg_op = 'DELETE' then
      select coalesce(time_zone, 'America/New_York') into v_tz from public.agents where id = old.agent_id;
      s_old := case when old.import_row_hash is not null
                    then old.appt_date
                    else (old.created_at at time zone v_tz)::date end;
    else
      select coalesce(time_zone, 'America/New_York') into v_tz from public.agents where id = new.agent_id;
      s_new := case when new.import_row_hash is not null
                    then new.appt_date
                    else (new.created_at at time zone v_tz)::date end;
      if tg_op = 'UPDATE' then
        s_old := case when old.import_row_hash is not null
                      then old.appt_date
                      else (old.created_at at time zone v_tz)::date end;
      end if;
    end if;
  elsif tg_table_name = 'sales' then
    d_old := (case when tg_op <> 'INSERT' then old.sale_date end);
    d_new := (case when tg_op <> 'DELETE' then new.sale_date end);
  else
    d_old := (case when tg_op <> 'INSERT' then old.log_date end);
    d_new := (case when tg_op <> 'DELETE' then new.log_date end);
  end if;

  if tg_op <> 'INSERT' then perform private.mark_dirty(old.agent_id, d_old); end if;
  if tg_op <> 'DELETE' then perform private.mark_dirty(new.agent_id, d_new); end if;
  if s_old is not null then perform private.mark_dirty(old.agent_id, s_old); end if;
  if s_new is not null then perform private.mark_dirty(new.agent_id, s_new); end if;
  return null;
end $$;


-- ---------------------------------------------------------------------
-- 2. purge_old_call_logs -- set the guard (F2)
--    Body otherwise identical to the baseline definition.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "private"."purge_old_call_logs"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_count int;
begin
  -- Transaction-local (third argument true): cannot leak to another session,
  -- and is cleared when this function's transaction ends.
  perform set_config('kautis.purging', 'on', true);

  with doomed as (
    delete from public.call_logs cl
    using public.organizations o
    where cl.org_id = o.id
      and o.call_log_retention_months is not null
      and cl.call_date < current_date - (o.call_log_retention_months || ' months')::interval
      and not exists (
        select 1 from public.sales s where s.contact_id = cl.contact_id
      )
    returning cl.id
  )
  select count(*) into v_count from doomed;

  insert into public.audit_log (action, entity, metadata)
  values ('retention.call_logs_purged', 'call_logs', jsonb_build_object('rows_deleted', v_count));

  return v_count;
end $$;


-- ---------------------------------------------------------------------
-- 3. recompute_day -- corrected appts_set (F3, F5) and delete guard (F1)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "private"."recompute_day"("p_agent" "uuid", "p_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_org uuid; v_tz text;
begin
  select a.org_id, coalesce(a.time_zone, 'America/New_York') into v_org, v_tz
  from public.agents a where a.id = p_agent;
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
    coalesce(c.n,0), coalesce(c.appt_set,0) + coalesce(apset.n,0), coalesce(ap.refs,0), coalesce(rc.n,0),
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
    -- Status counts stay bucketed by appt_date, unchanged.
    select coalesce(sum(referrals_given),0) refs,
      count(*) filter (where status='scheduled')   sched,
      count(*) filter (where status='held')        held,
      count(*) filter (where status='no_show')     noshow,
      count(*) filter (where status='rescheduled') resched,
      count(*) filter (where status='cancelled')   cancel
    from public.appointments where agent_id=p_agent and appt_date=p_date
  ) ap on true
  left join lateral (
    -- F3: count the BOOKING EVENT, not the current state. P24 filtered on
    -- status='scheduled' here, so resolving an appointment erased the
    -- appts_set it had created. An appointment that was booked was booked,
    -- whatever it later became.
    --
    -- F5: bucketed by the day the booking happened -- created_at in the
    -- agent's own zone, except for imported rows, whose created_at is the
    -- bulk-import timestamp and would otherwise pile every historical
    -- appointment onto the import day.
    select count(*) n
    from public.appointments
    where agent_id = p_agent
      and case when import_row_hash is not null
               then appt_date
               else (created_at at time zone v_tz)::date
          end = p_date
  ) apset on true
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

  -- F1: drop the row only when EVERY counter is zero. The previous guard
  -- hand-listed five columns and so silently discarded days whose only
  -- activity was a resolved appointment. Driven off the row's own shape
  -- instead, so a counter column added later is covered automatically.
  -- The excluded keys are the row's identity and bookkeeping, not counters.
  delete from public.daily_metrics d
  where d.agent_id = p_agent
    and d.activity_date = p_date
    and not exists (
      select 1
      from jsonb_each(to_jsonb(d)) as kv(key, value)
      where kv.key not in ('agent_id', 'org_id', 'activity_date', 'updated_at')
        and jsonb_typeof(kv.value) = 'number'
        and (kv.value #>> '{}')::numeric <> 0
    );
end $$;


-- ---------------------------------------------------------------------
-- 4. Rebuild. Mark every agent-day whose numbers can change under the
--    corrected definitions, and let drain-metrics recompute them through
--    recompute_day itself -- see REBUILD STRATEGY above.
-- ---------------------------------------------------------------------

-- 4a. Every day that already has a row: appts_set may change (F3/F5), and
--     rows that should never have survived are cleaned up.
insert into private.metrics_dirty (agent_id, activity_date)
select agent_id, activity_date from public.daily_metrics
on conflict do nothing;

-- 4b. Every day an appointment counts on, by either rule. This is what
--     recovers the days F1 destroyed: they have no daily_metrics row to
--     find them by, so they have to come from the appointments themselves.
insert into private.metrics_dirty (agent_id, activity_date)
select ap.agent_id, ap.appt_date
from public.appointments ap
on conflict do nothing;

insert into private.metrics_dirty (agent_id, activity_date)
select ap.agent_id,
       case when ap.import_row_hash is not null
            then ap.appt_date
            else (ap.created_at at time zone coalesce(a.time_zone, 'America/New_York'))::date
       end
from public.appointments ap
join public.agents a on a.id = ap.agent_id
on conflict do nothing;

-- 4c. Days carrying an appointment-setting call, for the same reason.
insert into private.metrics_dirty (agent_id, activity_date)
select cl.agent_id, cl.call_date
from public.call_logs cl
where cl.outcome = 'appointment_set'
on conflict do nothing;

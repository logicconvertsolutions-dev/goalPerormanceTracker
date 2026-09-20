-- P24: three follow-ups to P23, all requested together --
--
--   1. Revert removing "Scheduled" as a status an agent can pick when
--      logging an appointment by hand -- in-person appointments are
--      routinely scheduled face to face, not from a phone call, so the
--      call-log-only path P23 introduced was too narrow. appointment-
--      form.tsx / appointment-row.tsx revert to offering all five statuses
--      again (application code only, nothing to migrate for that alone).
--
--   2. Since "Scheduled" is back, appointments.appointment_at is added
--      (mirrors call_logs.appointment_at from P23): when an agent logs an
--      appointment with status "Scheduled" they now give its real date AND
--      time, which -- unlike every other status -- is allowed to be in the
--      future (application-layer check in appointments/actions.ts).
--      appt_date keeps being NOT NULL and keeps being what appt_scheduled/
--      appt_held/appt_no_show/etc bucket by (it's just derived from
--      appointment_at's own date part for a "Scheduled" row instead of
--      typed in directly).
--
--   3. appts_set now counts from BOTH logs, per the request: the call_logs
--      outcome='appointment_set' count P23 already computed (unchanged),
--      PLUS appointments logged directly with status='scheduled'. The
--      second half is bucketed by the day the appointments row was
--      *created* (created_at, in the agent's own zone), not by appt_date --
--      appt_date can now be a future date for a "Scheduled" row, and
--      bucketing appts_set by it would reproduce the exact P23 bug (an
--      appointment set today wouldn't show up in today's Appts Set, it'd
--      show up on whatever future day it's for). enqueue_metrics is updated
--      to mark that created_at day dirty too, alongside appt_date -- without
--      that, a freshly scheduled future appointment would only ever
--      recompute its future day and never touch the day it should actually
--      count on.
--
--      This also backfills every existing daily_metrics row's appts_set
--      under the combined definition -- a real, intended change to
--      historical numbers, same as P23's backfill.
--
-- Side effect this surfaces, fixed here too: agent_aggregate and
-- team_breakdown sum daily_metrics over a whole [p_from, p_to] period,
-- and periods like "Current Cycle"/"This Month" routinely extend a few
-- days into the future (the cycle/month isn't over yet). Before this
-- migration that was harmless -- a future date could never have a nonzero
-- daily_metrics row, since nothing can be logged for a day that hasn't
-- happened. Now a "Scheduled" appointment CAN put a nonzero appt_scheduled
-- on a future date's row immediately (its own appt_date), which would
-- otherwise leak into the current period's totals before that day
-- arrives -- inflating the No-Show Rate denominator
-- (dashboard-view-model.ts: appt_scheduled + appt_held + appt_no_show +
-- appt_rescheduled + appt_cancelled) with appointments that haven't
-- happened yet and diluting the rate. Fix: both RPCs now exclude any
-- activity_date beyond today (current_date; a server-UTC clamp, not
-- per-agent-zone-exact, but this only guards against future dates leaking
-- in at all, not a precise "today" calculation).
--
-- appts_set itself doesn't have this problem post-fix: its appointments-side
-- contribution is bucketed by created_at (never future), so it never lands
-- on a future day in the first place.

alter table "public"."appointments"
  add column if not exists "appointment_at" timestamp with time zone;

CREATE OR REPLACE FUNCTION "public"."enqueue_metrics"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare d_old date; d_new date; s_old date; s_new date; v_tz text;
begin
  if tg_table_name = 'call_logs' then
    d_old := (case when tg_op <> 'INSERT' then old.call_date end);
    d_new := (case when tg_op <> 'DELETE' then new.call_date end);
  elsif tg_table_name = 'appointments' then
    d_old := (case when tg_op <> 'INSERT' then old.appt_date end);
    d_new := (case when tg_op <> 'DELETE' then new.appt_date end);
    -- appts_set's appointments-side contribution is bucketed by the day the
    -- row was created (see private.recompute_day), which can differ from
    -- appt_date now that a "Scheduled" row's appt_date is a future date --
    -- mark that day dirty too, or it never gets recomputed. (Not
    -- coalesce(new.agent_id, old.agent_id): NEW isn't assigned on DELETE nor
    -- OLD on INSERT, so this picks the one that actually exists instead.)
    if tg_op = 'DELETE' then
      select coalesce(time_zone, 'America/New_York') into v_tz from public.agents where id = old.agent_id;
    else
      select coalesce(time_zone, 'America/New_York') into v_tz from public.agents where id = new.agent_id;
    end if;
    s_old := (case when tg_op <> 'INSERT' then (old.created_at at time zone v_tz)::date end);
    s_new := (case when tg_op <> 'DELETE' then (new.created_at at time zone v_tz)::date end);
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
    select coalesce(sum(referrals_given),0) refs,
      count(*) filter (where status='scheduled')   sched,
      count(*) filter (where status='held')        held,
      count(*) filter (where status='no_show')     noshow,
      count(*) filter (where status='rescheduled') resched,
      count(*) filter (where status='cancelled')   cancel
    from public.appointments where agent_id=p_agent and appt_date=p_date
  ) ap on true
  left join lateral (
    -- The appointments-side half of appts_set: a "Scheduled" row set today
    -- (created_at) but dated for later (appt_date) still counts as set
    -- today, not on the future day it's for.
    select count(*) filter (where status='scheduled') n
    from public.appointments
    where agent_id=p_agent
      and (created_at at time zone v_tz)::date = p_date
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

  delete from public.daily_metrics
  where agent_id=p_agent and activity_date=p_date
    and calls_made=0 and appts_set=0 and sales_count=0 and recruiting_convos=0
    and follow_ups_due=0;
end $$;

-- Backfill: recompute appts_set for every existing daily_metrics row under
-- the combined (call log + appointments) definition. Recomputed fully from
-- scratch from both sources rather than "added to" the P23 value, so this
-- is correct regardless of migration application order.
update public.daily_metrics m
set appts_set = coalesce((
  select count(*) from public.call_logs cl
  where cl.agent_id = m.agent_id
    and cl.call_date = m.activity_date
    and cl.outcome = 'appointment_set'
), 0) + coalesce((
  select count(*) from public.appointments ap
  where ap.agent_id = m.agent_id
    and ap.status = 'scheduled'
    and (ap.created_at at time zone coalesce(
      (select a.time_zone from public.agents a where a.id = m.agent_id), 'America/New_York'
    ))::date = m.activity_date
), 0);

-- No-show rate fix: exclude any date beyond today from these two period
-- totals so a future-dated "Scheduled" appointment can't inflate a
-- current period's denominator before that day arrives (see header).
CREATE OR REPLACE FUNCTION "public"."agent_aggregate"("p_agent_id" "uuid", "p_from" "date", "p_to" "date") RETURNS TABLE("calls_made" integer, "appts_set" integer, "appts_held" integer, "sales_count" integer, "premium_cents" bigint, "referrals_given" integer, "recruiting_convos" integer, "out_connected" integer, "out_voicemail" integer, "out_no_answer" integer, "out_appt_set" integer, "out_not_interested" integer, "src_warm_market" integer, "src_referral" integer, "src_cold" integer, "src_social_media" integer, "src_friend" integer, "src_other" integer, "src_existing_client" integer, "src_existing_recruit" integer, "appt_scheduled" integer, "appt_held" integer, "appt_no_show" integer, "appt_rescheduled" integer, "appt_cancelled" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    coalesce(sum(calls_made),0)::int, coalesce(sum(appts_set),0)::int,
    coalesce(sum(appt_held),0)::int, coalesce(sum(sales_count),0)::int,
    coalesce(sum(premium_cents),0)::bigint, coalesce(sum(referrals_given),0)::int,
    coalesce(sum(recruiting_convos),0)::int,
    coalesce(sum(out_connected),0)::int, coalesce(sum(out_voicemail),0)::int,
    coalesce(sum(out_no_answer),0)::int, coalesce(sum(out_appt_set),0)::int,
    coalesce(sum(out_not_interested),0)::int,
    coalesce(sum(src_warm_market),0)::int, coalesce(sum(src_referral),0)::int,
    coalesce(sum(src_cold),0)::int, coalesce(sum(src_social_media),0)::int,
    coalesce(sum(src_friend),0)::int, coalesce(sum(src_other),0)::int,
    coalesce(sum(src_existing_client),0)::int, coalesce(sum(src_existing_recruit),0)::int,
    coalesce(sum(appt_scheduled),0)::int, coalesce(sum(appt_held),0)::int,
    coalesce(sum(appt_no_show),0)::int, coalesce(sum(appt_rescheduled),0)::int,
    coalesce(sum(appt_cancelled),0)::int
  from public.daily_metrics
  where agent_id = p_agent_id
    and activity_date >= p_from
    and activity_date <= least(p_to, current_date)
    and (select private.is_upline_of(p_agent_id));
$$;

CREATE OR REPLACE FUNCTION "public"."team_breakdown"("p_from" "date", "p_to" "date", "p_agent_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("calls_made" integer, "appts_set" integer, "appts_held" integer, "sales_count" integer, "premium_cents" bigint, "referrals_given" integer, "recruiting_convos" integer, "out_connected" integer, "out_voicemail" integer, "out_no_answer" integer, "out_appt_set" integer, "out_not_interested" integer, "src_warm_market" integer, "src_referral" integer, "src_cold" integer, "src_social_media" integer, "src_friend" integer, "src_other" integer, "src_existing_client" integer, "src_existing_recruit" integer, "appt_scheduled" integer, "appt_held" integer, "appt_no_show" integer, "appt_rescheduled" integer, "appt_cancelled" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    coalesce(sum(calls_made),0)::int, coalesce(sum(appts_set),0)::int,
    coalesce(sum(appt_held),0)::int, coalesce(sum(sales_count),0)::int,
    coalesce(sum(premium_cents),0)::bigint, coalesce(sum(referrals_given),0)::int,
    coalesce(sum(recruiting_convos),0)::int,
    coalesce(sum(out_connected),0)::int, coalesce(sum(out_voicemail),0)::int,
    coalesce(sum(out_no_answer),0)::int, coalesce(sum(out_appt_set),0)::int,
    coalesce(sum(out_not_interested),0)::int,
    coalesce(sum(src_warm_market),0)::int, coalesce(sum(src_referral),0)::int,
    coalesce(sum(src_cold),0)::int, coalesce(sum(src_social_media),0)::int,
    coalesce(sum(src_friend),0)::int, coalesce(sum(src_other),0)::int,
    coalesce(sum(src_existing_client),0)::int, coalesce(sum(src_existing_recruit),0)::int,
    coalesce(sum(appt_scheduled),0)::int, coalesce(sum(appt_held),0)::int,
    coalesce(sum(appt_no_show),0)::int, coalesce(sum(appt_rescheduled),0)::int,
    coalesce(sum(appt_cancelled),0)::int
  from public.daily_metrics
  where agent_id in (select private.my_downline())
    and (p_agent_ids is null or agent_id = any(p_agent_ids))
    and activity_date >= p_from
    and activity_date <= least(p_to, current_date);
$$;

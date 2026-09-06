-- P15b: teach the daily_metrics pipeline and the two breakdown RPCs about
-- the 'existing_client'/'existing_recruit' call sources added (schema-only)
-- in P15a. Split from P15a because a new enum value can't be referenced by
-- the same transaction that adds it.

-- Recompute one agent-day from scratch, now also counting the two new
-- sources -- same full-rebuild shape as 20260818132731_p1g, just two more
-- lateral-aggregate columns.
create or replace function private.recompute_day(p_agent uuid, p_date date)
returns void language plpgsql security definer set search_path = '' as $$
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
    coalesce(c.n,0), coalesce(ap.n,0), coalesce(ap.refs,0), coalesce(rc.n,0),
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
    select count(*) n, coalesce(sum(referrals_given),0) refs,
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

-- Return-type change (two new output columns) needs a drop first --
-- create or replace can't alter a RETURNS TABLE shape.
drop function if exists public.agent_aggregate(uuid, date, date);
create or replace function public.agent_aggregate(
  p_agent_id uuid, p_from date, p_to date)
returns table (
  calls_made int, appts_set int, appts_held int, sales_count int,
  premium_cents bigint, referrals_given int, recruiting_convos int,
  out_connected int, out_voicemail int, out_no_answer int,
  out_appt_set int, out_not_interested int,
  src_warm_market int, src_referral int, src_cold int,
  src_social_media int, src_friend int, src_other int,
  src_existing_client int, src_existing_recruit int,
  appt_scheduled int, appt_held int, appt_no_show int,
  appt_rescheduled int, appt_cancelled int
) language sql stable security definer set search_path = '' as $$
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
    and activity_date between p_from and p_to
    and (select private.is_upline_of(p_agent_id));
$$;
revoke all on function public.agent_aggregate(uuid, date, date) from public, anon;
grant execute on function public.agent_aggregate(uuid, date, date) to authenticated;

drop function if exists public.team_breakdown(date, date, uuid[]);
create or replace function public.team_breakdown(
  p_from date, p_to date, p_agent_ids uuid[] default null
)
returns table (
  calls_made int, appts_set int, appts_held int, sales_count int,
  premium_cents bigint, referrals_given int, recruiting_convos int,
  out_connected int, out_voicemail int, out_no_answer int,
  out_appt_set int, out_not_interested int,
  src_warm_market int, src_referral int, src_cold int,
  src_social_media int, src_friend int, src_other int,
  src_existing_client int, src_existing_recruit int,
  appt_scheduled int, appt_held int, appt_no_show int,
  appt_rescheduled int, appt_cancelled int
) language sql stable security definer set search_path = '' as $$
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
    and activity_date between p_from and p_to;
$$;
revoke all on function public.team_breakdown(date, date, uuid[]) from public, anon;
grant execute on function public.team_breakdown(date, date, uuid[]) to authenticated;

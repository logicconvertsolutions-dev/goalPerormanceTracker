-- READ MODEL. Every dashboard reads this; nothing reads raw logs for metrics.
-- One row per agent per day. 200 agents is ~73k rows/year.
-- Wide rather than a breakdown table: every chart then comes from one indexed
-- row per day with no join.
create table public.daily_metrics (
  agent_id      uuid not null references public.agents(id) on delete cascade,
  org_id        uuid not null references public.organizations(id),
  activity_date date not null,
  calls_made    int not null default 0,
  appts_set     int not null default 0,
  referrals_given int not null default 0,
  recruiting_convos int not null default 0,
  sales_count   int not null default 0,
  premium_cents bigint not null default 0,
  follow_ups_due  int not null default 0,
  follow_ups_done int not null default 0,
  -- Breakdown counts drive the donuts and bars. out_connected IS the connect
  -- count; appt_held IS appointments held. No duplicate columns: two columns
  -- holding the same number is how they end up disagreeing.
  out_connected int not null default 0,
  out_voicemail int not null default 0,
  out_no_answer int not null default 0,
  out_appt_set  int not null default 0,
  out_not_interested int not null default 0,
  src_warm_market int not null default 0,
  src_referral    int not null default 0,
  src_cold        int not null default 0,
  src_social_media int not null default 0,
  src_friend      int not null default 0,
  src_other       int not null default 0,
  appt_scheduled   int not null default 0,
  appt_held        int not null default 0,
  appt_no_show     int not null default 0,
  appt_rescheduled int not null default 0,
  appt_cancelled   int not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (agent_id, activity_date)
);
create index daily_metrics_org_date_idx on public.daily_metrics (org_id, activity_date);
create index daily_metrics_date_idx on public.daily_metrics (activity_date);

create table private.metrics_dirty (
  agent_id      uuid not null,
  activity_date date not null,
  primary key (agent_id, activity_date)
);
revoke all on private.metrics_dirty from anon, authenticated;

create or replace function private.mark_dirty(p_agent uuid, p_date date)
returns void language sql security definer set search_path = '' as $$
  insert into private.metrics_dirty (agent_id, activity_date)
  values (p_agent, p_date) on conflict do nothing;
$$;

create or replace function public.enqueue_metrics()
returns trigger language plpgsql security definer set search_path = '' as $$
declare d_old date; d_new date;
begin
  if tg_table_name = 'call_logs' then
    d_old := (case when tg_op <> 'INSERT' then old.call_date end);
    d_new := (case when tg_op <> 'DELETE' then new.call_date end);
  elsif tg_table_name = 'appointments' then
    d_old := (case when tg_op <> 'INSERT' then old.appt_date end);
    d_new := (case when tg_op <> 'DELETE' then new.appt_date end);
  elsif tg_table_name = 'sales' then
    d_old := (case when tg_op <> 'INSERT' then old.sale_date end);
    d_new := (case when tg_op <> 'DELETE' then new.sale_date end);
  else
    d_old := (case when tg_op <> 'INSERT' then old.log_date end);
    d_new := (case when tg_op <> 'DELETE' then new.log_date end);
  end if;

  if tg_op <> 'INSERT' then perform private.mark_dirty(old.agent_id, d_old); end if;
  if tg_op <> 'DELETE' then perform private.mark_dirty(new.agent_id, d_new); end if;
  return null;
end $$;

create trigger call_logs_metrics after insert or update or delete on public.call_logs
  for each row execute function public.enqueue_metrics();
create trigger appointments_metrics after insert or update or delete on public.appointments
  for each row execute function public.enqueue_metrics();
create trigger sales_metrics after insert or update or delete on public.sales
  for each row execute function public.enqueue_metrics();
create trigger recruiting_metrics after insert or update or delete on public.recruiting_logs
  for each row execute function public.enqueue_metrics();

-- Recompute one agent-day from scratch. ~12 rows. Idempotent by construction:
-- incremental +1/-1 deltas drift silently on deletes, date edits, and rollbacks,
-- with no way to detect it afterwards.
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
      count(*) filter (where source='other')             other
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
    appt_scheduled=excluded.appt_scheduled, appt_held=excluded.appt_held,
    appt_no_show=excluded.appt_no_show, appt_rescheduled=excluded.appt_rescheduled,
    appt_cancelled=excluded.appt_cancelled, updated_at=now();

  delete from public.daily_metrics
  where agent_id=p_agent and activity_date=p_date
    and calls_made=0 and appts_set=0 and sales_count=0 and recruiting_convos=0
    and follow_ups_due=0;
end $$;

-- Drain. Exposed as an RPC so tests can run it synchronously instead of
-- waiting on cron, which would make every E2E test flaky.
create or replace function public.drain_metrics(p_limit int default 500)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in
    delete from private.metrics_dirty
    where (agent_id, activity_date) in (
      select agent_id, activity_date from private.metrics_dirty
      order by activity_date limit p_limit
    )
    returning agent_id, activity_date
  loop
    perform private.recompute_day(r.agent_id, r.activity_date);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.drain_metrics(int) from anon, authenticated;

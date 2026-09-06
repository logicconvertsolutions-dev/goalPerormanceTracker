


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."effective_target"("p_agent_id" "uuid", "p_period_start" "date") RETURNS TABLE("calls_per_cycle" integer, "appts_held_per_cycle" integer, "premium_cents_per_cycle" bigint, "min_calls_per_day" integer, "md_deadline" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with a as (
    select t.* from public.targets t
    where t.agent_id = p_agent_id and t.effective_from <= p_period_start
    order by t.effective_from desc limit 1
  ), o as (
    select t.* from public.targets t
    where t.agent_id is null
      and t.org_id = (select ag.org_id from public.agents ag where ag.id = p_agent_id)
      and t.effective_from <= p_period_start
    order by t.effective_from desc limit 1
  )
  select
    coalesce((select a.calls_per_cycle from a),        (select o.calls_per_cycle from o),        50),
    coalesce((select a.appts_held_per_cycle from a),   (select o.appts_held_per_cycle from o),   3),
    coalesce((select a.premium_cents_per_cycle from a),(select o.premium_cents_per_cycle from o),18800::bigint),
    coalesce((select a.min_calls_per_day from a),      (select o.min_calls_per_day from o),      15),
    coalesce((select a.md_deadline from a),            (select o.md_deadline from o),            null);
$$;


ALTER FUNCTION "private"."effective_target"("p_agent_id" "uuid", "p_period_start" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."enqueue_due_notifications"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_enqueued int := 0;
  rec record;
begin
  for rec in
    with local_now as (
      select
        a.id as agent_id,
        a.role,
        (now() at time zone coalesce(nullif(a.time_zone, ''), 'America/New_York')) as local_ts
      from public.agents a
      where a.status = 'active'
    ),
    candidates as (
      select n.agent_id, n.local_ts::date as local_date, k.kind
      from local_now n
      cross join unnest(array['evening_nudge', 'sunday_summary', 'monday_digest']) as k(kind)
      where
        (k.kind = 'evening_nudge'
         and n.role in ('associate', 'leader')
         and extract(hour from n.local_ts) >= 19)
        or (k.kind = 'sunday_summary'
            and n.role in ('associate', 'leader')
            and extract(hour from n.local_ts) >= 18
            and (
              extract(day from n.local_ts) in (10, 20)
              or n.local_ts::date = (date_trunc('month', n.local_ts) + interval '1 month' - interval '1 day')::date
            ))
        or (k.kind = 'monday_digest'
            and n.role in ('leader', 'admin')
            and extract(day from n.local_ts) in (1, 11, 21)
            and extract(hour from n.local_ts) >= 8
            and extract(hour from n.local_ts) < 19)
    ),
    eligible as (
      select c.agent_id, c.kind, c.local_date
      from candidates c
      left join public.notification_prefs p on p.agent_id = c.agent_id
      where case c.kind
              when 'evening_nudge' then coalesce(p.evening_nudge, true)
              when 'sunday_summary' then coalesce(p.sunday_summary, true)
              else coalesce(p.monday_digest, true)
            end
        and not (
          c.kind = 'evening_nudge'
          and exists (
            select 1 from public.daily_metrics dm
            where dm.agent_id = c.agent_id
              and dm.activity_date = c.local_date
              and (dm.calls_made > 0 or dm.appts_set > 0 or dm.sales_count > 0 or dm.recruiting_convos > 0)
          )
        )
    ),
    claimed as (
      insert into public.notification_log (agent_id, kind, local_date)
      select agent_id, kind, local_date from eligible
      on conflict (agent_id, kind, local_date) do nothing
      returning agent_id, kind, local_date
    )
    select agent_id, kind, local_date from claimed
  loop
    perform pgmq.send('notification_sends', jsonb_build_object(
      'agent_id', rec.agent_id, 'kind', rec.kind, 'local_date', rec.local_date
    ));
    v_enqueued := v_enqueued + 1;
  end loop;

  return v_enqueued;
end $$;


ALTER FUNCTION "private"."enqueue_due_notifications"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_upline_of"("target" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.agent_closure c
    where c.ancestor_id = (select auth.uid())
      and c.descendant_id = target
  );
$$;


ALTER FUNCTION "private"."is_upline_of"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."mark_dirty"("p_agent" "uuid", "p_date" "date") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  insert into private.metrics_dirty (agent_id, activity_date)
  values (p_agent, p_date) on conflict do nothing;
$$;


ALTER FUNCTION "private"."mark_dirty"("p_agent" "uuid", "p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."my_downline"() RETURNS SETOF "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select c.descendant_id from public.agent_closure c
  where c.ancestor_id = (select auth.uid());
$$;


ALTER FUNCTION "private"."my_downline"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."my_org"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select a.org_id from public.agents a where a.id = (select auth.uid());
$$;


ALTER FUNCTION "private"."my_org"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."my_role"() RETURNS "public"."agent_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select a.role from public.agents a where a.id = (select auth.uid());
$$;


ALTER FUNCTION "private"."my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ping_app_route"("p_path" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_base_url text;
  v_secret text;
begin
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'app_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_base_url is null or v_secret is null or v_base_url = '' or v_secret = '' then
    raise notice '[notifications] app_base_url/cron_secret not configured in Vault -- skipping ping to %', p_path;
    return;
  end if;

  perform net.http_post(
    url := v_base_url || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end $$;


ALTER FUNCTION "private"."ping_app_route"("p_path" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ping_legacy_notifications"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.ping_app_route('/api/cron/notifications');
end $$;


ALTER FUNCTION "private"."ping_legacy_notifications"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ping_notification_drain"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform private.ping_app_route('/api/cron/notifications/drain');
end $$;


ALTER FUNCTION "private"."ping_notification_drain"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."purge_old_call_logs"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_count int;
begin
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


ALTER FUNCTION "private"."purge_old_call_logs"() OWNER TO "postgres";


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


ALTER FUNCTION "private"."recompute_day"("p_agent" "uuid", "p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."team_period_summary_for"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") RETURNS TABLE("agent_id" "uuid", "full_name" "text", "depth" integer, "calls_made" integer, "appts_set" integer, "appts_held" integer, "premium_cents" bigint, "calls_target" integer, "appts_held_target" integer, "premium_cents_target" bigint, "pct_calls" numeric, "streak_days" integer, "last_logged_at" timestamp with time zone, "has_override" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with scope as (
    select c.descendant_id id, c.depth
    from public.agent_closure c
    where c.ancestor_id = p_leader_id
  ), agg as (
    select m.agent_id,
           sum(m.calls_made)::int calls, sum(m.appts_set)::int aset,
           sum(m.appt_held)::int aheld, sum(m.premium_cents)::bigint prem,
           max(m.updated_at) last_at
    from public.daily_metrics m
    join scope s on s.id = m.agent_id
    where m.activity_date >= p_from
      and m.activity_date <= p_to
    group by m.agent_id
  ), cycles as (
    select greatest(1.0, (p_to - p_from + 1) / 10.0) as n
  )
  select a.id, a.full_name, s.depth,
         coalesce(g.calls,0), coalesce(g.aset,0), coalesce(g.aheld,0), coalesce(g.prem,0),
         round(t.calls_per_cycle * c.n)::int,
         round(t.appts_held_per_cycle * c.n)::int,
         round(t.premium_cents_per_cycle * c.n)::bigint,
         round(100.0 * coalesce(g.calls,0) / nullif(round(t.calls_per_cycle * c.n), 0), 1),
         (select count(*)::int from public.daily_metrics d
          where d.agent_id = a.id and d.activity_date <= p_to
            and d.calls_made >= t.min_calls_per_day),
         g.last_at,
         exists (
           select 1 from public.targets ov
           where ov.agent_id = a.id and ov.effective_from <= p_from
         )
  from scope s
  join public.agents a on a.id = s.id and a.status = 'active'
  left join agg g on g.agent_id = a.id
  cross join cycles c
  cross join lateral private.effective_target(a.id, p_from) t;
$$;


ALTER FUNCTION "private"."team_period_summary_for"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "private"."metrics_dirty" (
    "agent_id" "uuid" NOT NULL,
    "activity_date" "date" NOT NULL
);


ALTER TABLE "private"."metrics_dirty" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."rate_limits" (
    "rl_key" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "count" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "private"."rate_limits" OWNER TO "postgres";


ALTER TABLE ONLY "private"."metrics_dirty"
    ADD CONSTRAINT "metrics_dirty_pkey" PRIMARY KEY ("agent_id", "activity_date");



ALTER TABLE ONLY "private"."rate_limits"
    ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("rl_key", "window_start");



REVOKE ALL ON FUNCTION "private"."enqueue_due_notifications"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ping_app_route"("p_path" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ping_legacy_notifications"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ping_notification_drain"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."purge_old_call_logs"() FROM PUBLIC;





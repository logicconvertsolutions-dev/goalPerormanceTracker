


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


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE TYPE "public"."agent_role" AS ENUM (
    'associate',
    'leader',
    'admin'
);


ALTER TYPE "public"."agent_role" OWNER TO "postgres";


CREATE TYPE "public"."agent_status" AS ENUM (
    'active',
    'inactive'
);


ALTER TYPE "public"."agent_status" OWNER TO "postgres";


CREATE TYPE "public"."appt_status" AS ENUM (
    'scheduled',
    'held',
    'no_show',
    'rescheduled',
    'cancelled'
);


ALTER TYPE "public"."appt_status" OWNER TO "postgres";


CREATE TYPE "public"."call_outcome" AS ENUM (
    'connected',
    'voicemail',
    'no_answer',
    'appointment_set',
    'not_interested'
);


ALTER TYPE "public"."call_outcome" OWNER TO "postgres";


CREATE TYPE "public"."call_source" AS ENUM (
    'warm_market',
    'referral',
    'cold',
    'social_media',
    'friend',
    'other',
    'existing_client',
    'existing_recruit'
);


ALTER TYPE "public"."call_source" OWNER TO "postgres";


CREATE TYPE "public"."feedback_category" AS ENUM (
    'bug',
    'feature_request',
    'feedback',
    'other'
);


ALTER TYPE "public"."feedback_category" OWNER TO "postgres";


CREATE TYPE "public"."feedback_status" AS ENUM (
    'new',
    'reviewed',
    'resolved'
);


ALTER TYPE "public"."feedback_status" OWNER TO "postgres";


CREATE TYPE "public"."notification_send_status" AS ENUM (
    'queued',
    'sent',
    'failed'
);


ALTER TYPE "public"."notification_send_status" OWNER TO "postgres";


CREATE TYPE "public"."recruit_status" AS ENUM (
    'contacted',
    'marketing_presented',
    'recruited',
    'certified',
    'licensed',
    'declined'
);


ALTER TYPE "public"."recruit_status" OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."admin_create_announcement"("p_actor_id" "uuid", "p_message" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_id uuid;
begin
  insert into public.announcements (message, created_by)
  values (p_message, p_actor_id)
  returning id into v_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
  values (p_actor_id, 'announcement.created', 'announcement', v_id::text,
          jsonb_build_object('message', p_message));
  return v_id;
end $$;


ALTER FUNCTION "public"."admin_create_announcement"("p_actor_id" "uuid", "p_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_daily_active_loggers"("p_days" integer DEFAULT 10) RETURNS TABLE("org_id" "uuid", "org_name" "text", "agent_id" "uuid", "full_name" "text", "activity_date" "date", "logged" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with business_days as (
    select d::date as activity_date
    from generate_series(current_date - (p_days * 2 + 14), current_date, interval '1 day') d
    where extract(isodow from d) < 6
    order by d desc
    limit p_days
  ),
  active_agents as (
    select a.id, a.full_name, a.org_id, o.name as org_name
    from public.agents a
    join public.organizations o on o.id = a.org_id
    where a.status = 'active'
  )
  select aa.org_id, aa.org_name, aa.id, aa.full_name, bd.activity_date,
    exists (
      select 1 from public.daily_metrics m
      where m.agent_id = aa.id and m.activity_date = bd.activity_date
        and (m.calls_made > 0 or m.appts_set > 0 or m.sales_count > 0 or m.recruiting_convos > 0)
    ) as logged
  from active_agents aa
  cross join business_days bd
  order by aa.org_name, aa.full_name, bd.activity_date;
$$;


ALTER FUNCTION "public"."admin_daily_active_loggers"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_delete_org"("p_actor_id" "uuid", "p_org_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_name text; v_agent_count int;
begin
  select name into v_name from public.organizations where id = p_org_id;
  if v_name is null then raise exception 'organization not found'; end if;

  select count(*) into v_agent_count from public.agents where org_id = p_org_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (p_org_id, p_actor_id, 'org.deleted', 'organization', p_org_id::text,
          jsonb_build_object('name', v_name, 'agent_count', v_agent_count));

  -- agents.org_id is ON DELETE RESTRICT (p1b) -- every agent in the org must
  -- go first. auth.users cascades to agents, which cascades to everything
  -- hanging off agent_id (see admin_hard_delete_agent, p6a). One statement,
  -- so cascades from every agent in the org resolve together -- a target row
  -- one agent here set for another agent here is never left dangling.
  delete from auth.users where id in (select id from public.agents where org_id = p_org_id);

  -- Everything left is org_id-scoped directly with its own ON DELETE CASCADE
  -- (targets' org-default row, invitations, team_roster) -- this statement
  -- removes them along with the organizations row itself.
  delete from public.organizations where id = p_org_id;
exception when foreign_key_violation then
  raise exception 'cannot delete: this organization has dependent rows outside the normal cascade (e.g. a target set by one of its agents for someone in a different organization) -- resolve those first';
end $$;


ALTER FUNCTION "public"."admin_delete_org"("p_actor_id" "uuid", "p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_hard_delete_agent"("p_actor_id" "uuid", "p_agent_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_org uuid; v_full_name text;
begin
  if not exists (select 1 from public.agents where id = p_agent_id) then
    raise exception 'agent not found';
  end if;
  select org_id, full_name into v_org, v_full_name from public.agents where id = p_agent_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.hard_deleted', 'agent', p_agent_id::text,
          jsonb_build_object('full_name', v_full_name));

  delete from auth.users where id = p_agent_id;
exception when foreign_key_violation then
  raise exception 'cannot hard-delete: this agent has dependent rows (likely targets they set for someone else) -- reassign those first';
end $$;


ALTER FUNCTION "public"."admin_hard_delete_agent"("p_actor_id" "uuid", "p_agent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_move_agent"("p_actor_id" "uuid", "p_agent_id" "uuid", "p_new_upline_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_org uuid; v_new_upline_org uuid;
begin
  if not exists (select 1 from public.agents where id = p_agent_id) then
    raise exception 'agent not found';
  end if;
  select org_id into v_org from public.agents where id = p_agent_id;

  if p_new_upline_id is not null then
    if not exists (select 1 from public.agents where id = p_new_upline_id) then
      raise exception 'new upline not found';
    end if;
    select org_id into v_new_upline_org from public.agents where id = p_new_upline_id;
    -- The same-org trigger (p1e) and cycle guard already enforce this at
    -- the row level; this check exists purely for a clearer error message.
    if v_new_upline_org is distinct from v_org then
      raise exception 'cannot move an agent to an upline in a different organization';
    end if;
  end if;

  update public.agents set upline_id = p_new_upline_id where id = p_agent_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.upline_moved', 'agent', p_agent_id::text,
          jsonb_build_object('new_upline_id', p_new_upline_id));
end $$;


ALTER FUNCTION "public"."admin_move_agent"("p_actor_id" "uuid", "p_agent_id" "uuid", "p_new_upline_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reactivate_agent"("p_actor_id" "uuid", "p_agent_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_org uuid;
begin
  if not exists (select 1 from public.agents where id = p_agent_id) then
    raise exception 'agent not found';
  end if;
  select org_id into v_org from public.agents where id = p_agent_id;

  update public.agents set status = 'active' where id = p_agent_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.reactivated', 'agent', p_agent_id::text, '{}'::jsonb);
end $$;


ALTER FUNCTION "public"."admin_reactivate_agent"("p_actor_id" "uuid", "p_agent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_agent_role"("p_actor_id" "uuid", "p_agent_id" "uuid", "p_role" "public"."agent_role", "p_org_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_org uuid; v_old_role public.agent_role;
begin
  select org_id, role into v_org, v_old_role from public.agents where id = p_agent_id;
  if v_old_role is null then raise exception 'agent not found'; end if;

  if v_old_role = p_role then return; end if;

  if p_role = 'admin' then
    -- If the promoted agent already led a team, their direct reports can't
    -- stay pointed at an upline who no longer belongs to any org -- surface
    -- them as top-level in their own org instead of silently leaving a
    -- dangling reporting line only agent_closure would still reflect.
    update public.agents set upline_id = null where upline_id = p_agent_id;
    update public.agents set role = p_role, org_id = null, upline_id = null where id = p_agent_id;
  elsif v_org is null then
    -- Leaving admin with no org on file -- the caller must supply one.
    if p_org_id is null then
      raise exception 'reassign this agent to an organization before changing their role';
    end if;
    if not exists (select 1 from public.organizations where id = p_org_id) then
      raise exception 'organization not found';
    end if;
    update public.agents set role = p_role, org_id = p_org_id, upline_id = null where id = p_agent_id;
    v_org := p_org_id;
  else
    update public.agents set role = p_role where id = p_agent_id;
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.role_changed', 'agent', p_agent_id::text,
          jsonb_build_object('old_role', v_old_role, 'new_role', p_role));
end $$;


ALTER FUNCTION "public"."admin_set_agent_role"("p_actor_id" "uuid", "p_agent_id" "uuid", "p_role" "public"."agent_role", "p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_announcement_active"("p_actor_id" "uuid", "p_announcement_id" "uuid", "p_active" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.announcements set active = p_active where id = p_announcement_id;
  if not found then raise exception 'announcement not found'; end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
  values (p_actor_id, case when p_active then 'announcement.reactivated' else 'announcement.retracted' end,
          'announcement', p_announcement_id::text, '{}'::jsonb);
end $$;


ALTER FUNCTION "public"."admin_set_announcement_active"("p_actor_id" "uuid", "p_announcement_id" "uuid", "p_active" boolean) OWNER TO "postgres";


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
    and activity_date between p_from and p_to
    and (select private.is_upline_of(p_agent_id));
$$;


ALTER FUNCTION "public"."agent_aggregate"("p_agent_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agent_daily_activity"("p_agent_id" "uuid", "p_from" "date", "p_to" "date") RETURNS TABLE("activity_date" "date", "calls_made" integer, "appts_set" integer, "appts_held" integer, "premium_cents" bigint, "min_calls_target" integer, "min_met" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select d::date,
         coalesce(m.calls_made,0), coalesce(m.appts_set,0), coalesce(m.appt_held,0),
         coalesce(m.premium_cents,0), t.min_calls_per_day,
         coalesce(m.calls_made,0) >= t.min_calls_per_day
  from generate_series(p_from, p_to, interval '1 day') d
  left join public.daily_metrics m
    on m.agent_id = p_agent_id and m.activity_date = d::date
  cross join lateral private.effective_target(p_agent_id, public.cycle_start(d::date)) t
  where (select private.is_upline_of(p_agent_id))
  order by d;
$$;


ALTER FUNCTION "public"."agent_daily_activity"("p_agent_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."agent_daily_breakdown"("p_from" "date", "p_to" "date", "p_agent_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("activity_date" "date", "calls_made" integer, "appts_set" integer, "appt_held" integer, "recruiting_convos" integer, "sales_count" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select d::date,
         coalesce(sum(m.calls_made), 0)::int,
         coalesce(sum(m.appts_set), 0)::int,
         coalesce(sum(m.appt_held), 0)::int,
         coalesce(sum(m.recruiting_convos), 0)::int,
         coalesce(sum(m.sales_count), 0)::int
  from generate_series(p_from, p_to, interval '1 day') d
  left join public.daily_metrics m
    on m.activity_date = d::date
   and m.agent_id in (select private.my_downline())
   and (p_agent_ids is null or m.agent_id = any(p_agent_ids))
  group by d
  order by d;
$$;


ALTER FUNCTION "public"."agent_daily_breakdown"("p_from" "date", "p_to" "date", "p_agent_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."audit_target_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (new.org_id, (select auth.uid()), lower(tg_op) || '.target', 'target', new.id::text,
          jsonb_build_object('agent_id', new.agent_id, 'effective_from', new.effective_from,
                             'calls', new.calls_per_cycle, 'min_per_day', new.min_calls_per_day));
  return new;
end $$;


ALTER FUNCTION "public"."audit_target_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_rate_limit"("p_scope" "text", "p_limit" integer, "p_window_seconds" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_key text := coalesce((select auth.uid())::text, 'anon') || ':' || p_scope;
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into private.rate_limits (rl_key, window_start, count)
  values (v_key, v_window, 1)
  on conflict (rl_key, window_start) do update set count = private.rate_limits.count + 1
  returning count into v_count;

  delete from private.rate_limits
  where rl_key = v_key and window_start < v_window - (p_window_seconds * 5 || ' seconds')::interval;

  return v_count <= p_limit;
end $$;


ALTER FUNCTION "public"."check_rate_limit"("p_scope" "text", "p_limit" integer, "p_window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."closure_on_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.agent_closure (ancestor_id, descendant_id, depth)
  values (new.id, new.id, 0);

  if new.upline_id is not null then
    insert into public.agent_closure (ancestor_id, descendant_id, depth)
    select c.ancestor_id, new.id, c.depth + 1
    from public.agent_closure c
    where c.descendant_id = new.upline_id
    on conflict do nothing;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."closure_on_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."closure_on_move"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.upline_id is not distinct from old.upline_id then
    return new;
  end if;

  -- Cycle guard: the new upline must not already be inside our own subtree.
  if new.upline_id is not null and exists (
    select 1 from public.agent_closure
    where ancestor_id = new.id and descendant_id = new.upline_id
  ) then
    raise exception 'cycle: % is already a descendant of %', new.upline_id, new.id;
  end if;

  -- Drop every edge from outside the subtree into the subtree.
  delete from public.agent_closure c
  using public.agent_closure sub
  where sub.ancestor_id = new.id
    and c.descendant_id = sub.descendant_id
    and c.ancestor_id not in (
      select descendant_id from public.agent_closure where ancestor_id = new.id
    );

  -- Rebuild them from the new upline's ancestor chain.
  if new.upline_id is not null then
    insert into public.agent_closure (ancestor_id, descendant_id, depth)
    select up.ancestor_id, sub.descendant_id, up.depth + sub.depth + 1
    from public.agent_closure up
    cross join public.agent_closure sub
    where up.descendant_id = new.upline_id
      and sub.ancestor_id  = new.id
    on conflict (ancestor_id, descendant_id) do update
      set depth = excluded.depth;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."closure_on_move"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_invitation"("p_email" "text", "p_role" "public"."agent_role" DEFAULT 'associate'::"public"."agent_role") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_token text; v_me uuid := (select auth.uid()); v_org uuid; v_role public.agent_role;
begin
  select a.org_id, a.role into v_org, v_role from public.agents a where a.id = v_me;
  if v_role not in ('leader','admin') then
    raise exception 'only a leader or admin can invite';
  end if;
  if p_role = 'admin' and v_role <> 'admin' then
    raise exception 'only an admin can invite an admin';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (org_id, email, upline_id, role, token_hash, created_by)
  values (v_org, lower(p_email), v_me, p_role,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), v_me);

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'invitation.created', 'invitation', lower(p_email),
          jsonb_build_object('role', p_role));
  return v_token;
end $$;


ALTER FUNCTION "public"."create_invitation"("p_email" "text", "p_role" "public"."agent_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cycle_end"("d" "date") RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when extract(day from d) <= 10 then date_trunc('month', d)::date + 9
    when extract(day from d) <= 20 then date_trunc('month', d)::date + 19
    else (date_trunc('month', d) + interval '1 month' - interval '1 day')::date
  end;
$$;


ALTER FUNCTION "public"."cycle_end"("d" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cycle_start"("d" "date") RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when extract(day from d) <= 10 then date_trunc('month', d)::date
    when extract(day from d) <= 20 then date_trunc('month', d)::date + 10
    else date_trunc('month', d)::date + 20
  end;
$$;


ALTER FUNCTION "public"."cycle_start"("d" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."deactivate_agent"("p_agent_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_me uuid := (select auth.uid()); v_role public.agent_role; v_org uuid;
begin
  select role, org_id into v_role, v_org from public.agents where id = v_me;
  if v_role not in ('leader','admin') then
    raise exception 'only a leader or admin can deactivate an agent';
  end if;
  if not (select private.is_upline_of(p_agent_id)) then
    raise exception 'agent is not in caller''s downline';
  end if;

  perform set_config('app.privileged_agent_write', 'on', true);
  update public.agents set status = 'inactive' where id = p_agent_id and org_id = v_org;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'agent.deactivated', 'agent', p_agent_id::text, '{}'::jsonb);
end $$;


ALTER FUNCTION "public"."deactivate_agent"("p_agent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."drain_metrics"("p_limit" integer DEFAULT 500) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."drain_metrics"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_same_org"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.upline_id is not null
     and (select a.org_id from public.agents a where a.id = new.upline_id) <> new.org_id
  then raise exception 'upline_id crosses organization boundary';
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."enforce_same_org"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_metrics"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."enqueue_metrics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_agent_privileged_columns"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if (new.role, new.upline_id, new.org_id, new.status)
     is distinct from (old.role, old.upline_id, old.org_id, old.status)
     and coalesce((select a.role from public.agents a where a.id = (select auth.uid())),
                  'associate') <> 'admin'
     and (select auth.uid()) is not null
     and coalesce(current_setting('app.privileged_agent_write', true), '') <> 'on'
  then raise exception 'privileged column change requires admin';
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."guard_agent_privileged_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare inv public.invitations%rowtype; v_name text;
begin
  select * into inv from public.invitations
  where lower(email) = lower(new.email)
    and accepted_at is null and revoked_at is null and expires_at > now()
  order by created_at desc limit 1;

  if inv.id is null then
    raise exception 'signup requires a valid invitation';
  end if;

  v_name := coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1));

  insert into public.agents (id, org_id, full_name, email, upline_id, role)
  values (
    new.id,
    case when inv.role = 'admin' then null else inv.org_id end,
    v_name, new.email,
    case when inv.role = 'admin' then null else inv.upline_id end,
    inv.role
  );

  update public.invitations set accepted_at = now() where id = inv.id;

  -- inv.org_id (the inviting admin's org, if this is an admin invite) is
  -- kept here purely as audit context for who-invited-whom -- it is not
  -- where the new admin's own agents.org_id points.
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (inv.org_id, new.id, 'signup.accepted', 'agent', new.id::text,
          jsonb_build_object('invitation_id', inv.id, 'role', inv.role));
  return new;
end $$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_followups"("p_as_of" "date" DEFAULT CURRENT_DATE) RETURNS TABLE("call_id" "uuid", "contact_id" "uuid", "contact_name" "text", "last_note" "text", "follow_up_on" "date", "days_late" integer, "times_called" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select cl.id, ct.id, ct.full_name, cl.notes, cl.follow_up_on,
         (p_as_of - cl.follow_up_on)::int,
         (select count(*)::int from public.call_logs x where x.contact_id = ct.id)
  from public.call_logs cl
  join public.contacts ct on ct.id = cl.contact_id
  where cl.agent_id = (select auth.uid())
    and cl.follow_up_on is not null
    and cl.follow_up_on <= p_as_of
    and cl.follow_up_done_at is null
  order by cl.follow_up_on;
$$;


ALTER FUNCTION "public"."my_followups"("p_as_of" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_target"("p_period_start" "date") RETURNS TABLE("calls_per_cycle" integer, "appts_held_per_cycle" integer, "premium_cents_per_cycle" bigint, "min_calls_per_day" integer, "md_deadline" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select * from private.effective_target((select auth.uid()), p_period_start);
$$;


ALTER FUNCTION "public"."my_target"("p_period_start" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."nudge_agent"("p_agent_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_me uuid := (select auth.uid()); v_role public.agent_role; v_org uuid; v_updated boolean;
begin
  select role, org_id into v_role, v_org from public.agents where id = v_me;
  if v_role not in ('leader','admin') then
    raise exception 'only a leader or admin can nudge an agent';
  end if;
  if not (select private.is_upline_of(p_agent_id)) then
    raise exception 'agent is not in caller''s downline';
  end if;

  -- Atomic check-and-set: the WHERE clause is the rate-limit check, and it
  -- is evaluated by the same statement that performs the write, so two
  -- concurrent callers can't both see "no recent send" and both proceed.
  insert into public.agent_nudges (agent_id, last_sent_at, last_sent_by)
  values (p_agent_id, now(), v_me)
  on conflict (agent_id) do update
    set last_sent_at = now(), last_sent_by = v_me
    where public.agent_nudges.last_sent_at <= now() - interval '1 day';
  get diagnostics v_updated = row_count;
  if not v_updated then
    raise exception 'already nudged this agent in the last day';
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'agent.nudged', 'agent', p_agent_id::text, '{}'::jsonb);
end $$;


ALTER FUNCTION "public"."nudge_agent"("p_agent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pgmq_archive"("queue_name" "text", "msg_id" bigint) RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select pgmq.archive(queue_name, msg_id);
$$;


ALTER FUNCTION "public"."pgmq_archive"("queue_name" "text", "msg_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pgmq_delete"("queue_name" "text", "msg_id" bigint) RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select pgmq.delete(queue_name, msg_id);
$$;


ALTER FUNCTION "public"."pgmq_delete"("queue_name" "text", "msg_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."pgmq_read"("queue_name" "text", "vt" integer, "qty" integer) RETURNS TABLE("msg_id" bigint, "read_ct" integer, "enqueued_at" timestamp with time zone, "vt" timestamp with time zone, "message" "jsonb")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select msg_id, read_ct, enqueued_at, vt, message from pgmq.read(queue_name, vt, qty);
$$;


ALTER FUNCTION "public"."pgmq_read"("queue_name" "text", "vt" integer, "qty" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."provision_org"("p_org_name" "text", "p_smd_email" "text", "p_smd_name" "text") RETURNS TABLE("org_id" "uuid", "invite_token" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_org uuid; v_token text;
begin
  insert into public.organizations (name) values (p_org_name) returning id into v_org;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.invitations (org_id, email, upline_id, role, token_hash)
  values (v_org, lower(p_smd_email), null, 'leader',
          encode(extensions.digest(v_token, 'sha256'), 'hex'));

  insert into public.targets (org_id, agent_id, set_by, effective_from)
  select v_org, null, null, public.week_start(current_date)
  where false;  -- org default is created by the SMD on first login

  insert into public.audit_log (org_id, action, entity, entity_id, metadata)
  values (v_org, 'org.provisioned', 'organization', v_org::text,
          jsonb_build_object('smd_email', lower(p_smd_email)));

  org_id := v_org; invite_token := v_token; return next;
end $$;


ALTER FUNCTION "public"."provision_org"("p_org_name" "text", "p_smd_email" "text", "p_smd_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_roster_training_reminder"("p_roster_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_me uuid := (select auth.uid());
  v_role public.agent_role;
  v_org uuid;
  v_roster_org uuid;
  v_roster_upline uuid;
  v_last timestamptz;
begin
  select role, org_id into v_role, v_org from public.agents where id = v_me;
  if v_role not in ('leader','admin') then
    raise exception 'only a leader or admin can send a training reminder';
  end if;

  select org_id, upline_id into v_roster_org, v_roster_upline
  from public.team_roster where id = p_roster_id;

  if v_roster_org is null or v_roster_org <> v_org then
    raise exception 'roster entry not found in caller''s org';
  end if;
  if not (select private.is_upline_of(v_roster_upline)) then
    raise exception 'roster entry is not in caller''s downline';
  end if;

  select last_training_reminder_at into v_last
  from public.team_roster where id = p_roster_id;
  if v_last is not null and v_last > now() - interval '1 day' then
    raise exception 'already sent a training reminder to this roster entry in the last day';
  end if;

  update public.team_roster set last_training_reminder_at = now() where id = p_roster_id;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'roster.training_reminder_sent', 'team_roster', p_roster_id::text, '{}'::jsonb);
end $$;


ALTER FUNCTION "public"."send_roster_training_reminder"("p_roster_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_training_reminder"("p_agent_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_me uuid := (select auth.uid()); v_role public.agent_role; v_org uuid; v_updated boolean;
begin
  select role, org_id into v_role, v_org from public.agents where id = v_me;
  if v_role not in ('leader','admin') then
    raise exception 'only a leader or admin can send a training reminder';
  end if;
  if not (select private.is_upline_of(p_agent_id)) then
    raise exception 'agent is not in caller''s downline';
  end if;

  insert into public.agent_training_reminders (agent_id, last_sent_at, last_sent_by)
  values (p_agent_id, now(), v_me)
  on conflict (agent_id) do update
    set last_sent_at = now(), last_sent_by = v_me
    where public.agent_training_reminders.last_sent_at <= now() - interval '1 day';
  get diagnostics v_updated = row_count;
  if not v_updated then
    raise exception 'already sent a training reminder to this agent in the last day';
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'agent.training_reminder_sent', 'agent', p_agent_id::text, '{}'::jsonb);
end $$;


ALTER FUNCTION "public"."send_training_reminder"("p_agent_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_auto_call_nudges"("p_agent_id" "uuid", "p_enabled" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_me uuid := (select auth.uid()); v_role public.agent_role; v_org uuid;
begin
  select role, org_id into v_role, v_org from public.agents where id = v_me;
  if v_role not in ('leader','admin') then
    raise exception 'only a leader or admin can change this';
  end if;
  if not (select private.is_upline_of(p_agent_id)) then
    raise exception 'agent is not in caller''s downline';
  end if;

  update public.agents set auto_call_nudges_enabled = p_enabled where id = p_agent_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'agent.auto_nudges_set', 'agent', p_agent_id::text, jsonb_build_object('enabled', p_enabled));
end $$;


ALTER FUNCTION "public"."set_auto_call_nudges"("p_agent_id" "uuid", "p_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_org_from_agent"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  new.org_id := (select a.org_id from public.agents a where a.id = new.agent_id);
  if new.org_id is null then
    raise exception 'agent % has no organization', new.agent_id;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."set_org_from_agent"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_org_from_agent_nullable"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  new.org_id := (select a.org_id from public.agents a where a.id = new.agent_id);
  return new;
end $$;


ALTER FUNCTION "public"."set_org_from_agent_nullable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_target"("p_agent_id" "uuid", "p_effective_from" "date", "p_calls_per_cycle" integer, "p_appts_held_per_cycle" integer, "p_premium_cents_per_cycle" bigint, "p_min_calls_per_day" integer) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_me uuid := (select auth.uid());
  v_role public.agent_role;
  v_org uuid;
begin
  select role, org_id into v_role, v_org from public.agents where id = v_me;
  if v_role not in ('leader', 'admin') or v_org is null then
    raise exception 'only a leader or admin with an organization can set a goal';
  end if;
  if p_agent_id is not null and not (select private.is_upline_of(p_agent_id)) then
    raise exception 'agent is not in caller''s downline';
  end if;

  if p_agent_id is null then
    insert into public.targets (
      org_id, agent_id, set_by, effective_from,
      calls_per_cycle, appts_held_per_cycle, premium_cents_per_cycle, min_calls_per_day
    )
    values (
      v_org, null, v_me, p_effective_from,
      p_calls_per_cycle, p_appts_held_per_cycle, p_premium_cents_per_cycle, p_min_calls_per_day
    )
    on conflict (org_id, effective_from) where agent_id is null
    do update set
      set_by = excluded.set_by,
      calls_per_cycle = excluded.calls_per_cycle,
      appts_held_per_cycle = excluded.appts_held_per_cycle,
      premium_cents_per_cycle = excluded.premium_cents_per_cycle,
      min_calls_per_day = excluded.min_calls_per_day;
  else
    insert into public.targets (
      org_id, agent_id, set_by, effective_from,
      calls_per_cycle, appts_held_per_cycle, premium_cents_per_cycle, min_calls_per_day
    )
    values (
      v_org, p_agent_id, v_me, p_effective_from,
      p_calls_per_cycle, p_appts_held_per_cycle, p_premium_cents_per_cycle, p_min_calls_per_day
    )
    on conflict (org_id, agent_id, effective_from) where agent_id is not null
    do update set
      set_by = excluded.set_by,
      calls_per_cycle = excluded.calls_per_cycle,
      appts_held_per_cycle = excluded.appts_held_per_cycle,
      premium_cents_per_cycle = excluded.premium_cents_per_cycle,
      min_calls_per_day = excluded.min_calls_per_day;
  end if;
end $$;


ALTER FUNCTION "public"."set_target"("p_agent_id" "uuid", "p_effective_from" "date", "p_calls_per_cycle" integer, "p_appts_held_per_cycle" integer, "p_premium_cents_per_cycle" bigint, "p_min_calls_per_day" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."system_effective_target"("p_agent_id" "uuid", "p_period_start" "date") RETURNS TABLE("calls_per_cycle" integer, "appts_held_per_cycle" integer, "premium_cents_per_cycle" bigint, "min_calls_per_day" integer, "md_deadline" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select * from private.effective_target(p_agent_id, p_period_start);
$$;


ALTER FUNCTION "public"."system_effective_target"("p_agent_id" "uuid", "p_period_start" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."system_team_period_summary"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") RETURNS TABLE("agent_id" "uuid", "full_name" "text", "depth" integer, "calls_made" integer, "appts_set" integer, "appts_held" integer, "premium_cents" bigint, "calls_target" integer, "appts_held_target" integer, "premium_cents_target" bigint, "pct_calls" numeric, "streak_days" integer, "last_logged_at" timestamp with time zone, "has_override" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select * from private.team_period_summary_for(p_leader_id, p_from, p_to);
$$;


ALTER FUNCTION "public"."system_team_period_summary"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") OWNER TO "postgres";


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
    and activity_date between p_from and p_to;
$$;


ALTER FUNCTION "public"."team_breakdown"("p_from" "date", "p_to" "date", "p_agent_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."team_day_summary"("p_date" "date") RETURNS TABLE("agent_id" "uuid", "full_name" "text", "calls_made" integer, "appts_set" integer, "appts_held" integer, "premium_cents" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select a.id, a.full_name,
         coalesce(m.calls_made,0), coalesce(m.appts_set,0),
         coalesce(m.appt_held,0), coalesce(m.premium_cents,0)
  from public.agent_closure c
  join public.agents a on a.id = c.descendant_id and a.status = 'active'
  left join public.daily_metrics m
    on m.agent_id = a.id and m.activity_date = p_date
  where c.ancestor_id = (select auth.uid())
    and a.org_id = (select private.my_org());
$$;


ALTER FUNCTION "public"."team_day_summary"("p_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."team_inactive"("p_days" integer DEFAULT 7) RETURNS TABLE("agent_id" "uuid", "full_name" "text", "last_logged_at" timestamp with time zone, "days_quiet" integer, "auto_call_nudges_enabled" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select a.id, a.full_name, max(m.updated_at),
         coalesce(extract(day from now() - max(m.updated_at))::int, 999),
         a.auto_call_nudges_enabled
  from public.agent_closure c
  join public.agents a on a.id = c.descendant_id and a.status = 'active'
  left join public.daily_metrics m on m.agent_id = a.id
  where c.ancestor_id = (select auth.uid())
  group by a.id, a.full_name, a.auto_call_nudges_enabled
  having coalesce(max(m.updated_at), 'epoch'::timestamptz) < now() - (p_days || ' days')::interval
  order by max(m.updated_at) nulls first;
$$;


ALTER FUNCTION "public"."team_inactive"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."team_period_summary"("p_from" "date", "p_to" "date") RETURNS TABLE("agent_id" "uuid", "full_name" "text", "depth" integer, "calls_made" integer, "appts_set" integer, "appts_held" integer, "premium_cents" bigint, "calls_target" integer, "appts_held_target" integer, "premium_cents_target" bigint, "pct_calls" numeric, "streak_days" integer, "last_logged_at" timestamp with time zone, "has_override" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with scope as (
    select c.descendant_id id, c.depth
    from public.agent_closure c
    where c.ancestor_id = (select auth.uid())
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
  cross join lateral private.effective_target(a.id, p_from) t
  order by round(100.0 * coalesce(g.calls,0) / nullif(round(t.calls_per_cycle * c.n), 0), 1) asc nulls first;
$$;


ALTER FUNCTION "public"."team_period_summary"("p_from" "date", "p_to" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."team_target"("p_agent_id" "uuid", "p_period_start" "date") RETURNS TABLE("calls_per_cycle" integer, "appts_held_per_cycle" integer, "premium_cents_per_cycle" bigint, "min_calls_per_day" integer, "md_deadline" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select * from private.effective_target(p_agent_id, p_period_start)
  where (select private.is_upline_of(p_agent_id));
$$;


ALTER FUNCTION "public"."team_target"("p_agent_id" "uuid", "p_period_start" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."team_trend"("p_weeks" integer DEFAULT 8, "p_agent_ids" "uuid"[] DEFAULT NULL::"uuid"[]) RETURNS TABLE("week_start" "date", "calls_made" bigint, "premium_cents" bigint, "calls_target" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with scope as (
    select descendant_id id from public.agent_closure
    where ancestor_id = (select auth.uid())
      and (p_agent_ids is null or descendant_id = any(p_agent_ids))
  ), weeks as (
    select public.week_start(current_date) - (7 * n) as ws
    from generate_series(0, p_weeks - 1) n
  )
  select w.ws,
         coalesce(sum(m.calls_made),0)::bigint,
         coalesce(sum(m.premium_cents),0)::bigint,
         coalesce(round((select sum(t.calls_per_cycle) from scope s
                   cross join lateral private.effective_target(s.id, w.ws) t)::numeric * 7 / 10), 0)::bigint
  from weeks w
  left join public.daily_metrics m
    on m.agent_id in (select id from scope)
   and m.activity_date >= w.ws and m.activity_date < w.ws + 7
  group by w.ws
  order by w.ws;
$$;


ALTER FUNCTION "public"."team_trend"("p_weeks" integer, "p_agent_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."week_start"("d" "date") RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select (d - ((extract(isodow from d)::int - 1)))::date;
$$;


ALTER FUNCTION "public"."week_start"("d" "date") OWNER TO "postgres";

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


CREATE TABLE IF NOT EXISTS "public"."agent_auto_nudge_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "local_date" "date" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."agent_auto_nudge_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_closure" (
    "ancestor_id" "uuid" NOT NULL,
    "descendant_id" "uuid" NOT NULL,
    "depth" integer NOT NULL
);


ALTER TABLE "public"."agent_closure" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_email_changes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "new_email" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "requested_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "confirmed_at" timestamp with time zone
);


ALTER TABLE "public"."agent_email_changes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_nudges" (
    "agent_id" "uuid" NOT NULL,
    "last_sent_at" timestamp with time zone NOT NULL,
    "last_sent_by" "uuid" NOT NULL
);


ALTER TABLE "public"."agent_nudges" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agent_training_reminders" (
    "agent_id" "uuid" NOT NULL,
    "last_sent_at" timestamp with time zone NOT NULL,
    "last_sent_by" "uuid" NOT NULL
);


ALTER TABLE "public"."agent_training_reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agents" (
    "id" "uuid" NOT NULL,
    "org_id" "uuid",
    "full_name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "upline_id" "uuid",
    "role" "public"."agent_role" DEFAULT 'associate'::"public"."agent_role" NOT NULL,
    "status" "public"."agent_status" DEFAULT 'active'::"public"."agent_status" NOT NULL,
    "joined_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "time_zone" "text",
    "terms_accepted_at" timestamp with time zone,
    "auto_call_nudges_enabled" boolean DEFAULT false NOT NULL,
    CONSTRAINT "agents_admin_no_upline" CHECK ((("org_id" IS NOT NULL) OR ("upline_id" IS NULL))),
    CONSTRAINT "agents_org_required_unless_admin" CHECK ((("role" = 'admin'::"public"."agent_role") OR ("org_id" IS NOT NULL)))
);


ALTER TABLE "public"."agents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."announcement_dismissals" (
    "announcement_id" "uuid" NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "dismissed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."announcement_dismissals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."announcements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "message" "text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "announcements_message_check" CHECK ((("char_length"("message") >= 1) AND ("char_length"("message") <= 2000)))
);


ALTER TABLE "public"."announcements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "appt_date" "date" NOT NULL,
    "appt_type" "text",
    "status" "public"."appt_status" DEFAULT 'scheduled'::"public"."appt_status" NOT NULL,
    "expected_premium_cents" bigint DEFAULT 0 NOT NULL,
    "referrals_given" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "import_row_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_request_id" "text",
    "follow_up_on" "date",
    "follow_up_done_at" timestamp with time zone
);


ALTER TABLE "public"."appointments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" bigint NOT NULL,
    "org_id" "uuid",
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "entity" "text" NOT NULL,
    "entity_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."audit_log_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."audit_log_id_seq" OWNED BY "public"."audit_log"."id";



CREATE TABLE IF NOT EXISTS "public"."call_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "call_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "source" "public"."call_source" NOT NULL,
    "outcome" "public"."call_outcome" NOT NULL,
    "notes" "text",
    "follow_up_on" "date",
    "follow_up_done_at" timestamp with time zone,
    "import_row_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_request_id" "text"
);


ALTER TABLE "public"."call_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."daily_metrics" (
    "agent_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "activity_date" "date" NOT NULL,
    "calls_made" integer DEFAULT 0 NOT NULL,
    "appts_set" integer DEFAULT 0 NOT NULL,
    "referrals_given" integer DEFAULT 0 NOT NULL,
    "recruiting_convos" integer DEFAULT 0 NOT NULL,
    "sales_count" integer DEFAULT 0 NOT NULL,
    "premium_cents" bigint DEFAULT 0 NOT NULL,
    "follow_ups_due" integer DEFAULT 0 NOT NULL,
    "follow_ups_done" integer DEFAULT 0 NOT NULL,
    "out_connected" integer DEFAULT 0 NOT NULL,
    "out_voicemail" integer DEFAULT 0 NOT NULL,
    "out_no_answer" integer DEFAULT 0 NOT NULL,
    "out_appt_set" integer DEFAULT 0 NOT NULL,
    "out_not_interested" integer DEFAULT 0 NOT NULL,
    "src_warm_market" integer DEFAULT 0 NOT NULL,
    "src_referral" integer DEFAULT 0 NOT NULL,
    "src_cold" integer DEFAULT 0 NOT NULL,
    "src_social_media" integer DEFAULT 0 NOT NULL,
    "src_friend" integer DEFAULT 0 NOT NULL,
    "src_other" integer DEFAULT 0 NOT NULL,
    "appt_scheduled" integer DEFAULT 0 NOT NULL,
    "appt_held" integer DEFAULT 0 NOT NULL,
    "appt_no_show" integer DEFAULT 0 NOT NULL,
    "appt_rescheduled" integer DEFAULT 0 NOT NULL,
    "appt_cancelled" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "src_existing_client" integer DEFAULT 0 NOT NULL,
    "src_existing_recruit" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."daily_metrics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "org_id" "uuid",
    "category" "public"."feedback_category" DEFAULT 'bug'::"public"."feedback_category" NOT NULL,
    "subject" "text" NOT NULL,
    "message" "text" NOT NULL,
    "page_url" "text",
    "status" "public"."feedback_status" DEFAULT 'new'::"public"."feedback_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."feedback" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid",
    "email" "text" NOT NULL,
    "upline_id" "uuid",
    "role" "public"."agent_role" DEFAULT 'associate'::"public"."agent_role" NOT NULL,
    "token_hash" "text" NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    "accepted_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invitations_org_required_unless_admin" CHECK ((("role" = 'admin'::"public"."agent_role") OR ("org_id" IS NOT NULL)))
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mfa_recovery_codes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "code_hash" "text" NOT NULL,
    "used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."mfa_recovery_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "local_date" "date" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."notification_send_status" DEFAULT 'queued'::"public"."notification_send_status" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    CONSTRAINT "notification_log_kind_check" CHECK (("kind" = ANY (ARRAY['evening_nudge'::"text", 'sunday_summary'::"text", 'monday_digest'::"text"])))
);


ALTER TABLE "public"."notification_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_prefs" (
    "agent_id" "uuid" NOT NULL,
    "evening_nudge" boolean DEFAULT true NOT NULL,
    "sunday_summary" boolean DEFAULT true NOT NULL,
    "monday_digest" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notification_prefs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "call_log_retention_months" integer DEFAULT 24 NOT NULL,
    "logo_path" "text"
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recruiting_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "contact_id" "uuid",
    "log_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "source" "public"."call_source",
    "status" "public"."recruit_status" DEFAULT 'contacted'::"public"."recruit_status" NOT NULL,
    "notes" "text",
    "import_row_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_request_id" "text"
);


ALTER TABLE "public"."recruiting_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "contact_id" "uuid",
    "appointment_id" "uuid",
    "sale_date" "date" NOT NULL,
    "product_type" "text",
    "premium_cents" bigint DEFAULT 0 NOT NULL,
    "notes" "text",
    "import_row_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_request_id" "text",
    "follow_up_on" "date",
    "follow_up_done_at" timestamp with time zone
);


ALTER TABLE "public"."sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."targets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "agent_id" "uuid",
    "set_by" "uuid",
    "effective_from" "date" NOT NULL,
    "calls_per_cycle" integer DEFAULT 50 NOT NULL,
    "appts_held_per_cycle" integer DEFAULT 3 NOT NULL,
    "premium_cents_per_cycle" bigint DEFAULT 18800 NOT NULL,
    "min_calls_per_day" integer DEFAULT 15 NOT NULL,
    "md_deadline" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."targets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_roster" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "upline_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "notes" "text",
    "invitation_id" "uuid",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_training_reminder_at" timestamp with time zone,
    "auto_reminders_enabled" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."team_roster" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_roster_reminder_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "roster_id" "uuid" NOT NULL,
    "local_date" "date" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."team_roster_reminder_log" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_log" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."audit_log_id_seq"'::"regclass");



ALTER TABLE ONLY "private"."metrics_dirty"
    ADD CONSTRAINT "metrics_dirty_pkey" PRIMARY KEY ("agent_id", "activity_date");



ALTER TABLE ONLY "private"."rate_limits"
    ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("rl_key", "window_start");



ALTER TABLE ONLY "public"."agent_auto_nudge_log"
    ADD CONSTRAINT "agent_auto_nudge_log_agent_id_local_date_key" UNIQUE ("agent_id", "local_date");



ALTER TABLE ONLY "public"."agent_auto_nudge_log"
    ADD CONSTRAINT "agent_auto_nudge_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_closure"
    ADD CONSTRAINT "agent_closure_pkey" PRIMARY KEY ("ancestor_id", "descendant_id");



ALTER TABLE ONLY "public"."agent_email_changes"
    ADD CONSTRAINT "agent_email_changes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_email_changes"
    ADD CONSTRAINT "agent_email_changes_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."agent_nudges"
    ADD CONSTRAINT "agent_nudges_pkey" PRIMARY KEY ("agent_id");



ALTER TABLE ONLY "public"."agent_training_reminders"
    ADD CONSTRAINT "agent_training_reminders_pkey" PRIMARY KEY ("agent_id");



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "agents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."announcement_dismissals"
    ADD CONSTRAINT "announcement_dismissals_pkey" PRIMARY KEY ("announcement_id", "agent_id");



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."call_logs"
    ADD CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."daily_metrics"
    ADD CONSTRAINT "daily_metrics_pkey" PRIMARY KEY ("agent_id", "activity_date");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."mfa_recovery_codes"
    ADD CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_log"
    ADD CONSTRAINT "notification_log_agent_id_kind_local_date_key" UNIQUE ("agent_id", "kind", "local_date");



ALTER TABLE ONLY "public"."notification_log"
    ADD CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_prefs"
    ADD CONSTRAINT "notification_prefs_pkey" PRIMARY KEY ("agent_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."recruiting_logs"
    ADD CONSTRAINT "recruiting_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."targets"
    ADD CONSTRAINT "targets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_roster"
    ADD CONSTRAINT "team_roster_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_roster_reminder_log"
    ADD CONSTRAINT "team_roster_reminder_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."team_roster_reminder_log"
    ADD CONSTRAINT "team_roster_reminder_log_roster_id_local_date_key" UNIQUE ("roster_id", "local_date");



CREATE INDEX "agent_auto_nudge_log_agent_idx" ON "public"."agent_auto_nudge_log" USING "btree" ("agent_id", "sent_at");



CREATE INDEX "agent_closure_desc_idx" ON "public"."agent_closure" USING "btree" ("descendant_id");



CREATE INDEX "agent_email_changes_agent_idx" ON "public"."agent_email_changes" USING "btree" ("agent_id");



CREATE UNIQUE INDEX "agents_email_uq" ON "public"."agents" USING "btree" ("lower"("email"));



CREATE INDEX "agents_org_idx" ON "public"."agents" USING "btree" ("org_id");



CREATE INDEX "agents_upline_idx" ON "public"."agents" USING "btree" ("upline_id");



CREATE INDEX "announcements_active_idx" ON "public"."announcements" USING "btree" ("active", "created_at" DESC);



CREATE INDEX "appointments_agent_date_idx" ON "public"."appointments" USING "btree" ("agent_id", "appt_date");



CREATE UNIQUE INDEX "appointments_client_request_uq" ON "public"."appointments" USING "btree" ("agent_id", "client_request_id") WHERE ("client_request_id" IS NOT NULL);



CREATE INDEX "appointments_followup_idx" ON "public"."appointments" USING "btree" ("agent_id", "follow_up_on") WHERE (("follow_up_on" IS NOT NULL) AND ("follow_up_done_at" IS NULL));



CREATE UNIQUE INDEX "appointments_import_uq" ON "public"."appointments" USING "btree" ("agent_id", "import_row_hash") WHERE ("import_row_hash" IS NOT NULL);



CREATE INDEX "appointments_org_idx" ON "public"."appointments" USING "btree" ("org_id");



CREATE INDEX "audit_log_org_idx" ON "public"."audit_log" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "call_logs_agent_date_idx" ON "public"."call_logs" USING "btree" ("agent_id", "call_date");



CREATE UNIQUE INDEX "call_logs_client_request_uq" ON "public"."call_logs" USING "btree" ("agent_id", "client_request_id") WHERE ("client_request_id" IS NOT NULL);



CREATE INDEX "call_logs_followup_idx" ON "public"."call_logs" USING "btree" ("agent_id", "follow_up_on") WHERE (("follow_up_on" IS NOT NULL) AND ("follow_up_done_at" IS NULL));



CREATE UNIQUE INDEX "call_logs_import_uq" ON "public"."call_logs" USING "btree" ("agent_id", "import_row_hash") WHERE ("import_row_hash" IS NOT NULL);



CREATE INDEX "call_logs_org_idx" ON "public"."call_logs" USING "btree" ("org_id");



CREATE INDEX "contacts_agent_idx" ON "public"."contacts" USING "btree" ("agent_id");



CREATE UNIQUE INDEX "contacts_agent_name_uq" ON "public"."contacts" USING "btree" ("agent_id", "lower"("full_name"));



CREATE INDEX "daily_metrics_date_idx" ON "public"."daily_metrics" USING "btree" ("activity_date");



CREATE INDEX "daily_metrics_org_date_idx" ON "public"."daily_metrics" USING "btree" ("org_id", "activity_date");



CREATE INDEX "feedback_agent_idx" ON "public"."feedback" USING "btree" ("agent_id");



CREATE INDEX "feedback_org_created_idx" ON "public"."feedback" USING "btree" ("org_id", "created_at" DESC);



CREATE INDEX "invitations_email_idx" ON "public"."invitations" USING "btree" ("lower"("email"));



CREATE INDEX "mfa_recovery_codes_agent_idx" ON "public"."mfa_recovery_codes" USING "btree" ("agent_id");



CREATE INDEX "notification_log_agent_idx" ON "public"."notification_log" USING "btree" ("agent_id", "sent_at");



CREATE INDEX "recruiting_agent_date_idx" ON "public"."recruiting_logs" USING "btree" ("agent_id", "log_date");



CREATE UNIQUE INDEX "recruiting_client_request_uq" ON "public"."recruiting_logs" USING "btree" ("agent_id", "client_request_id") WHERE ("client_request_id" IS NOT NULL);



CREATE UNIQUE INDEX "recruiting_import_uq" ON "public"."recruiting_logs" USING "btree" ("agent_id", "import_row_hash") WHERE ("import_row_hash" IS NOT NULL);



CREATE INDEX "recruiting_org_idx" ON "public"."recruiting_logs" USING "btree" ("org_id");



CREATE INDEX "sales_agent_date_idx" ON "public"."sales" USING "btree" ("agent_id", "sale_date");



CREATE UNIQUE INDEX "sales_client_request_uq" ON "public"."sales" USING "btree" ("agent_id", "client_request_id") WHERE ("client_request_id" IS NOT NULL);



CREATE INDEX "sales_followup_idx" ON "public"."sales" USING "btree" ("agent_id", "follow_up_on") WHERE (("follow_up_on" IS NOT NULL) AND ("follow_up_done_at" IS NULL));



CREATE UNIQUE INDEX "sales_import_uq" ON "public"."sales" USING "btree" ("agent_id", "import_row_hash") WHERE ("import_row_hash" IS NOT NULL);



CREATE INDEX "sales_org_idx" ON "public"."sales" USING "btree" ("org_id");



CREATE UNIQUE INDEX "targets_agent_uq" ON "public"."targets" USING "btree" ("org_id", "agent_id", "effective_from") WHERE ("agent_id" IS NOT NULL);



CREATE UNIQUE INDEX "targets_org_default_uq" ON "public"."targets" USING "btree" ("org_id", "effective_from") WHERE ("agent_id" IS NULL);



CREATE INDEX "team_roster_org_idx" ON "public"."team_roster" USING "btree" ("org_id");



CREATE INDEX "team_roster_reminder_log_roster_idx" ON "public"."team_roster_reminder_log" USING "btree" ("roster_id", "sent_at");



CREATE INDEX "team_roster_upline_idx" ON "public"."team_roster" USING "btree" ("upline_id");



CREATE OR REPLACE TRIGGER "agents_closure_insert" AFTER INSERT ON "public"."agents" FOR EACH ROW EXECUTE FUNCTION "public"."closure_on_insert"();



CREATE OR REPLACE TRIGGER "agents_closure_move" AFTER UPDATE OF "upline_id" ON "public"."agents" FOR EACH ROW EXECUTE FUNCTION "public"."closure_on_move"();



CREATE OR REPLACE TRIGGER "agents_guard_privileged" BEFORE UPDATE ON "public"."agents" FOR EACH ROW EXECUTE FUNCTION "public"."guard_agent_privileged_columns"();



CREATE OR REPLACE TRIGGER "agents_same_org" BEFORE INSERT OR UPDATE OF "upline_id", "org_id" ON "public"."agents" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_same_org"();



CREATE OR REPLACE TRIGGER "appointments_metrics" AFTER INSERT OR DELETE OR UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."enqueue_metrics"();



CREATE OR REPLACE TRIGGER "appointments_org" BEFORE INSERT OR UPDATE OF "agent_id" ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."set_org_from_agent"();



CREATE OR REPLACE TRIGGER "call_logs_metrics" AFTER INSERT OR DELETE OR UPDATE ON "public"."call_logs" FOR EACH ROW EXECUTE FUNCTION "public"."enqueue_metrics"();



CREATE OR REPLACE TRIGGER "call_logs_org" BEFORE INSERT OR UPDATE OF "agent_id" ON "public"."call_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_org_from_agent"();



CREATE OR REPLACE TRIGGER "contacts_org" BEFORE INSERT OR UPDATE OF "agent_id" ON "public"."contacts" FOR EACH ROW EXECUTE FUNCTION "public"."set_org_from_agent"();



CREATE OR REPLACE TRIGGER "feedback_org" BEFORE INSERT OR UPDATE OF "agent_id" ON "public"."feedback" FOR EACH ROW EXECUTE FUNCTION "public"."set_org_from_agent_nullable"();



CREATE OR REPLACE TRIGGER "recruiting_metrics" AFTER INSERT OR DELETE OR UPDATE ON "public"."recruiting_logs" FOR EACH ROW EXECUTE FUNCTION "public"."enqueue_metrics"();



CREATE OR REPLACE TRIGGER "recruiting_org" BEFORE INSERT OR UPDATE OF "agent_id" ON "public"."recruiting_logs" FOR EACH ROW EXECUTE FUNCTION "public"."set_org_from_agent"();



CREATE OR REPLACE TRIGGER "sales_metrics" AFTER INSERT OR DELETE OR UPDATE ON "public"."sales" FOR EACH ROW EXECUTE FUNCTION "public"."enqueue_metrics"();



CREATE OR REPLACE TRIGGER "sales_org" BEFORE INSERT OR UPDATE OF "agent_id" ON "public"."sales" FOR EACH ROW EXECUTE FUNCTION "public"."set_org_from_agent"();



CREATE OR REPLACE TRIGGER "targets_audit" AFTER INSERT OR UPDATE ON "public"."targets" FOR EACH ROW EXECUTE FUNCTION "public"."audit_target_change"();



ALTER TABLE ONLY "public"."agent_auto_nudge_log"
    ADD CONSTRAINT "agent_auto_nudge_log_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_closure"
    ADD CONSTRAINT "agent_closure_ancestor_id_fkey" FOREIGN KEY ("ancestor_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_closure"
    ADD CONSTRAINT "agent_closure_descendant_id_fkey" FOREIGN KEY ("descendant_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_email_changes"
    ADD CONSTRAINT "agent_email_changes_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_email_changes"
    ADD CONSTRAINT "agent_email_changes_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."agents"("id");



ALTER TABLE ONLY "public"."agent_nudges"
    ADD CONSTRAINT "agent_nudges_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_nudges"
    ADD CONSTRAINT "agent_nudges_last_sent_by_fkey" FOREIGN KEY ("last_sent_by") REFERENCES "public"."agents"("id");



ALTER TABLE ONLY "public"."agent_training_reminders"
    ADD CONSTRAINT "agent_training_reminders_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_training_reminders"
    ADD CONSTRAINT "agent_training_reminders_last_sent_by_fkey" FOREIGN KEY ("last_sent_by") REFERENCES "public"."agents"("id");



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "agents_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "agents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "agents_upline_id_fkey" FOREIGN KEY ("upline_id") REFERENCES "public"."agents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."announcement_dismissals"
    ADD CONSTRAINT "announcement_dismissals_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."announcement_dismissals"
    ADD CONSTRAINT "announcement_dismissals_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."agents"("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."call_logs"
    ADD CONSTRAINT "call_logs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."call_logs"
    ADD CONSTRAINT "call_logs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."call_logs"
    ADD CONSTRAINT "call_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."daily_metrics"
    ADD CONSTRAINT "daily_metrics_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."daily_metrics"
    ADD CONSTRAINT "daily_metrics_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback"
    ADD CONSTRAINT "feedback_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."agents"("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_upline_id_fkey" FOREIGN KEY ("upline_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mfa_recovery_codes"
    ADD CONSTRAINT "mfa_recovery_codes_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_log"
    ADD CONSTRAINT "notification_log_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_prefs"
    ADD CONSTRAINT "notification_prefs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."agents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."recruiting_logs"
    ADD CONSTRAINT "recruiting_logs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recruiting_logs"
    ADD CONSTRAINT "recruiting_logs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."recruiting_logs"
    ADD CONSTRAINT "recruiting_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."targets"
    ADD CONSTRAINT "targets_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."targets"
    ADD CONSTRAINT "targets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."targets"
    ADD CONSTRAINT "targets_set_by_fkey" FOREIGN KEY ("set_by") REFERENCES "public"."agents"("id");



ALTER TABLE ONLY "public"."team_roster"
    ADD CONSTRAINT "team_roster_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."agents"("id");



ALTER TABLE ONLY "public"."team_roster"
    ADD CONSTRAINT "team_roster_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_roster"
    ADD CONSTRAINT "team_roster_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_roster_reminder_log"
    ADD CONSTRAINT "team_roster_reminder_log_roster_id_fkey" FOREIGN KEY ("roster_id") REFERENCES "public"."team_roster"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_roster"
    ADD CONSTRAINT "team_roster_upline_id_fkey" FOREIGN KEY ("upline_id") REFERENCES "public"."agents"("id") ON DELETE CASCADE;



ALTER TABLE "public"."agent_auto_nudge_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_closure" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_email_changes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_nudges" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agent_training_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."agents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "agents_admin_read" ON "public"."agents" FOR SELECT TO "authenticated" USING ((( SELECT "private"."my_role"() AS "my_role") = 'admin'::"public"."agent_role"));



CREATE POLICY "agents_select" ON "public"."agents" FOR SELECT TO "authenticated" USING (( SELECT "private"."is_upline_of"("agents"."id") AS "is_upline_of"));



CREATE POLICY "agents_update_self" ON "public"."agents" FOR UPDATE TO "authenticated" USING (("id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."announcement_dismissals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "announcement_dismissals_own" ON "public"."announcement_dismissals" TO "authenticated" USING (("agent_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("agent_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."announcements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "announcements_select" ON "public"."announcements" FOR SELECT TO "authenticated" USING ((("active" = true) OR (( SELECT "private"."my_role"() AS "my_role") = 'admin'::"public"."agent_role")));



ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appointments_own" ON "public"."appointments" TO "authenticated" USING (("agent_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("agent_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "audit_admin_read" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ((( SELECT "private"."my_role"() AS "my_role") = 'admin'::"public"."agent_role"));



CREATE POLICY "audit_leader_read" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "private"."my_org"() AS "my_org")) AND (( SELECT "private"."my_role"() AS "my_role") = 'leader'::"public"."agent_role")));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."call_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "call_logs_own" ON "public"."call_logs" TO "authenticated" USING (("agent_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("agent_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "closure_select" ON "public"."agent_closure" FOR SELECT TO "authenticated" USING (("ancestor_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contacts_own" ON "public"."contacts" TO "authenticated" USING (("agent_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("agent_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."daily_metrics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedback_admin_read" ON "public"."feedback" FOR SELECT TO "authenticated" USING ((( SELECT "private"."my_role"() AS "my_role") = 'admin'::"public"."agent_role"));



CREATE POLICY "feedback_admin_update" ON "public"."feedback" FOR UPDATE TO "authenticated" USING ((( SELECT "private"."my_role"() AS "my_role") = 'admin'::"public"."agent_role")) WITH CHECK ((( SELECT "private"."my_role"() AS "my_role") = 'admin'::"public"."agent_role"));



CREATE POLICY "feedback_insert" ON "public"."feedback" FOR INSERT TO "authenticated" WITH CHECK (("agent_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "feedback_select_own" ON "public"."feedback" FOR SELECT TO "authenticated" USING (("agent_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitations_insert" ON "public"."invitations" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "private"."my_role"() AS "my_role") = ANY (ARRAY['leader'::"public"."agent_role", 'admin'::"public"."agent_role"])) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org")) AND ( SELECT "private"."is_upline_of"("invitations"."upline_id") AS "is_upline_of")));



CREATE POLICY "invitations_read" ON "public"."invitations" FOR SELECT TO "authenticated" USING (((( SELECT "private"."my_role"() AS "my_role") = ANY (ARRAY['leader'::"public"."agent_role", 'admin'::"public"."agent_role"])) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org"))));



CREATE POLICY "invitations_update" ON "public"."invitations" FOR UPDATE TO "authenticated" USING (((( SELECT "private"."my_role"() AS "my_role") = ANY (ARRAY['leader'::"public"."agent_role", 'admin'::"public"."agent_role"])) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org")))) WITH CHECK (("org_id" = ( SELECT "private"."my_org"() AS "my_org")));



CREATE POLICY "metrics_own" ON "public"."daily_metrics" FOR SELECT TO "authenticated" USING (("agent_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."mfa_recovery_codes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mfa_recovery_codes_own" ON "public"."mfa_recovery_codes" FOR SELECT TO "authenticated" USING (("agent_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."notification_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_prefs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_prefs_own" ON "public"."notification_prefs" TO "authenticated" USING (("agent_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("agent_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "organizations_admin_read" ON "public"."organizations" FOR SELECT TO "authenticated" USING ((( SELECT "private"."my_role"() AS "my_role") = 'admin'::"public"."agent_role"));



CREATE POLICY "organizations_select" ON "public"."organizations" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "private"."my_org"() AS "my_org")));



CREATE POLICY "organizations_update_own" ON "public"."organizations" FOR UPDATE TO "authenticated" USING ((("id" = ( SELECT "private"."my_org"() AS "my_org")) AND (( SELECT "private"."my_role"() AS "my_role") = ANY (ARRAY['leader'::"public"."agent_role", 'admin'::"public"."agent_role"])))) WITH CHECK ((("id" = ( SELECT "private"."my_org"() AS "my_org")) AND (( SELECT "private"."my_role"() AS "my_role") = ANY (ARRAY['leader'::"public"."agent_role", 'admin'::"public"."agent_role"]))));



ALTER TABLE "public"."recruiting_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "recruiting_own" ON "public"."recruiting_logs" TO "authenticated" USING (("agent_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("agent_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."sales" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_own" ON "public"."sales" TO "authenticated" USING (("agent_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("agent_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."targets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "targets_insert" ON "public"."targets" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "private"."my_role"() AS "my_role") = ANY (ARRAY['leader'::"public"."agent_role", 'admin'::"public"."agent_role"])) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org")) AND (("agent_id" IS NULL) OR ( SELECT "private"."is_upline_of"("targets"."agent_id") AS "is_upline_of"))));



CREATE POLICY "targets_read" ON "public"."targets" FOR SELECT TO "authenticated" USING ((("org_id" = ( SELECT "private"."my_org"() AS "my_org")) AND (("agent_id" IS NULL) OR ( SELECT "private"."is_upline_of"("targets"."agent_id") AS "is_upline_of"))));



CREATE POLICY "targets_update" ON "public"."targets" FOR UPDATE TO "authenticated" USING (((( SELECT "private"."my_role"() AS "my_role") = ANY (ARRAY['leader'::"public"."agent_role", 'admin'::"public"."agent_role"])) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org")))) WITH CHECK (("org_id" = ( SELECT "private"."my_org"() AS "my_org")));



ALTER TABLE "public"."team_roster" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_roster_delete" ON "public"."team_roster" FOR DELETE TO "authenticated" USING (((( SELECT "private"."my_role"() AS "my_role") = ANY (ARRAY['leader'::"public"."agent_role", 'admin'::"public"."agent_role"])) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org")) AND ( SELECT "private"."is_upline_of"("team_roster"."upline_id") AS "is_upline_of")));



CREATE POLICY "team_roster_insert" ON "public"."team_roster" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "private"."my_role"() AS "my_role") = ANY (ARRAY['leader'::"public"."agent_role", 'admin'::"public"."agent_role"])) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org")) AND ( SELECT "private"."is_upline_of"("team_roster"."upline_id") AS "is_upline_of")));



CREATE POLICY "team_roster_read" ON "public"."team_roster" FOR SELECT TO "authenticated" USING (((( SELECT "private"."my_role"() AS "my_role") = ANY (ARRAY['leader'::"public"."agent_role", 'admin'::"public"."agent_role"])) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org"))));



ALTER TABLE "public"."team_roster_reminder_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "team_roster_update" ON "public"."team_roster" FOR UPDATE TO "authenticated" USING (((( SELECT "private"."my_role"() AS "my_role") = ANY (ARRAY['leader'::"public"."agent_role", 'admin'::"public"."agent_role"])) AND ("org_id" = ( SELECT "private"."my_org"() AS "my_org")) AND ( SELECT "private"."is_upline_of"("team_roster"."upline_id") AS "is_upline_of"))) WITH CHECK ((("org_id" = ( SELECT "private"."my_org"() AS "my_org")) AND ( SELECT "private"."is_upline_of"("team_roster"."upline_id") AS "is_upline_of")));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "private"."enqueue_due_notifications"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ping_app_route"("p_path" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ping_legacy_notifications"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ping_notification_drain"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."purge_old_call_logs"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."admin_create_announcement"("p_actor_id" "uuid", "p_message" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_create_announcement"("p_actor_id" "uuid", "p_message" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_daily_active_loggers"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_daily_active_loggers"("p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_delete_org"("p_actor_id" "uuid", "p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_delete_org"("p_actor_id" "uuid", "p_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_hard_delete_agent"("p_actor_id" "uuid", "p_agent_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_hard_delete_agent"("p_actor_id" "uuid", "p_agent_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_move_agent"("p_actor_id" "uuid", "p_agent_id" "uuid", "p_new_upline_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_move_agent"("p_actor_id" "uuid", "p_agent_id" "uuid", "p_new_upline_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_reactivate_agent"("p_actor_id" "uuid", "p_agent_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reactivate_agent"("p_actor_id" "uuid", "p_agent_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_agent_role"("p_actor_id" "uuid", "p_agent_id" "uuid", "p_role" "public"."agent_role", "p_org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_agent_role"("p_actor_id" "uuid", "p_agent_id" "uuid", "p_role" "public"."agent_role", "p_org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_announcement_active"("p_actor_id" "uuid", "p_announcement_id" "uuid", "p_active" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_announcement_active"("p_actor_id" "uuid", "p_announcement_id" "uuid", "p_active" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."agent_aggregate"("p_agent_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."agent_aggregate"("p_agent_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."agent_aggregate"("p_agent_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."agent_daily_activity"("p_agent_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."agent_daily_activity"("p_agent_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";
GRANT ALL ON FUNCTION "public"."agent_daily_activity"("p_agent_id" "uuid", "p_from" "date", "p_to" "date") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."agent_daily_breakdown"("p_from" "date", "p_to" "date", "p_agent_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."agent_daily_breakdown"("p_from" "date", "p_to" "date", "p_agent_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."agent_daily_breakdown"("p_from" "date", "p_to" "date", "p_agent_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."audit_target_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."audit_target_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_rate_limit"("p_scope" "text", "p_limit" integer, "p_window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_scope" "text", "p_limit" integer, "p_window_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_scope" "text", "p_limit" integer, "p_window_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."closure_on_insert"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."closure_on_insert"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."closure_on_move"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."closure_on_move"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_invitation"("p_email" "text", "p_role" "public"."agent_role") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_invitation"("p_email" "text", "p_role" "public"."agent_role") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_invitation"("p_email" "text", "p_role" "public"."agent_role") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cycle_end"("d" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cycle_end"("d" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cycle_end"("d" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cycle_start"("d" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cycle_start"("d" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cycle_start"("d" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."deactivate_agent"("p_agent_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."deactivate_agent"("p_agent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."deactivate_agent"("p_agent_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."drain_metrics"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."drain_metrics"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_same_org"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_same_org"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_metrics"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_metrics"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_agent_privileged_columns"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_agent_privileged_columns"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_followups"("p_as_of" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_target"("p_period_start" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_target"("p_period_start" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_target"("p_period_start" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."nudge_agent"("p_agent_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."nudge_agent"("p_agent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."nudge_agent"("p_agent_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."pgmq_archive"("queue_name" "text", "msg_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pgmq_archive"("queue_name" "text", "msg_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."pgmq_delete"("queue_name" "text", "msg_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pgmq_delete"("queue_name" "text", "msg_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."pgmq_read"("queue_name" "text", "vt" integer, "qty" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."pgmq_read"("queue_name" "text", "vt" integer, "qty" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."provision_org"("p_org_name" "text", "p_smd_email" "text", "p_smd_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."provision_org"("p_org_name" "text", "p_smd_email" "text", "p_smd_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_roster_training_reminder"("p_roster_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_roster_training_reminder"("p_roster_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_roster_training_reminder"("p_roster_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_training_reminder"("p_agent_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_training_reminder"("p_agent_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_training_reminder"("p_agent_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_auto_call_nudges"("p_agent_id" "uuid", "p_enabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_auto_call_nudges"("p_agent_id" "uuid", "p_enabled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_auto_call_nudges"("p_agent_id" "uuid", "p_enabled" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_org_from_agent"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_org_from_agent"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_org_from_agent_nullable"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_org_from_agent_nullable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_target"("p_agent_id" "uuid", "p_effective_from" "date", "p_calls_per_cycle" integer, "p_appts_held_per_cycle" integer, "p_premium_cents_per_cycle" bigint, "p_min_calls_per_day" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_target"("p_agent_id" "uuid", "p_effective_from" "date", "p_calls_per_cycle" integer, "p_appts_held_per_cycle" integer, "p_premium_cents_per_cycle" bigint, "p_min_calls_per_day" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_target"("p_agent_id" "uuid", "p_effective_from" "date", "p_calls_per_cycle" integer, "p_appts_held_per_cycle" integer, "p_premium_cents_per_cycle" bigint, "p_min_calls_per_day" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."system_effective_target"("p_agent_id" "uuid", "p_period_start" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."system_effective_target"("p_agent_id" "uuid", "p_period_start" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."system_team_period_summary"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."system_team_period_summary"("p_leader_id" "uuid", "p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."team_breakdown"("p_from" "date", "p_to" "date", "p_agent_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."team_breakdown"("p_from" "date", "p_to" "date", "p_agent_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."team_breakdown"("p_from" "date", "p_to" "date", "p_agent_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."team_day_summary"("p_date" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."team_day_summary"("p_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."team_day_summary"("p_date" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."team_inactive"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."team_inactive"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."team_inactive"("p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."team_period_summary"("p_from" "date", "p_to" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."team_period_summary"("p_from" "date", "p_to" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."team_period_summary"("p_from" "date", "p_to" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."team_target"("p_agent_id" "uuid", "p_period_start" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."team_target"("p_agent_id" "uuid", "p_period_start" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."team_target"("p_agent_id" "uuid", "p_period_start" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."team_trend"("p_weeks" integer, "p_agent_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."team_trend"("p_weeks" integer, "p_agent_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."team_trend"("p_weeks" integer, "p_agent_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."week_start"("d" "date") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."week_start"("d" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."week_start"("d" "date") TO "service_role";



GRANT ALL ON TABLE "public"."agent_auto_nudge_log" TO "service_role";



GRANT ALL ON TABLE "public"."agent_closure" TO "anon";
GRANT ALL ON TABLE "public"."agent_closure" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_closure" TO "service_role";



GRANT ALL ON TABLE "public"."agent_email_changes" TO "service_role";



GRANT ALL ON TABLE "public"."agent_nudges" TO "service_role";



GRANT ALL ON TABLE "public"."agent_training_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."agents" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."agents" TO "authenticated";
GRANT ALL ON TABLE "public"."agents" TO "service_role";



GRANT UPDATE("full_name") ON TABLE "public"."agents" TO "authenticated";



GRANT UPDATE("time_zone") ON TABLE "public"."agents" TO "authenticated";



GRANT UPDATE("terms_accepted_at") ON TABLE "public"."agents" TO "authenticated";



GRANT ALL ON TABLE "public"."announcement_dismissals" TO "anon";
GRANT ALL ON TABLE "public"."announcement_dismissals" TO "authenticated";
GRANT ALL ON TABLE "public"."announcement_dismissals" TO "service_role";



GRANT ALL ON TABLE "public"."announcements" TO "anon";
GRANT ALL ON TABLE "public"."announcements" TO "authenticated";
GRANT ALL ON TABLE "public"."announcements" TO "service_role";



GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."call_logs" TO "anon";
GRANT ALL ON TABLE "public"."call_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."call_logs" TO "service_role";



GRANT ALL ON TABLE "public"."contacts" TO "anon";
GRANT ALL ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



GRANT ALL ON TABLE "public"."daily_metrics" TO "anon";
GRANT ALL ON TABLE "public"."daily_metrics" TO "authenticated";
GRANT ALL ON TABLE "public"."daily_metrics" TO "service_role";



GRANT ALL ON TABLE "public"."feedback" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."feedback" TO "authenticated";
GRANT ALL ON TABLE "public"."feedback" TO "service_role";



GRANT UPDATE("status") ON TABLE "public"."feedback" TO "authenticated";



GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."mfa_recovery_codes" TO "anon";
GRANT ALL ON TABLE "public"."mfa_recovery_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."mfa_recovery_codes" TO "service_role";



GRANT ALL ON TABLE "public"."notification_log" TO "service_role";



GRANT ALL ON TABLE "public"."notification_prefs" TO "anon";
GRANT ALL ON TABLE "public"."notification_prefs" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_prefs" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT UPDATE("name") ON TABLE "public"."organizations" TO "authenticated";



GRANT UPDATE("logo_path") ON TABLE "public"."organizations" TO "authenticated";



GRANT ALL ON TABLE "public"."recruiting_logs" TO "anon";
GRANT ALL ON TABLE "public"."recruiting_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."recruiting_logs" TO "service_role";



GRANT ALL ON TABLE "public"."sales" TO "anon";
GRANT ALL ON TABLE "public"."sales" TO "authenticated";
GRANT ALL ON TABLE "public"."sales" TO "service_role";



GRANT ALL ON TABLE "public"."targets" TO "anon";
GRANT ALL ON TABLE "public"."targets" TO "authenticated";
GRANT ALL ON TABLE "public"."targets" TO "service_role";



GRANT ALL ON TABLE "public"."team_roster" TO "anon";
GRANT ALL ON TABLE "public"."team_roster" TO "authenticated";
GRANT ALL ON TABLE "public"."team_roster" TO "service_role";



GRANT ALL ON TABLE "public"."team_roster_reminder_log" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";








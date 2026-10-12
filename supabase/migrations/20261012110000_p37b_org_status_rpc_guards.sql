-- P37b: org-status guards inside authenticated-callable SECURITY DEFINER RPCs.
--
-- Definer functions run as the table owner and skip RLS, so P37a's
-- restrictive policies don't reach them. Each function below is its live
-- definition (generated from pg_get_functiondef against a database at
-- P37a, not hand-copied) plus exactly one guard line:
--   writes -> private.assert_org_writable()  (active org only)
--   reads  -> private.assert_org_readable()  (active/read_only; suspended
--             only for the org's SMD -- keeps team export working)
-- Platform admin passes both. CREATE OR REPLACE keeps owner and grants.
--
-- Deliberately unguarded: check_rate_limit (a counter, the guarded write
-- after it is what matters), delete_push_subscription (approved exemption),
-- cycle_start/cycle_end/week_start (pure date math, no data).
--
-- Re-runnable.

-- create_invitation: + private.assert_org_writable() (plpgsql)
CREATE OR REPLACE FUNCTION public.create_invitation(p_email text, p_role agent_role DEFAULT 'associate'::agent_role)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_token text; v_me uuid := (select auth.uid()); v_org uuid; v_role public.agent_role;
begin
  perform private.assert_org_writable();
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
end $function$;

-- deactivate_agent: + private.assert_org_writable() (plpgsql)
CREATE OR REPLACE FUNCTION public.deactivate_agent(p_agent_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_me uuid := (select auth.uid()); v_role public.agent_role; v_org uuid;
begin
  perform private.assert_org_writable();
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
end $function$;

-- nudge_agent: + private.assert_org_writable() (plpgsql)
CREATE OR REPLACE FUNCTION public.nudge_agent(p_agent_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_me uuid := (select auth.uid()); v_role public.agent_role; v_org uuid; v_updated boolean;
begin
  perform private.assert_org_writable();
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
end $function$;

-- save_push_subscription: + private.assert_org_writable() (plpgsql)
CREATE OR REPLACE FUNCTION public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me uuid := (select auth.uid());
begin
  perform private.assert_org_writable();
  if v_me is null or private.my_org() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- One browser has one endpoint. If someone else was signed in on this
  -- device before, the subscription moves to whoever enabled it last.
  insert into public.push_subscriptions (agent_id, endpoint, p256dh, auth, user_agent)
  values (v_me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set agent_id = excluded.agent_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen_at = now();
end $function$;

-- send_roster_training_reminder: + private.assert_org_writable() (plpgsql)
CREATE OR REPLACE FUNCTION public.send_roster_training_reminder(p_roster_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me uuid := (select auth.uid());
  v_role public.agent_role;
  v_org uuid;
  v_roster_org uuid;
  v_roster_upline uuid;
  v_last timestamptz;
begin
  perform private.assert_org_writable();
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
end $function$;

-- send_training_reminder: + private.assert_org_writable() (plpgsql)
CREATE OR REPLACE FUNCTION public.send_training_reminder(p_agent_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_me uuid := (select auth.uid()); v_role public.agent_role; v_org uuid; v_updated boolean;
begin
  perform private.assert_org_writable();
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
end $function$;

-- set_auto_call_nudges: + private.assert_org_writable() (plpgsql)
CREATE OR REPLACE FUNCTION public.set_auto_call_nudges(p_agent_id uuid, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_me uuid := (select auth.uid()); v_role public.agent_role; v_org uuid;
begin
  perform private.assert_org_writable();
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
end $function$;

-- set_target: + private.assert_org_writable() (plpgsql)
CREATE OR REPLACE FUNCTION public.set_target(p_agent_id uuid, p_effective_from date, p_calls_per_cycle integer, p_appts_held_per_cycle integer, p_premium_cents_per_cycle bigint, p_min_calls_per_day integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me uuid := (select auth.uid());
  v_role public.agent_role;
  v_org uuid;
begin
  perform private.assert_org_writable();
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
end $function$;

-- agent_aggregate: + private.assert_org_readable() (sql)
CREATE OR REPLACE FUNCTION public.agent_aggregate(p_agent_id uuid, p_from date, p_to date)
 RETURNS TABLE(calls_made integer, appts_set integer, appts_held integer, sales_count integer, premium_cents bigint, referrals_given integer, recruiting_convos integer, out_connected integer, out_voicemail integer, out_no_answer integer, out_appt_set integer, out_not_interested integer, src_warm_market integer, src_referral integer, src_cold integer, src_social_media integer, src_friend integer, src_other integer, src_existing_client integer, src_existing_recruit integer, appt_scheduled integer, appt_held integer, appt_no_show integer, appt_rescheduled integer, appt_cancelled integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.assert_org_readable();
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
$function$;

-- agent_daily_activity: + private.assert_org_readable() (sql)
CREATE OR REPLACE FUNCTION public.agent_daily_activity(p_agent_id uuid, p_from date, p_to date)
 RETURNS TABLE(activity_date date, calls_made integer, appts_set integer, appts_held integer, premium_cents bigint, min_calls_target integer, min_met boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.assert_org_readable();
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
$function$;

-- agent_daily_breakdown: + private.assert_org_readable() (sql)
CREATE OR REPLACE FUNCTION public.agent_daily_breakdown(p_from date, p_to date, p_agent_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(activity_date date, calls_made integer, appts_set integer, appt_held integer, recruiting_convos integer, sales_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.assert_org_readable();
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
$function$;

-- my_followups: + private.assert_org_readable() (sql)
CREATE OR REPLACE FUNCTION public.my_followups(p_as_of date DEFAULT CURRENT_DATE)
 RETURNS TABLE(call_id uuid, contact_id uuid, contact_name text, last_note text, kind text, due_date date, appointment_at timestamp with time zone, days_late integer, times_called integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.assert_org_readable();
  -- Always exactly one row, even for a caller with no agents row: a
  -- zero-row CTE would make `(select tz from me)` NULL, and
  -- `at time zone NULL` is NULL, which would silently drop every dated
  -- branch below.
  with me as (
    select coalesce(
      (select a.time_zone from public.agents a where a.id = (select auth.uid())),
      'America/New_York'
    ) as tz
  )
  -- 1. Call follow-ups. Unchanged from P23.
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

  -- 2. Appointments still awaiting an outcome (P25 C1). Due on the day
  --    they are FOR -- scheduled_for's date in the agent's own zone, with
  --    appt_date as the fallback for a legacy or imported row that has no
  --    scheduled_for at all.
  --
  --    days_late measures from greatest(due date, set_on) (P25 C2, E5): an
  --    appointment entered after the fact has not been sitting unresolved
  --    since the day it was for -- the agent has only had it since they
  --    logged it. A normal appointment is booked on or before its own
  --    date, so greatest() picks the due date and nothing changes.
  select ap.id, ct.id, ct.full_name, ap.notes,
         'appointment'::text,
         coalesce((ap.scheduled_for at time zone (select tz from me))::date, ap.appt_date),
         ap.scheduled_for,
         (p_as_of - greatest(
            coalesce((ap.scheduled_for at time zone (select tz from me))::date, ap.appt_date),
            ap.set_on))::int,
         (select count(*)::int from public.call_logs x where x.contact_id = ct.id)
  from public.appointments ap
  join public.contacts ct on ct.id = ap.contact_id
  where ap.agent_id = (select auth.uid())
    and ap.status = 'scheduled'
    and coalesce((ap.scheduled_for at time zone (select tz from me))::date, ap.appt_date) <= p_as_of

  union all

  -- 3. Legacy appointments that live only on a call log. The `not exists`
  --    clause is the same dedup recompute_day uses: once the call form
  --    creates the appointment row, that row is branch 2's job and this
  --    branch must not show it a second time.
  --
  --    Same E5 rule, measured from the call's own date.
  select cl.id, ct.id, ct.full_name, cl.notes,
         'call_appointment'::text,
         (cl.appointment_at at time zone (select tz from me))::date,
         cl.appointment_at,
         (p_as_of - greatest(
            (cl.appointment_at at time zone (select tz from me))::date,
            cl.call_date))::int,
         (select count(*)::int from public.call_logs x where x.contact_id = ct.id)
  from public.call_logs cl
  join public.contacts ct on ct.id = cl.contact_id
  where cl.agent_id = (select auth.uid())
    and cl.appointment_at is not null
    and cl.appointment_done_at is null
    and (cl.appointment_at at time zone (select tz from me))::date <= p_as_of
    and not exists (
      select 1 from public.appointments ap2 where ap2.source_call_log_id = cl.id
    )

  union all

  -- 4. F12: a follow-up set on a resolved appointment. Restricted to
  --    resolved rows -- a scheduled one is already in branch 2, and
  --    including it here would queue one appointment twice under two
  --    different due dates.
  select ap.id, ct.id, ct.full_name, ap.notes,
         'appointment_follow_up'::text, ap.follow_up_on, null::timestamptz,
         (p_as_of - ap.follow_up_on)::int,
         (select count(*)::int from public.call_logs x where x.contact_id = ct.id)
  from public.appointments ap
  join public.contacts ct on ct.id = ap.contact_id
  where ap.agent_id = (select auth.uid())
    and ap.status <> 'scheduled'
    and ap.follow_up_on is not null
    and ap.follow_up_on <= p_as_of
    and ap.follow_up_done_at is null

  order by 6, 7 nulls first;
$function$;

-- my_target: + private.assert_org_readable() (sql)
CREATE OR REPLACE FUNCTION public.my_target(p_period_start date)
 RETURNS TABLE(calls_per_cycle integer, appts_held_per_cycle integer, premium_cents_per_cycle bigint, min_calls_per_day integer, md_deadline date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.assert_org_readable();
  select * from private.effective_target((select auth.uid()), p_period_start);
$function$;

-- team_breakdown: + private.assert_org_readable() (sql)
CREATE OR REPLACE FUNCTION public.team_breakdown(p_from date, p_to date, p_agent_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(calls_made integer, appts_set integer, appts_held integer, sales_count integer, premium_cents bigint, referrals_given integer, recruiting_convos integer, out_connected integer, out_voicemail integer, out_no_answer integer, out_appt_set integer, out_not_interested integer, src_warm_market integer, src_referral integer, src_cold integer, src_social_media integer, src_friend integer, src_other integer, src_existing_client integer, src_existing_recruit integer, appt_scheduled integer, appt_held integer, appt_no_show integer, appt_rescheduled integer, appt_cancelled integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.assert_org_readable();
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
$function$;

-- team_day_summary: + private.assert_org_readable() (sql)
CREATE OR REPLACE FUNCTION public.team_day_summary(p_date date)
 RETURNS TABLE(agent_id uuid, full_name text, calls_made integer, appts_set integer, appts_held integer, premium_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.assert_org_readable();
  select a.id, a.full_name,
         coalesce(m.calls_made,0), coalesce(m.appts_set,0),
         coalesce(m.appt_held,0), coalesce(m.premium_cents,0)
  from public.agent_closure c
  join public.agents a on a.id = c.descendant_id and a.status = 'active'
  left join public.daily_metrics m
    on m.agent_id = a.id and m.activity_date = p_date
  where c.ancestor_id = (select auth.uid())
    and a.org_id = (select private.my_org());
$function$;

-- team_inactive: + private.assert_org_readable() (sql)
CREATE OR REPLACE FUNCTION public.team_inactive(p_days integer DEFAULT 7)
 RETURNS TABLE(agent_id uuid, full_name text, last_logged_at timestamp with time zone, days_quiet integer, auto_call_nudges_enabled boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.assert_org_readable();
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
$function$;

-- team_period_summary: + private.assert_org_readable() (sql)
CREATE OR REPLACE FUNCTION public.team_period_summary(p_from date, p_to date)
 RETURNS TABLE(agent_id uuid, full_name text, depth integer, calls_made integer, appts_set integer, appts_held integer, premium_cents bigint, calls_target integer, appts_held_target integer, premium_cents_target bigint, min_calls_target integer, pct_calls numeric, streak_days integer, last_logged_at timestamp with time zone, has_override boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.assert_org_readable();
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
         t.min_calls_per_day,
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
$function$;

-- team_target: + private.assert_org_readable() (sql)
CREATE OR REPLACE FUNCTION public.team_target(p_agent_id uuid, p_period_start date)
 RETURNS TABLE(calls_per_cycle integer, appts_held_per_cycle integer, premium_cents_per_cycle bigint, min_calls_per_day integer, md_deadline date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.assert_org_readable();
  select * from private.effective_target(p_agent_id, p_period_start)
  where (select private.is_upline_of(p_agent_id));
$function$;

-- team_trend: + private.assert_org_readable() (sql)
CREATE OR REPLACE FUNCTION public.team_trend(p_weeks integer DEFAULT 8, p_agent_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(week_start date, calls_made bigint, premium_cents bigint, calls_target bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select private.assert_org_readable();
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
$function$;

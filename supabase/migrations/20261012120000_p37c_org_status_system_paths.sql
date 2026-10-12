-- P37c: service-role / cron paths that write on behalf of an org.
--
-- Bodies are live definitions (pg_get_functiondef at P37b) with only the
-- marked additions:
--   enqueue_due_pushes / enqueue_due_notifications: no reminders,
--     appointment pushes, morning briefs or email nudges for agents whose
--     org is not 'active' -- they can't act on them. Reminders have a
--     1-day window, so a paused org doesn't get a backlog on reactivation.
--   handle_new_user: an invitation into a non-active org can't be accepted.
--
-- Left running on purpose (approved): drain_metrics/recompute_day (rebuilds
-- only rows dirtied before the flip; rule 13), purge_old_call_logs and
-- purge_old_notifications (retention), push drain housekeeping.
--
-- Re-runnable.

-- private.enqueue_due_pushes: skip agents whose org is not 'active' (3 site(s))
CREATE OR REPLACE FUNCTION private.enqueue_due_pushes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_enqueued int := 0;
  rec record;
begin
  -- 1. Reminders.
  with due as (
    select r.id, r.agent_id, r.title, r.push, r.remind_at,
           coalesce(nullif(a.time_zone, ''), 'America/New_York') as tz
    from public.reminders r
    join public.agents a on a.id = r.agent_id and a.status = 'active' and private.org_status(a.org_id) = 'active'
    where r.sent_at is null
      and r.dismissed_at is null
      and r.remind_at - make_interval(mins => r.lead_minutes) <= now()
      and r.remind_at - make_interval(mins => r.lead_minutes) > now() - interval '1 day'
    for update of r skip locked
  ),
  marked as (
    update public.reminders r set sent_at = now()
    from due where r.id = due.id
    returning r.id
  )
  insert into public.notifications (agent_id, kind, title, body, link, source_key, push)
  select d.agent_id, 'reminder', d.title,
         'Reminder for ' || to_char(d.remind_at at time zone d.tz, 'FMHH12:MI AM'),
         '/today', 'reminder:' || d.id::text,
         d.push and coalesce(p.push_reminders, true)
  from due d
  join marked m on m.id = d.id
  left join public.notification_prefs p on p.agent_id = d.agent_id
  on conflict (agent_id, source_key) do nothing;

  -- 2. Appointments starting within 15 minutes. The key carries the
  --    scheduled time, so a rescheduled slot alerts again.
  insert into public.notifications (agent_id, kind, title, body, link, source_key, push)
  select ap.agent_id, 'appointment',
         -- "Marketing Presentation in 15 min". Labels mirror APPT_TYPES in
         -- src/lib/appointment-types.ts; free-text legacy values show as-is.
         case ap.appt_type
           when 'application' then 'Application Submitted'
           when 'follow_up' then 'Follow Up'
           when 'marketing_presentation' then 'Marketing Presentation'
           when 'other' then 'Appointment'
           when 'solutions_presentation' then 'Solutions Presentation'
           else coalesce(nullif(btrim(ap.appt_type), ''), 'Appointment')
         end
           || ' in ' || greatest(1, ceil(extract(epoch from ap.scheduled_for - now()) / 60))::int || ' min',
         ct.full_name || ' · ' || to_char(ap.scheduled_for at time zone coalesce(nullif(a.time_zone, ''), 'America/New_York'), 'FMHH12:MI AM'),
         '/appointments',
         'appt15:' || ap.id::text || ':' || extract(epoch from ap.scheduled_for)::bigint::text,
         coalesce(p.push_appointments, true)
  from public.appointments ap
  join public.agents a on a.id = ap.agent_id and a.status = 'active' and private.org_status(a.org_id) = 'active'
  join public.contacts ct on ct.id = ap.contact_id
  left join public.notification_prefs p on p.agent_id = ap.agent_id
  where ap.status = 'scheduled'
    and ap.scheduled_for > now()
    and ap.scheduled_for <= now() + interval '15 minutes'
  on conflict (agent_id, source_key) do nothing;

  -- 3. Morning brief. Counts only the agent's OWN rows for their own local
  --    day -- a greeting, not a metric (dashboards still read daily_metrics).
  insert into public.notifications (agent_id, kind, title, body, link, source_key, push)
  select n.agent_id, 'morning_brief',
         'Good morning, ' || split_part(n.full_name, ' ', 1),
         c.appts || case when c.appts = 1 then ' appointment · ' else ' appointments · ' end
           || c.todos || case when c.todos = 1 then ' to-do' else ' to-dos' end
           || ' today. Open My Day to get started.',
         '/today',
         'brief:' || n.local_date::text,
         coalesce(p.push_morning_brief, true)
  from (
    select a.id as agent_id, a.full_name,
           coalesce(nullif(a.time_zone, ''), 'America/New_York') as tz,
           (now() at time zone coalesce(nullif(a.time_zone, ''), 'America/New_York')) as local_ts,
           (now() at time zone coalesce(nullif(a.time_zone, ''), 'America/New_York'))::date as local_date
    from public.agents a
    where a.status = 'active' and private.org_status(a.org_id) = 'active' and a.role in ('associate', 'leader')
  ) n
  cross join lateral (
    select
      (select count(*) from public.appointments ap
         where ap.agent_id = n.agent_id and ap.status = 'scheduled'
           and (ap.scheduled_for at time zone n.tz)::date = n.local_date) as appts,
      (select count(*) from public.tasks t
         where t.agent_id = n.agent_id and t.done_at is null and t.due_on = n.local_date) as todos
  ) c
  left join public.notification_prefs p on p.agent_id = n.agent_id
  where extract(hour from n.local_ts) >= 8
    and extract(hour from n.local_ts) < 11
  on conflict (agent_id, source_key) do nothing;

  -- Enqueue every push-flagged row claimed above and not yet sent. Rows are
  -- picked by pushed_at IS NULL + a recent created_at, so a crash between
  -- the inserts and here is recovered on the next tick rather than lost.
  for rec in
    select nt.id
    from public.notifications nt
    where nt.push and nt.pushed_at is null
      and nt.created_at > now() - interval '10 minutes'
      and not exists (select 1 from pgmq.q_push_sends q where (q.message ->> 'notification_id')::uuid = nt.id)
  loop
    perform pgmq.send('push_sends', jsonb_build_object('notification_id', rec.id));
    v_enqueued := v_enqueued + 1;
  end loop;

  return v_enqueued;
end $function$;

-- private.enqueue_due_notifications: skip agents whose org is not 'active' (1 site(s))
CREATE OR REPLACE FUNCTION private.enqueue_due_notifications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      where a.status = 'active' and private.org_status(a.org_id) = 'active'
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
            -- P28: was `n.role in ('leader', 'admin')`. An admin has no
            -- downline, so their digest is all zeros and unturnoffable.
            and n.role = 'leader'
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

    -- P31: the evening nudge also lands in the bell and goes out as a web
    -- push, under the same "Evening nudge" setting and the same claim as
    -- the email -- one eligibility rule, not a second copy of it.
    -- enqueue_due_pushes() picks the row up for push on its next minute.
    if rec.kind = 'evening_nudge' then
      insert into public.notifications (agent_id, kind, title, body, link, source_key, push)
      values (rec.agent_id, 'evening_nudge',
              'You haven''t logged any calls today',
              'There''s still time. Log a call to keep your streak going.',
              '/log', 'nudge:' || rec.local_date::text, true)
      on conflict (agent_id, source_key) do nothing;
    end if;
  end loop;

  return v_enqueued;
end $function$;

-- public.handle_new_user: refuse accepting an invite into a non-active org
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv public.invitations%rowtype; v_name text;
begin
  select * into inv from public.invitations
  where lower(email) = lower(new.email)
    and accepted_at is null and revoked_at is null and expires_at > now()
  order by created_at desc limit 1;

  if inv.id is null then
    raise exception 'signup requires a valid invitation';
  end if;

  -- P37: no joining a read-only or suspended org. Admin invites are org-less.
  if inv.role <> 'admin' and coalesce(private.org_status(inv.org_id), '') <> 'active' then
    raise exception 'ORG_READ_ONLY: this team is not accepting new members right now'
      using errcode = '42501';
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
end $function$;

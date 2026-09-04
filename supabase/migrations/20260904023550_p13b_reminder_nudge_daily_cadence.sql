-- Product ask: the manual "Nudge" (My Team tab) and "Send reminder" (Members
-- tab, both the real-agent training reminder and the roster training
-- reminder) actions were rate-limited to once per 7 days each (p5a/p9b/p9c,
-- tightened for atomicity in p9f/p9e). SMDs want to be able to send these
-- once per day instead. Same atomic check-and-set shape as before, just a
-- shorter cooldown window and updated error text.

create or replace function public.nudge_agent(p_agent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.nudge_agent(uuid) from public, anon;
grant execute on function public.nudge_agent(uuid) to authenticated;

create or replace function public.send_training_reminder(p_agent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.send_training_reminder(uuid) from public, anon;
grant execute on function public.send_training_reminder(uuid) to authenticated;

create or replace function public.send_roster_training_reminder(p_roster_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.send_roster_training_reminder(uuid) from public, anon;
grant execute on function public.send_roster_training_reminder(uuid) to authenticated;

-- Training reminders for roster members who haven't been invited yet — the
-- original send_training_reminder RPC (p9b) requires a real public.agents
-- row, which only exists after an invite is accepted. Product decision:
-- email is now mandatory when adding a roster member, and a reminder can be
-- sent straight to that email with no invite/signup required first.
alter table public.team_roster add column last_training_reminder_at timestamptz;

create or replace function public.send_roster_training_reminder(p_roster_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_role public.agent_role;
  v_org uuid;
  v_roster_org uuid;
  v_last timestamptz;
begin
  select role, org_id into v_role, v_org from public.agents where id = v_me;
  if v_role not in ('leader','admin') then
    raise exception 'only a leader or admin can send a training reminder';
  end if;

  select org_id, last_training_reminder_at into v_roster_org, v_last
  from public.team_roster where id = p_roster_id;

  if v_roster_org is null or v_roster_org <> v_org then
    raise exception 'roster entry not found in caller''s org';
  end if;

  if v_last is not null and v_last > now() - interval '7 days' then
    raise exception 'already sent a training reminder to this person in the last 7 days';
  end if;

  update public.team_roster set last_training_reminder_at = now() where id = p_roster_id;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'roster.training_reminder_sent', 'team_roster', p_roster_id::text, '{}'::jsonb);
end $$;
revoke all on function public.send_roster_training_reminder(uuid) from public, anon;
grant execute on function public.send_roster_training_reminder(uuid) to authenticated;

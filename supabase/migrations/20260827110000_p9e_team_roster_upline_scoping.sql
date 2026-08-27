-- Security fix: team_roster_update/delete (p9b) and
-- send_roster_training_reminder (p9c) never checked is_upline_of, unlike
-- their own sibling policy/RPCs (team_roster_insert, send_training_reminder,
-- nudge_agent, deactivate_agent). Any leader/admin in an org could update,
-- delete, or send a training reminder to a roster entry outside their own
-- downline -- an in-org scope leak, not just role+org.

drop policy team_roster_update on public.team_roster;
create policy team_roster_update on public.team_roster for update to authenticated
  using ( (select private.my_role()) in ('leader','admin')
          and org_id = (select private.my_org())
          and (select private.is_upline_of(upline_id)) )
  with check ( org_id = (select private.my_org())
               and (select private.is_upline_of(upline_id)) );

drop policy team_roster_delete on public.team_roster;
create policy team_roster_delete on public.team_roster for delete to authenticated
  using ( (select private.my_role()) in ('leader','admin')
          and org_id = (select private.my_org())
          and (select private.is_upline_of(upline_id)) );

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
  if v_last is not null and v_last > now() - interval '7 days' then
    raise exception 'already sent a training reminder to this roster entry in the last 7 days';
  end if;

  update public.team_roster set last_training_reminder_at = now() where id = p_roster_id;
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'roster.training_reminder_sent', 'team_roster', p_roster_id::text, '{}'::jsonb);
end $$;
revoke all on function public.send_roster_training_reminder(uuid) from public, anon;
grant execute on function public.send_roster_training_reminder(uuid) to authenticated;

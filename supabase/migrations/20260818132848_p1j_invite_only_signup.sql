-- Invite-only. org_id, upline_id and role come from the invitation, never from
-- client-supplied metadata, so forged signup metadata cannot escalate.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
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
  values (new.id, inv.org_id, v_name, new.email, inv.upline_id, inv.role);

  update public.invitations set accepted_at = now() where id = inv.id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (inv.org_id, new.id, 'signup.accepted', 'agent', new.id::text,
          jsonb_build_object('invitation_id', inv.id, 'role', inv.role));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Audit every target change: an SMD quietly lowering a target mid-quarter
-- should leave a trace.
create or replace function public.audit_target_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (new.org_id, (select auth.uid()), lower(tg_op) || '.target', 'target', new.id::text,
          jsonb_build_object('agent_id', new.agent_id, 'effective_from', new.effective_from,
                             'calls', new.calls_per_week, 'min_per_day', new.min_calls_per_day));
  return new;
end $$;
create trigger targets_audit after insert or update on public.targets
  for each row execute function public.audit_target_change();

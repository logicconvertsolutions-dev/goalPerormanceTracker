-- Security fix: admin_move_agent, admin_reactivate_agent,
-- admin_set_agent_role, and admin_hard_delete_agent (p6a) never verified
-- the target agent belongs to the calling admin's own organization. Every
-- one of these RPCs is service-role-only and is the SOLE authorization
-- layer (the calling Server Action only checks session.agent.role ===
-- 'admin', per admin/agents/actions.ts) -- so any org's admin could pass
-- an arbitrary agentId belonging to a *different* organization and
-- reassign its upline, reactivate it, escalate its role, or permanently
-- hard-delete it. Fix: look up the actor's own org and require it match
-- the target's org, same shape as every other admin-scoped RPC in this
-- codebase (deactivate_agent, nudge_agent, etc. all scope via
-- is_upline_of/org_id).

create or replace function public.admin_move_agent(
  p_actor_id uuid, p_agent_id uuid, p_new_upline_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor_org uuid; v_org uuid; v_new_upline_org uuid;
begin
  select org_id into v_actor_org from public.agents where id = p_actor_id;
  select org_id into v_org from public.agents where id = p_agent_id;
  if v_org is null then raise exception 'agent not found'; end if;
  if v_actor_org is null or v_org <> v_actor_org then
    raise exception 'agent not found';
  end if;

  if p_new_upline_id is not null then
    select org_id into v_new_upline_org from public.agents where id = p_new_upline_id;
    if v_new_upline_org is null then raise exception 'new upline not found'; end if;
    -- The same-org trigger (p1e) and cycle guard already enforce this at
    -- the row level; this check exists purely for a clearer error message.
    if v_new_upline_org <> v_org then
      raise exception 'cannot move an agent to an upline in a different organization';
    end if;
  end if;

  update public.agents set upline_id = p_new_upline_id where id = p_agent_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.upline_moved', 'agent', p_agent_id::text,
          jsonb_build_object('new_upline_id', p_new_upline_id));
end $$;
revoke all on function public.admin_move_agent(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_move_agent(uuid, uuid, uuid) to service_role;

create or replace function public.admin_reactivate_agent(p_actor_id uuid, p_agent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor_org uuid; v_org uuid;
begin
  select org_id into v_actor_org from public.agents where id = p_actor_id;
  select org_id into v_org from public.agents where id = p_agent_id;
  if v_org is null then raise exception 'agent not found'; end if;
  if v_actor_org is null or v_org <> v_actor_org then
    raise exception 'agent not found';
  end if;

  update public.agents set status = 'active' where id = p_agent_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.reactivated', 'agent', p_agent_id::text, '{}'::jsonb);
end $$;
revoke all on function public.admin_reactivate_agent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_reactivate_agent(uuid, uuid) to service_role;

create or replace function public.admin_hard_delete_agent(p_actor_id uuid, p_agent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor_org uuid; v_org uuid; v_full_name text;
begin
  select org_id into v_actor_org from public.agents where id = p_actor_id;
  select org_id, full_name into v_org, v_full_name from public.agents where id = p_agent_id;
  if v_org is null then raise exception 'agent not found'; end if;
  if v_actor_org is null or v_org <> v_actor_org then
    raise exception 'agent not found';
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.hard_deleted', 'agent', p_agent_id::text,
          jsonb_build_object('full_name', v_full_name));

  delete from auth.users where id = p_agent_id;
exception when foreign_key_violation then
  raise exception 'cannot hard-delete: this agent has dependent rows (likely targets they set for someone else) -- reassign those first';
end $$;
revoke all on function public.admin_hard_delete_agent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_hard_delete_agent(uuid, uuid) to service_role;

-- Same missing check in admin_set_agent_role (p7b) -- role changes are the
-- most security-sensitive agent write there is (associate -> leader/admin
-- crosses the MFA-required, cross-org-read boundary), so a cross-org gap
-- here is the highest-impact of the four.
create or replace function public.admin_set_agent_role(
  p_actor_id uuid, p_agent_id uuid, p_role public.agent_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor_org uuid; v_org uuid; v_old_role public.agent_role;
begin
  select org_id into v_actor_org from public.agents where id = p_actor_id;
  select org_id, role into v_org, v_old_role from public.agents where id = p_agent_id;
  if v_org is null then raise exception 'agent not found'; end if;
  if v_actor_org is null or v_org <> v_actor_org then
    raise exception 'agent not found';
  end if;

  if v_old_role = p_role then return; end if;

  update public.agents set role = p_role where id = p_agent_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.role_changed', 'agent', p_agent_id::text,
          jsonb_build_object('old_role', v_old_role, 'new_role', p_role));
end $$;
revoke all on function public.admin_set_agent_role(uuid, uuid, public.agent_role)
  from public, anon, authenticated;
grant execute on function public.admin_set_agent_role(uuid, uuid, public.agent_role) to service_role;

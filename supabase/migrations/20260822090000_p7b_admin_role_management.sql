-- P7b: /admin/agents gets a role editor. Role changes are the most
-- security-sensitive agent write there is (associate -> leader/admin
-- crosses the MFA-required, cross-org-read boundary), so this follows the
-- exact same shape as admin_move_agent/admin_reactivate_agent (p6a):
-- revoked from every PostgREST role, callable only through the
-- service-role client from a Server Action that has already checked
-- session.agent.role === 'admin' (src/app/(app)/admin/agents/actions.ts).
-- auth.uid() is null in that context, so this never touches the
-- guard_agent_privileged_columns trigger at all.

create or replace function public.admin_set_agent_role(
  p_actor_id uuid, p_agent_id uuid, p_role public.agent_role)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_old_role public.agent_role;
begin
  select org_id, role into v_org, v_old_role from public.agents where id = p_agent_id;
  if v_org is null then raise exception 'agent not found'; end if;

  if v_old_role = p_role then return; end if;

  update public.agents set role = p_role where id = p_agent_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.role_changed', 'agent', p_agent_id::text,
          jsonb_build_object('old_role', v_old_role, 'new_role', p_role));
end $$;
revoke all on function public.admin_set_agent_role(uuid, uuid, public.agent_role)
  from public, anon, authenticated;
grant execute on function public.admin_set_agent_role(uuid, uuid, public.agent_role) to service_role;

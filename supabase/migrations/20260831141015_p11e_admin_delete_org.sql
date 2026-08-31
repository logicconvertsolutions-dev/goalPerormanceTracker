-- P11e: /admin/orgs — delete an organization outright (admin request only).
-- Genuinely irreversible: every agent in the org, everything hanging off
-- their agent_id (contacts, call_logs, appointments, sales, recruiting_logs,
-- daily_metrics, feedback, notification_prefs, agent_nudges, notification_log,
-- mfa_recovery_codes, agent_closure — same cascade admin_hard_delete_agent
-- (p6a) already relies on, just for every agent in the org at once), plus
-- the org-scoped rows that cascade directly off organizations.id (targets,
-- invitations, team_roster). Same pattern as admin_hard_delete_agent:
-- service-role only, called from a Server Action that has already checked
-- session.agent.role === 'admin' and MFA, so auth.uid() is null here and the
-- privileged-column guard trigger never enters into it.
create or replace function public.admin_delete_org(p_actor_id uuid, p_org_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.admin_delete_org(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_org(uuid, uuid) to service_role;

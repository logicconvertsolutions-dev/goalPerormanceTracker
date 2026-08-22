-- P6: admin agent lifecycle (/admin/agents) + audit visibility (/team/audit,
-- /admin/audit) + a real bug this phase's own testing surfaced in P2's
-- deactivate_agent.

-- ---------------------------------------------------------------------
-- Bug fix: guard_agent_privileged_columns blocks deactivate_agent.
--
-- Verified live against this project: a leader calling
-- public.deactivate_agent() on their own downline throws "privileged
-- column change requires admin", because the guard trigger checks the
-- ACTUAL caller's own agents.role (auth.uid()), not whether the write is
-- already being made by a SECURITY DEFINER function that performed its
-- own authorization (deactivate_agent already checks role + is_upline_of
-- before writing). The trigger has no way to distinguish "an associate
-- UPDATE-ing their own row directly" (must block) from "a vetted RPC that
-- already authorized this write" (must allow) -- so it blocks both.
--
-- Fix: a session-local flag a SECURITY DEFINER function can set
-- immediately before a write it has already authorized. `true` on
-- set_config makes it transaction-local (resets automatically), so it
-- can't leak into any later, unrelated statement in the same session.
create or replace function public.guard_agent_privileged_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
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

create or replace function public.deactivate_agent(p_agent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
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
revoke all on function public.deactivate_agent(uuid) from public, anon;
grant execute on function public.deactivate_agent(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- /team/audit — a leader sees their own org's audit trail (target
-- changes, invitations, deactivations, nudges). /admin/audit already works
-- via audit_admin_read (p1h) since that policy has no org filter.
-- ---------------------------------------------------------------------
create policy audit_leader_read on public.audit_log for select to authenticated
  using (
    org_id = (select private.my_org())
    and (select private.my_role()) = 'leader'
  );

-- ---------------------------------------------------------------------
-- /admin/agents: move between uplines, reactivate, hard-delete on request.
-- Same pattern as provision_org (p1m) -- revoked from every PostgREST
-- role, callable only via the service-role client from a Server Action
-- that has already checked session.agent.role === 'admin'. auth.uid() is
-- null in that context, so these never touch the guard trigger at all.
-- ---------------------------------------------------------------------

create or replace function public.admin_move_agent(
  p_actor_id uuid, p_agent_id uuid, p_new_upline_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_new_upline_org uuid;
begin
  select org_id into v_org from public.agents where id = p_agent_id;
  if v_org is null then raise exception 'agent not found'; end if;

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
declare v_org uuid;
begin
  select org_id into v_org from public.agents where id = p_agent_id;
  if v_org is null then raise exception 'agent not found'; end if;

  update public.agents set status = 'active' where id = p_agent_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.reactivated', 'agent', p_agent_id::text, '{}'::jsonb);
end $$;
revoke all on function public.admin_reactivate_agent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_reactivate_agent(uuid, uuid) to service_role;

-- A true hard delete (auth.users cascades to agents, which cascades to
-- every table FK'd to it -- contacts, call_logs, appointments, sales,
-- recruiting_logs, daily_metrics, agent_closure, notification_prefs,
-- agent_nudges, notification_log, mfa_recovery_codes, and targets.agent_id).
-- This does NOT retain anonymised daily counts -- that guarantee belongs to
-- the self-service delete_my_account flow (p6c), a different, softer
-- operation. This is the "on request" admin path: irreversible, on purpose.
-- targets.set_by is `not null references agents(id)` with no cascade, so
-- deleting an agent who set targets for others fails loudly rather than
-- silently orphaning or reassigning those rows -- surfaced as a clear
-- error, not swallowed.
create or replace function public.admin_hard_delete_agent(p_actor_id uuid, p_agent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_full_name text;
begin
  select org_id, full_name into v_org, v_full_name from public.agents where id = p_agent_id;
  if v_org is null then raise exception 'agent not found'; end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.hard_deleted', 'agent', p_agent_id::text,
          jsonb_build_object('full_name', v_full_name));

  delete from auth.users where id = p_agent_id;
exception when foreign_key_violation then
  raise exception 'cannot hard-delete: this agent has dependent rows (likely targets they set for someone else) -- reassign those first';
end $$;
revoke all on function public.admin_hard_delete_agent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_hard_delete_agent(uuid, uuid) to service_role;

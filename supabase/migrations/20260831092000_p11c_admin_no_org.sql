-- P11c: an admin is a platform-level role, not a member of any
-- organization. Previously every admin (including ones promoted from a
-- leader/associate, or invited by an existing admin via create_invitation's
-- p_role='admin' path) kept the org_id/upline_id of whatever org they came
-- from -- which put them in that org's hierarchy: visible in their inviter's
-- "My Team" downline, counted in agent_closure, subject to the same-org
-- upline fence. Admin cross-org reads were already role-gated, not
-- org-scoped (agents_admin_read/organizations_admin_read, p6d) -- org_id on
-- an admin's own row was never functionally required for that, just a
-- leftover NOT NULL from every agent originally being an org member.

-- org_id is nullable, but only for admin -- every other role still requires
-- one, enforced in the database, not just app code.
alter table public.agents alter column org_id drop not null;
alter table public.agents add constraint agents_org_required_unless_admin
  check (role = 'admin' or org_id is not null);

-- enforce_same_org() (p1e) only raises when new.upline_id is not null; an
-- org-less admin with a non-null upline_id would silently pass it (null
-- org_id <> upline's org_id evaluates to null, not true, so the trigger's
-- `if` never fires). Close that gap explicitly: no org means no upline.
alter table public.agents add constraint agents_admin_no_upline
  check (org_id is not null or upline_id is null);

-- Existing admins (created before this migration) still carry the
-- org_id/upline_id of whatever org they came from -- back that out now
-- rather than only applying "no org" to admins created from here on.
-- Nulling upline_id fires closure_on_move (p1e), which correctly drops
-- them out of their former upline's agent_closure/downline. Also surface
-- any of their own direct reports as top-level in their org, same reasoning
-- as admin_set_agent_role's promotion path below -- an org-less admin
-- can't stay someone's upline.
update public.agents set upline_id = null
  where upline_id in (select id from public.agents where role = 'admin');
update public.agents set org_id = null, upline_id = null where role = 'admin';

-- feedback is the one org-scoped table an admin can legitimately write to
-- themselves (submitted from the account menu, every role). Its org_id
-- trigger reused set_org_from_agent(), which raises on a null org_id --
-- correct for contacts/call_logs/appointments/sales/recruiting_logs (an
-- admin must never own those, reinforcing that they don't log activity),
-- wrong for feedback. Give feedback its own nullable-tolerant version
-- instead of loosening the original for every other table.
alter table public.feedback alter column org_id drop not null;
create or replace function public.set_org_from_agent_nullable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.org_id := (select a.org_id from public.agents a where a.id = new.agent_id);
  return new;
end $$;
drop trigger feedback_org on public.feedback;
create trigger feedback_org before insert or update of agent_id on public.feedback
  for each row execute function public.set_org_from_agent_nullable();

-- create_invitation (p1m) lets an existing admin invite a new admin
-- (v_role = 'admin' path) -- that insert's org_id came from the inviting
-- admin's own agents.org_id, which is now null. Same nullable-unless-role
-- exception as agents.org_id: an admin invite carries no org, everything
-- else still requires one.
alter table public.invitations alter column org_id drop not null;
alter table public.invitations add constraint invitations_org_required_unless_admin
  check (role = 'admin' or org_id is not null);

-- New admin signups (accepted via an admin-role invitation, itself only
-- issuable by an existing admin per create_invitation) land with no org and
-- no upline, never the inviting admin's -- same "admin isn't a member of
-- any org" rule applied at creation, not just promotion (below).
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
end $$;

-- Promoting an agent to admin detaches them from their org's hierarchy
-- (org_id, upline_id -> null); demoting one away from admin requires the
-- caller to say which org the agent rejoins, since that information was
-- deliberately discarded on promotion. p_org_id is ignored unless the
-- transition actually needs it. A new p_org_id parameter changes this
-- function's signature -- drop the old 3-arg overload first so it doesn't
-- linger alongside the replacement and make the RPC name ambiguous.
drop function if exists public.admin_set_agent_role(uuid, uuid, public.agent_role);

create or replace function public.admin_set_agent_role(
  p_actor_id uuid, p_agent_id uuid, p_role public.agent_role, p_org_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_old_role public.agent_role;
begin
  select org_id, role into v_org, v_old_role from public.agents where id = p_agent_id;
  if v_old_role is null then raise exception 'agent not found'; end if;

  if v_old_role = p_role then return; end if;

  if p_role = 'admin' then
    -- If the promoted agent already led a team, their direct reports can't
    -- stay pointed at an upline who no longer belongs to any org -- surface
    -- them as top-level in their own org instead of silently leaving a
    -- dangling reporting line only agent_closure would still reflect.
    update public.agents set upline_id = null where upline_id = p_agent_id;
    update public.agents set role = p_role, org_id = null, upline_id = null where id = p_agent_id;
  elsif v_org is null then
    -- Leaving admin with no org on file -- the caller must supply one.
    if p_org_id is null then
      raise exception 'reassign this agent to an organization before changing their role';
    end if;
    if not exists (select 1 from public.organizations where id = p_org_id) then
      raise exception 'organization not found';
    end if;
    update public.agents set role = p_role, org_id = p_org_id, upline_id = null where id = p_agent_id;
    v_org := p_org_id;
  else
    update public.agents set role = p_role where id = p_agent_id;
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.role_changed', 'agent', p_agent_id::text,
          jsonb_build_object('old_role', v_old_role, 'new_role', p_role));
end $$;
revoke all on function public.admin_set_agent_role(uuid, uuid, public.agent_role, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_set_agent_role(uuid, uuid, public.agent_role, uuid) to service_role;

-- admin_move_agent/admin_reactivate_agent/admin_hard_delete_agent (p6a) all
-- used "select org_id ... if v_org is null then raise 'agent not found'" as
-- their existence check -- that was a safe proxy for not-found back when
-- org_id was NOT NULL on every agent. Now an admin's org_id is legitimately
-- null, so a real admin row would trip that same check. Re-key the
-- existence check on the row itself, not on org_id being present.

create or replace function public.admin_move_agent(
  p_actor_id uuid, p_agent_id uuid, p_new_upline_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_new_upline_org uuid;
begin
  if not exists (select 1 from public.agents where id = p_agent_id) then
    raise exception 'agent not found';
  end if;
  select org_id into v_org from public.agents where id = p_agent_id;

  if p_new_upline_id is not null then
    if not exists (select 1 from public.agents where id = p_new_upline_id) then
      raise exception 'new upline not found';
    end if;
    select org_id into v_new_upline_org from public.agents where id = p_new_upline_id;
    -- The same-org trigger (p1e) and cycle guard already enforce this at
    -- the row level; this check exists purely for a clearer error message.
    if v_new_upline_org is distinct from v_org then
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
  if not exists (select 1 from public.agents where id = p_agent_id) then
    raise exception 'agent not found';
  end if;
  select org_id into v_org from public.agents where id = p_agent_id;

  update public.agents set status = 'active' where id = p_agent_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.reactivated', 'agent', p_agent_id::text, '{}'::jsonb);
end $$;
revoke all on function public.admin_reactivate_agent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_reactivate_agent(uuid, uuid) to service_role;

create or replace function public.admin_hard_delete_agent(p_actor_id uuid, p_agent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_full_name text;
begin
  if not exists (select 1 from public.agents where id = p_agent_id) then
    raise exception 'agent not found';
  end if;
  select org_id, full_name into v_org, v_full_name from public.agents where id = p_agent_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, p_actor_id, 'agent.hard_deleted', 'agent', p_agent_id::text,
          jsonb_build_object('full_name', v_full_name));

  delete from auth.users where id = p_agent_id;
exception when foreign_key_violation then
  raise exception 'cannot hard-delete: this agent has dependent rows (likely targets they set for someone else) -- reassign those first';
end $$;
revoke all on function public.admin_hard_delete_agent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_hard_delete_agent(uuid, uuid) to service_role;

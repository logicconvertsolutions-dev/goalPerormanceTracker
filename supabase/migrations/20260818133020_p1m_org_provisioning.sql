-- An SMD has no upline, so the org-owner invitation must allow a null one.
alter table public.invitations alter column upline_id drop not null;
alter table public.invitations alter column created_by drop not null;

-- Bootstrap: creates the org and the SMD's invitation. Service-role only —
-- there is no signed-in agent yet, which is the whole chicken-and-egg problem.
-- Returns the raw token; store only its hash. Show it once, never log it.
create or replace function public.provision_org(
  p_org_name text, p_smd_email text, p_smd_name text)
returns table (org_id uuid, invite_token text)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_token text;
begin
  insert into public.organizations (name) values (p_org_name) returning id into v_org;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.invitations (org_id, email, upline_id, role, token_hash)
  values (v_org, lower(p_smd_email), null, 'leader',
          encode(extensions.digest(v_token, 'sha256'), 'hex'));

  insert into public.targets (org_id, agent_id, set_by, effective_from)
  select v_org, null, null, public.week_start(current_date)
  where false;  -- org default is created by the SMD on first login

  insert into public.audit_log (org_id, action, entity, entity_id, metadata)
  values (v_org, 'org.provisioned', 'organization', v_org::text,
          jsonb_build_object('smd_email', lower(p_smd_email)));

  org_id := v_org; invite_token := v_token; return next;
end $$;
revoke all on function public.provision_org(text,text,text) from public, anon, authenticated;

-- targets.set_by must allow null for the org-default row seeded at provisioning.
alter table public.targets alter column set_by drop not null;

-- Invitations sent by an SMD: hash the token server-side, never store the raw.
create or replace function public.create_invitation(p_email text, p_role public.agent_role default 'associate')
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text; v_me uuid := (select auth.uid()); v_org uuid; v_role public.agent_role;
begin
  select a.org_id, a.role into v_org, v_role from public.agents a where a.id = v_me;
  if v_role not in ('leader','admin') then
    raise exception 'only a leader or admin can invite';
  end if;
  if p_role = 'admin' and v_role <> 'admin' then
    raise exception 'only an admin can invite an admin';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (org_id, email, upline_id, role, token_hash, created_by)
  values (v_org, lower(p_email), v_me, p_role,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), v_me);

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'invitation.created', 'invitation', lower(p_email),
          jsonb_build_object('role', p_role));
  return v_token;
end $$;
revoke all on function public.create_invitation(text, public.agent_role) from public, anon;
grant execute on function public.create_invitation(text, public.agent_role) to authenticated;

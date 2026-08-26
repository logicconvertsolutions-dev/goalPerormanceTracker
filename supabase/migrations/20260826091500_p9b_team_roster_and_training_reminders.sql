-- Lets an SMD add every team member to a roster before deciding who to
-- actually invite (agents.id is a hard FK to auth.users, so a roster entry
-- deliberately has no login until an invite is sent and accepted). Direct
-- table + RLS, same shape as `targets` — no RPC needed since (unlike
-- invitations) there's no secret token to generate server-side.
create table public.team_roster (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  upline_id     uuid not null references public.agents(id) on delete cascade,
  full_name     text not null,
  email         text,
  phone         text,
  notes         text,
  invitation_id uuid references public.invitations(id) on delete set null,
  created_by    uuid not null references public.agents(id),
  created_at    timestamptz not null default now()
);
create index team_roster_org_idx on public.team_roster (org_id);
create index team_roster_upline_idx on public.team_roster (upline_id);

alter table public.team_roster enable row level security;

-- Same shape as invitations_read/insert/update (p1h_rls_policies.sql):
-- leader/admin, own org, upline inside own subtree.
create policy team_roster_read on public.team_roster for select to authenticated
  using ( (select private.my_role()) in ('leader','admin')
          and org_id = (select private.my_org()) );
create policy team_roster_insert on public.team_roster for insert to authenticated
  with check ( (select private.my_role()) in ('leader','admin')
               and org_id = (select private.my_org())
               and (select private.is_upline_of(upline_id)) );
create policy team_roster_update on public.team_roster for update to authenticated
  using ( (select private.my_role()) in ('leader','admin')
          and org_id = (select private.my_org()) )
  with check ( org_id = (select private.my_org()) );
create policy team_roster_delete on public.team_roster for delete to authenticated
  using ( (select private.my_role()) in ('leader','admin')
          and org_id = (select private.my_org()) );

-- Training reminder: a new, distinct notification from the existing ad-hoc
-- "Nudge" (agent_nudges/nudge_agent, p5a_team_dashboard_rpcs.sql) — same
-- rate-limited-RPC mechanism, separate table/email so the two stay
-- independently cooled-down and never share copy.
create table public.agent_training_reminders (
  agent_id uuid not null references public.agents(id) on delete cascade,
  sent_by  uuid not null references public.agents(id),
  sent_at  timestamptz not null default now()
);
create index on public.agent_training_reminders (agent_id, sent_at);
alter table public.agent_training_reminders enable row level security;
-- No policies: reachable only via the SECURITY DEFINER RPC below, same
-- pattern as agent_nudges.
revoke all on public.agent_training_reminders from anon, authenticated;

create or replace function public.send_training_reminder(p_agent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); v_role public.agent_role; v_org uuid;
begin
  select role, org_id into v_role, v_org from public.agents where id = v_me;
  if v_role not in ('leader','admin') then
    raise exception 'only a leader or admin can send a training reminder';
  end if;
  if not (select private.is_upline_of(p_agent_id)) then
    raise exception 'agent is not in caller''s downline';
  end if;
  if exists (
    select 1 from public.agent_training_reminders
    where agent_id = p_agent_id and sent_at > now() - interval '7 days'
  ) then
    raise exception 'already sent a training reminder to this agent in the last 7 days';
  end if;

  insert into public.agent_training_reminders (agent_id, sent_by) values (p_agent_id, v_me);
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'agent.training_reminder_sent', 'agent', p_agent_id::text, '{}'::jsonb);
end $$;
revoke all on function public.send_training_reminder(uuid) from public, anon;
grant execute on function public.send_training_reminder(uuid) to authenticated;

alter table public.organizations  enable row level security;
alter table public.agents         enable row level security;
alter table public.agent_closure  enable row level security;
alter table public.contacts       enable row level security;
alter table public.call_logs      enable row level security;
alter table public.appointments   enable row level security;
alter table public.sales          enable row level security;
alter table public.recruiting_logs enable row level security;
alter table public.targets        enable row level security;
alter table public.invitations    enable row level security;
alter table public.audit_log      enable row level security;
alter table public.daily_metrics  enable row level security;

-- ORGANIZATIONS: see only your own.
create policy organizations_select on public.organizations for select to authenticated
  using ( id = (select private.my_org()) );

-- AGENTS: yourself and your downline. Name/email/role only; no prospect PII here.
create policy agents_select on public.agents for select to authenticated
  using ( (select private.is_upline_of(id)) );
create policy agents_update_self on public.agents for update to authenticated
  using ( id = (select auth.uid()) ) with check ( id = (select auth.uid()) );

-- RLS is ROW-level. That policy alone would let an associate set their own
-- role to 'admin'. Column grants plus a guard trigger close it.
revoke update on public.agents from authenticated;
grant  update (full_name) on public.agents to authenticated;

create or replace function public.guard_agent_privileged_columns()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.role, new.upline_id, new.org_id, new.status)
     is distinct from (old.role, old.upline_id, old.org_id, old.status)
     and coalesce((select a.role from public.agents a where a.id = (select auth.uid())),
                  'associate') <> 'admin'
     and (select auth.uid()) is not null
  then raise exception 'privileged column change requires admin';
  end if;
  return new;
end $$;
create trigger agents_guard_privileged before update on public.agents
  for each row execute function public.guard_agent_privileged_columns();

-- CLOSURE: readable only where you are the ancestor. Never written by clients.
create policy closure_select on public.agent_closure for select to authenticated
  using ( ancestor_id = (select auth.uid()) );

-- OWNER-ONLY TABLES. There is deliberately NO upline SELECT policy on any of
-- these. Uplines reach team data exclusively through aggregate RPCs, so no
-- policy exists that could leak a whole downline's prospects.
create policy contacts_own on public.contacts for all to authenticated
  using ( agent_id = (select auth.uid()) )
  with check ( agent_id = (select auth.uid()) );
create policy call_logs_own on public.call_logs for all to authenticated
  using ( agent_id = (select auth.uid()) )
  with check ( agent_id = (select auth.uid()) );
create policy appointments_own on public.appointments for all to authenticated
  using ( agent_id = (select auth.uid()) )
  with check ( agent_id = (select auth.uid()) );
create policy sales_own on public.sales for all to authenticated
  using ( agent_id = (select auth.uid()) )
  with check ( agent_id = (select auth.uid()) );
create policy recruiting_own on public.recruiting_logs for all to authenticated
  using ( agent_id = (select auth.uid()) )
  with check ( agent_id = (select auth.uid()) );

-- DAILY_METRICS: own rows, read only. Uplines go through RPCs.
create policy metrics_own on public.daily_metrics for select to authenticated
  using ( agent_id = (select auth.uid()) );

-- TARGETS: read what applies to you (and your downline's, for the denominator);
-- written only by a leader or admin, inside their own org.
create policy targets_read on public.targets for select to authenticated
  using ( org_id = (select private.my_org())
          and ( agent_id is null or (select private.is_upline_of(agent_id)) ) );
create policy targets_insert on public.targets for insert to authenticated
  with check ( (select private.my_role()) in ('leader','admin')
               and org_id = (select private.my_org())
               and ( agent_id is null or (select private.is_upline_of(agent_id)) ) );
create policy targets_update on public.targets for update to authenticated
  using ( (select private.my_role()) in ('leader','admin')
          and org_id = (select private.my_org()) )
  with check ( org_id = (select private.my_org()) );

-- INVITATIONS: leaders and admins, own org, upline inside own subtree.
create policy invitations_read on public.invitations for select to authenticated
  using ( (select private.my_role()) in ('leader','admin')
          and org_id = (select private.my_org()) );
create policy invitations_insert on public.invitations for insert to authenticated
  with check ( (select private.my_role()) in ('leader','admin')
               and org_id = (select private.my_org())
               and (select private.is_upline_of(upline_id)) );
create policy invitations_update on public.invitations for update to authenticated
  using ( (select private.my_role()) in ('leader','admin')
          and org_id = (select private.my_org()) )
  with check ( org_id = (select private.my_org()) );

-- AUDIT: admin reads. No write policy at all — definer functions insert,
-- nothing can update or delete.
create policy audit_admin_read on public.audit_log for select to authenticated
  using ( (select private.my_role()) = 'admin' );

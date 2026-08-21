-- P6: data retention (04-security.md "auto-purge call_logs rows older than
-- 24 months unless linked to a sale... configurable; default on") and the
-- self-service "Delete my account" flow from /settings (data-actions.tsx,
-- currently a placeholder: "Account deletion ships in P6").

-- Per-org, nullable = retention disabled for that org. Default 24 months
-- matches the spec's default-on default value; an admin/SMD setting can
-- write this column later without a schema change.
alter table public.organizations
  add column call_log_retention_months int not null default 24;

-- "unless linked to a sale" -- call_logs has no direct sale reference, so
-- this is read as: keep a call if the same contact has ever produced a
-- sale (that call is part of a client's history, not just a cold prospect
-- who never went anywhere). Runs as a plain DELETE, which drains through
-- the existing dirty-queue trigger like any other delete -- daily_metrics
-- recomputes to match what remains, same as it does for any edit. That is
-- consistent with daily_metrics always being a live read model of
-- call_logs (CLAUDE.md rule 9), not a frozen snapshot.
create or replace function private.purge_old_call_logs()
returns int language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  with doomed as (
    delete from public.call_logs cl
    using public.organizations o
    where cl.org_id = o.id
      and o.call_log_retention_months is not null
      and cl.call_date < current_date - (o.call_log_retention_months || ' months')::interval
      and not exists (
        select 1 from public.sales s where s.contact_id = cl.contact_id
      )
    returning cl.id
  )
  select count(*) into v_count from doomed;

  insert into public.audit_log (action, entity, metadata)
  values ('retention.call_logs_purged', 'call_logs', jsonb_build_object('rows_deleted', v_count));

  return v_count;
end $$;
revoke all on function private.purge_old_call_logs() from public, anon, authenticated;

select cron.schedule(
  'purge-old-call-logs', '30 3 * * *',
  $$select private.purge_old_call_logs();$$);

-- ---------------------------------------------------------------------
-- Self-service account deletion (09-account-and-auth.md /settings "Your
-- data"): hard-deletes contacts/notes, retains the anonymised daily counts
-- the upline already saw. Deliberately the softer counterpart to
-- admin_hard_delete_agent (p6a) -- that one truly erases the agent;
-- this one severs PII and disables login, keeping org_id/agent_closure/
-- daily_metrics intact so the upline's historical rollups don't silently
-- change shape underneath them.
-- ---------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); v_org uuid;
begin
  if v_me is null then
    raise exception 'must be signed in';
  end if;
  select org_id into v_org from public.agents where id = v_me;

  -- Cascades call_logs and appointments (contact_id ... on delete cascade).
  delete from public.contacts where agent_id = v_me;

  -- sales/recruiting_logs keep their row (contact_id ... on delete set
  -- null already severed the link) but may still carry free-text notes.
  update public.sales set notes = null where agent_id = v_me and notes is not null;
  update public.recruiting_logs set notes = null where agent_id = v_me and notes is not null;

  perform set_config('app.privileged_agent_write', 'on', true);
  update public.agents
     set full_name = 'Deleted User',
         email = 'deleted-' || v_me::text || '@deleted.invalid',
         status = 'inactive'
   where id = v_me;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'agent.self_deleted', 'agent', v_me::text, '{}'::jsonb);
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Support for P2 account screens: timezone, notification prefs, MFA
-- recovery codes, self-service deactivation, and a self-only target lookup.

alter table public.agents add column time_zone text;

create table public.notification_prefs (
  agent_id           uuid primary key references public.agents(id) on delete cascade,
  evening_nudge      boolean not null default true,
  sunday_summary     boolean not null default true,
  monday_digest      boolean not null default true,
  updated_at         timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
create policy notification_prefs_own on public.notification_prefs for all to authenticated
  using ( agent_id = (select auth.uid()) )
  with check ( agent_id = (select auth.uid()) );

-- Supabase Auth owns TOTP factors; recovery codes are this product's own
-- concept layered on top, so they need app-side storage. Hashed, never
-- plaintext -- shown once at enrollment and never displayed again.
create table public.mfa_recovery_codes (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references public.agents(id) on delete cascade,
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index mfa_recovery_codes_agent_idx on public.mfa_recovery_codes (agent_id);
alter table public.mfa_recovery_codes enable row level security;
create policy mfa_recovery_codes_own on public.mfa_recovery_codes for select to authenticated
  using ( agent_id = (select auth.uid()) );
-- No insert/update/delete policy for authenticated: codes are written only
-- by the enrollment Server Action via the service-role client, and marked
-- used only by the redemption Server Action, same pattern as daily_metrics.

-- Self-only wrapper around private.effective_target, so /settings can show
-- "your target" without exposing the private schema or requiring the client
-- to know its own org's default-vs-override resolution.
create or replace function public.my_target(p_week date)
returns table (
  calls_per_week int, appts_held_per_week int,
  premium_cents_per_week bigint, min_calls_per_day int, md_deadline date
) language sql stable security definer set search_path = '' as $$
  select * from private.effective_target((select auth.uid()), p_week);
$$;
revoke all on function public.my_target(date) from public, anon;
grant execute on function public.my_target(date) to authenticated;

-- A leader (not just admin) deactivating their own downline. status is a
-- privileged column blocked for non-admins by guard_agent_privileged_columns,
-- so this needs its own SECURITY DEFINER path with its own authorization
-- check (leader/admin AND is_upline_of), independent of that trigger.
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

  update public.agents set status = 'inactive' where id = p_agent_id and org_id = v_org;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'agent.deactivated', 'agent', p_agent_id::text, '{}'::jsonb);
end $$;
revoke all on function public.deactivate_agent(uuid) from public, anon;
grant execute on function public.deactivate_agent(uuid) to authenticated;

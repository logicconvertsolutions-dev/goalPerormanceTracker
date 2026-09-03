-- P12a: nudge_agent (p5a, tightened in p9f) is a manual, rate-limited-to-
-- once-per-7-days action -- an SMD has to remember to click "Nudge" every
-- week for a quiet associate. Product ask: let an SMD flip a persistent
-- "remind this associate every day until they're logging again" switch
-- instead. Mirrors team_roster.auto_reminders_enabled (p11a)'s shape: a
-- boolean flag plus a per-(agent, local day) idempotency log, picked up by
-- the cron route on the same 7pm-local weekday window evening_nudge already
-- uses -- independent of nudge_agent's own 7-day cooldown, which stays as
-- the on-demand one-off action it always was.

alter table public.agents
  add column auto_call_nudges_enabled boolean not null default false;

create table public.agent_auto_nudge_log (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references public.agents(id) on delete cascade,
  local_date date not null,
  sent_at    timestamptz not null default now(),
  unique (agent_id, local_date)
);
create index agent_auto_nudge_log_agent_idx on public.agent_auto_nudge_log (agent_id, sent_at);
alter table public.agent_auto_nudge_log enable row level security;
-- No policies: written only by the cron route's service-role client, same
-- lockdown pattern as notification_log / team_roster_reminder_log.
revoke all on public.agent_auto_nudge_log from anon, authenticated;

-- Let a leader/admin toggle this for anyone in their downline -- same
-- authorization shape as nudge_agent itself (p5a).
create or replace function public.set_auto_call_nudges(p_agent_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); v_role public.agent_role; v_org uuid;
begin
  select role, org_id into v_role, v_org from public.agents where id = v_me;
  if v_role not in ('leader','admin') then
    raise exception 'only a leader or admin can change this';
  end if;
  if not (select private.is_upline_of(p_agent_id)) then
    raise exception 'agent is not in caller''s downline';
  end if;

  update public.agents set auto_call_nudges_enabled = p_enabled where id = p_agent_id;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'agent.auto_nudges_set', 'agent', p_agent_id::text, jsonb_build_object('enabled', p_enabled));
end $$;
revoke all on function public.set_auto_call_nudges(uuid, boolean) from public, anon;
grant execute on function public.set_auto_call_nudges(uuid, boolean) to authenticated;

-- team_inactive (p1i) needs to surface the flag's current value so the
-- "Quiet" list can render the toggle in its current state. Return type is
-- changing (new column), so this has to be a drop + recreate, not a plain
-- create-or-replace -- and that resets the function's grants back to
-- Postgres's PUBLIC-by-default, so the revoke/grant from p1l is repeated
-- here.
drop function if exists public.team_inactive(int);
create or replace function public.team_inactive(p_days int default 7)
returns table (
  agent_id uuid, full_name text, last_logged_at timestamptz, days_quiet int,
  auto_call_nudges_enabled boolean
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.full_name, max(m.updated_at),
         coalesce(extract(day from now() - max(m.updated_at))::int, 999),
         a.auto_call_nudges_enabled
  from public.agent_closure c
  join public.agents a on a.id = c.descendant_id and a.status = 'active'
  left join public.daily_metrics m on m.agent_id = a.id
  where c.ancestor_id = (select auth.uid())
  group by a.id, a.full_name, a.auto_call_nudges_enabled
  having coalesce(max(m.updated_at), 'epoch'::timestamptz) < now() - (p_days || ' days')::interval
  order by max(m.updated_at) nulls first;
$$;
revoke all on function public.team_inactive(int) from public, anon;
grant execute on function public.team_inactive(int) to authenticated;

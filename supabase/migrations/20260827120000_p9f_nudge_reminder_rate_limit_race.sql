-- Fix: nudge_agent and send_training_reminder rate-limited their 7-day
-- cooldown with a plain "SELECT EXISTS ... then INSERT" -- not atomic, so
-- two concurrent calls (e.g. a double-click) can both pass the check before
-- either INSERT commits, sending two notifications inside the cooldown
-- window. team_roster.last_training_reminder_at (p9c) already uses the
-- correct shape for this -- a single per-agent row updated in place, gated
-- by an atomic UPDATE ... WHERE -- so agent_nudges and
-- agent_training_reminders are switched to match instead of inventing a
-- new mechanism.
--
-- agent_nudges/agent_training_reminders become single-row-per-agent
-- "last sent" trackers (their historical multi-row log shape was never
-- read from anywhere but the EXISTS check itself -- there is no admin UI
-- or report over nudge/reminder history to preserve).

alter table public.agent_nudges add column last_sent_at timestamptz;
alter table public.agent_nudges add column last_sent_by uuid references public.agents(id);
update public.agent_nudges an set last_sent_at = t.sent_at, last_sent_by = t.sent_by
from (
  select distinct on (agent_id) agent_id, sent_at, sent_by
  from public.agent_nudges
  order by agent_id, sent_at desc
) t
where an.agent_id = t.agent_id;
delete from public.agent_nudges a using public.agent_nudges b
  where a.agent_id = b.agent_id and a.ctid < b.ctid;
alter table public.agent_nudges add primary key (agent_id);
alter table public.agent_nudges drop column sent_at;
alter table public.agent_nudges drop column sent_by;
alter table public.agent_nudges alter column last_sent_at set not null;
alter table public.agent_nudges alter column last_sent_by set not null;

create or replace function public.nudge_agent(p_agent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); v_role public.agent_role; v_org uuid; v_updated boolean;
begin
  select role, org_id into v_role, v_org from public.agents where id = v_me;
  if v_role not in ('leader','admin') then
    raise exception 'only a leader or admin can nudge an agent';
  end if;
  if not (select private.is_upline_of(p_agent_id)) then
    raise exception 'agent is not in caller''s downline';
  end if;

  -- Atomic check-and-set: the WHERE clause is the rate-limit check, and it
  -- is evaluated by the same statement that performs the write, so two
  -- concurrent callers can't both see "no recent send" and both proceed.
  insert into public.agent_nudges (agent_id, last_sent_at, last_sent_by)
  values (p_agent_id, now(), v_me)
  on conflict (agent_id) do update
    set last_sent_at = now(), last_sent_by = v_me
    where public.agent_nudges.last_sent_at <= now() - interval '7 days';
  get diagnostics v_updated = row_count;
  if not v_updated then
    raise exception 'already nudged this agent in the last 7 days';
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'agent.nudged', 'agent', p_agent_id::text, '{}'::jsonb);
end $$;
revoke all on function public.nudge_agent(uuid) from public, anon;
grant execute on function public.nudge_agent(uuid) to authenticated;

alter table public.agent_training_reminders add column last_sent_at timestamptz;
alter table public.agent_training_reminders add column last_sent_by uuid references public.agents(id);
update public.agent_training_reminders atr set last_sent_at = t.sent_at, last_sent_by = t.sent_by
from (
  select distinct on (agent_id) agent_id, sent_at, sent_by
  from public.agent_training_reminders
  order by agent_id, sent_at desc
) t
where atr.agent_id = t.agent_id;
delete from public.agent_training_reminders a using public.agent_training_reminders b
  where a.agent_id = b.agent_id and a.ctid < b.ctid;
alter table public.agent_training_reminders add primary key (agent_id);
alter table public.agent_training_reminders drop column sent_at;
alter table public.agent_training_reminders drop column sent_by;
alter table public.agent_training_reminders alter column last_sent_at set not null;
alter table public.agent_training_reminders alter column last_sent_by set not null;

create or replace function public.send_training_reminder(p_agent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); v_role public.agent_role; v_org uuid; v_updated boolean;
begin
  select role, org_id into v_role, v_org from public.agents where id = v_me;
  if v_role not in ('leader','admin') then
    raise exception 'only a leader or admin can send a training reminder';
  end if;
  if not (select private.is_upline_of(p_agent_id)) then
    raise exception 'agent is not in caller''s downline';
  end if;

  insert into public.agent_training_reminders (agent_id, last_sent_at, last_sent_by)
  values (p_agent_id, now(), v_me)
  on conflict (agent_id) do update
    set last_sent_at = now(), last_sent_by = v_me
    where public.agent_training_reminders.last_sent_at <= now() - interval '7 days';
  get diagnostics v_updated = row_count;
  if not v_updated then
    raise exception 'already sent a training reminder to this agent in the last 7 days';
  end if;

  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'agent.training_reminder_sent', 'agent', p_agent_id::text, '{}'::jsonb);
end $$;
revoke all on function public.send_training_reminder(uuid) from public, anon;
grant execute on function public.send_training_reminder(uuid) to authenticated;

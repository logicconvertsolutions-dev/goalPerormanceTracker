-- P5.5: notifications. notification_prefs + time_zone already exist (p2a);
-- agent_nudges already exists (p5a) as a rate-limited stub with a comment
-- saying P5.5 wires real email onto it. This migration adds the one new
-- table (idempotency/rate-limit log for the three scheduled emails) and the
-- two service-role-only read paths the cron job needs -- it runs with no
-- auth.uid() session, so the existing auth.uid()-scoped RPCs
-- (team_week_summary, my_target) don't apply to it.

-- One row per (agent, kind, local calendar day) they were sent a scheduled
-- email. The unique index IS the rate limit: "never more than one per day
-- per person" per notification, enforced in the database, not the cron
-- script's timing. Inserted before sending (not after), so two overlapping
-- cron runs can't both win the race and double-send.
create table public.notification_log (
  id         uuid primary key default gen_random_uuid(),
  agent_id   uuid not null references public.agents(id) on delete cascade,
  kind       text not null check (kind in ('evening_nudge','sunday_summary','monday_digest')),
  local_date date not null,
  sent_at    timestamptz not null default now(),
  unique (agent_id, kind, local_date)
);
create index notification_log_agent_idx on public.notification_log (agent_id, sent_at);
alter table public.notification_log enable row level security;
-- No policies: written only by the cron route's service-role client, same
-- lockdown pattern as private.metrics_dirty and public.agent_nudges.
revoke all on public.notification_log from anon, authenticated;

-- Service-role-only wrapper around private.effective_target, for the cron
-- job composing an associate's evening nudge / Sunday summary. Same
-- resolution path as public.my_target (self) and public.team_target
-- (SMD drill-down) -- rule is "resolve targets only through
-- private.effective_target()", this is that rule's system-caller wrapper.
create or replace function public.system_effective_target(p_agent_id uuid, p_week date)
returns table (
  calls_per_week int, appts_held_per_week int,
  premium_cents_per_week bigint, min_calls_per_day int, md_deadline date
) language sql stable security definer set search_path = '' as $$
  select * from private.effective_target(p_agent_id, p_week);
$$;
revoke all on function public.system_effective_target(uuid, date) from public, anon, authenticated;
grant execute on function public.system_effective_target(uuid, date) to service_role;

-- private.team_week_summary_for is public.team_week_summary's body with
-- auth.uid() replaced by an explicit p_leader_id -- the cron job needs the
-- same roster (totals vs target, streak, last-logged) for every leader's
-- Monday digest, and has no session to resolve auth.uid() from. Kept as one
-- definition in `private` (never RPC-callable on its own) with a thin
-- service-role-only `public` wrapper, same shape as effective_target/my_target.
create or replace function private.team_week_summary_for(p_leader_id uuid, p_week_start date)
returns table (
  agent_id uuid, full_name text, depth int,
  calls_made int, appts_set int, appts_held int, premium_cents bigint,
  calls_target int, appts_held_target int, premium_cents_target bigint,
  pct_calls numeric, streak_days int, last_logged_at timestamptz,
  has_override boolean
) language sql stable security definer set search_path = '' as $$
  with scope as (
    select c.descendant_id id, c.depth
    from public.agent_closure c
    where c.ancestor_id = p_leader_id
  ), agg as (
    select m.agent_id,
           sum(m.calls_made)::int calls, sum(m.appts_set)::int aset,
           sum(m.appt_held)::int aheld, sum(m.premium_cents)::bigint prem,
           max(m.updated_at) last_at
    from public.daily_metrics m
    join scope s on s.id = m.agent_id
    where m.activity_date >= p_week_start
      and m.activity_date <  p_week_start + 7
    group by m.agent_id
  )
  select a.id, a.full_name, s.depth,
         coalesce(g.calls,0), coalesce(g.aset,0), coalesce(g.aheld,0), coalesce(g.prem,0),
         t.calls_per_week, t.appts_held_per_week, t.premium_cents_per_week,
         round(100.0 * coalesce(g.calls,0) / nullif(t.calls_per_week,0), 1),
         (select count(*)::int from public.daily_metrics d
          where d.agent_id = a.id and d.activity_date <= p_week_start + 6
            and d.calls_made >= t.min_calls_per_day),
         g.last_at,
         exists (
           select 1 from public.targets ov
           where ov.agent_id = a.id and ov.effective_from <= p_week_start
         )
  from scope s
  join public.agents a on a.id = s.id and a.status = 'active'
  left join agg g on g.agent_id = a.id
  cross join lateral private.effective_target(a.id, p_week_start) t;
$$;

create or replace function public.system_team_week_summary(p_leader_id uuid, p_week_start date)
returns table (
  agent_id uuid, full_name text, depth int,
  calls_made int, appts_set int, appts_held int, premium_cents bigint,
  calls_target int, appts_held_target int, premium_cents_target bigint,
  pct_calls numeric, streak_days int, last_logged_at timestamptz,
  has_override boolean
) language sql stable security definer set search_path = '' as $$
  select * from private.team_week_summary_for(p_leader_id, p_week_start);
$$;
revoke all on function public.system_team_week_summary(uuid, date) from public, anon, authenticated;
grant execute on function public.system_team_week_summary(uuid, date) to service_role;

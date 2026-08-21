-- P5: SMD dashboard. Fills the RPC gaps team_week_summary/agent_aggregate/
-- agent_daily_activity/team_inactive (all shipped ahead of schedule in P1)
-- didn't cover: an agent-parameterized target lookup, a single-day team
-- roster, an 8-week team trend, a team-wide breakdown, and a rate-limited
-- nudge. Every one is SECURITY DEFINER, set search_path = '', and begins by
-- filtering to the caller's downline -- same shape as the P1 aggregate RPCs.

-- Self-only my_target (p2a) can't answer "what's assoc_1's target" for the
-- single-agent SMD drill-down. Same wrapper, agent-parameterized + gated.
create or replace function public.team_target(p_agent_id uuid, p_week date)
returns table (
  calls_per_week int, appts_held_per_week int,
  premium_cents_per_week bigint, min_calls_per_day int, md_deadline date
) language sql stable security definer set search_path = '' as $$
  select * from private.effective_target(p_agent_id, p_week)
  where (select private.is_upline_of(p_agent_id));
$$;
revoke all on function public.team_target(uuid, date) from public, anon;
grant execute on function public.team_target(uuid, date) to authenticated;

-- Whole-team single day, for "who worked today" (02-data-model.md).
create or replace function public.team_day_summary(p_date date)
returns table (agent_id uuid, full_name text, calls_made int,
               appts_set int, appts_held int, premium_cents bigint)
language sql stable security definer set search_path = '' as $$
  select a.id, a.full_name,
         coalesce(m.calls_made,0), coalesce(m.appts_set,0),
         coalesce(m.appt_held,0), coalesce(m.premium_cents,0)
  from public.agent_closure c
  join public.agents a on a.id = c.descendant_id and a.status = 'active'
  left join public.daily_metrics m
    on m.agent_id = a.id and m.activity_date = p_date
  where c.ancestor_id = (select auth.uid())
    and a.org_id = (select private.my_org());
$$;
revoke all on function public.team_day_summary(date) from public, anon;
grant execute on function public.team_day_summary(date) to authenticated;

-- 8-week team trend for /team's Summary-view trend chart. Bars = calls,
-- line = summed per-agent targets for that week (mirrors team_week_summary's
-- per-agent target resolution, just aggregated over more weeks).
create or replace function public.team_trend(p_weeks int default 8)
returns table (week_start date, calls_made bigint, premium_cents bigint,
               calls_target bigint)
language sql stable security definer set search_path = '' as $$
  with scope as (
    select descendant_id id from public.agent_closure
    where ancestor_id = (select auth.uid())
  ), weeks as (
    select public.week_start(current_date) - (7 * n) as ws
    from generate_series(0, p_weeks - 1) n
  )
  select w.ws,
         coalesce(sum(m.calls_made),0)::bigint,
         coalesce(sum(m.premium_cents),0)::bigint,
         coalesce((select sum(t.calls_per_week) from scope s
                   cross join lateral private.effective_target(s.id, w.ws) t), 0)::bigint
  from weeks w
  left join public.daily_metrics m
    on m.agent_id in (select id from scope)
   and m.activity_date >= w.ws and m.activity_date < w.ws + 7
  group by w.ws
  order by w.ws;
$$;
revoke all on function public.team_trend(int) from public, anon;
grant execute on function public.team_trend(int) to authenticated;

-- Team-wide breakdown counts for the Summary view's donuts + source bar.
-- Same shape as agent_aggregate, summed over the whole downline instead of
-- one agent.
create or replace function public.team_breakdown(p_from date, p_to date)
returns table (
  calls_made int, appts_set int, appts_held int, sales_count int,
  premium_cents bigint, referrals_given int, recruiting_convos int,
  out_connected int, out_voicemail int, out_no_answer int,
  out_appt_set int, out_not_interested int,
  src_warm_market int, src_referral int, src_cold int,
  src_social_media int, src_friend int, src_other int,
  appt_scheduled int, appt_held int, appt_no_show int,
  appt_rescheduled int, appt_cancelled int
) language sql stable security definer set search_path = '' as $$
  select
    coalesce(sum(calls_made),0)::int, coalesce(sum(appts_set),0)::int,
    coalesce(sum(appt_held),0)::int, coalesce(sum(sales_count),0)::int,
    coalesce(sum(premium_cents),0)::bigint, coalesce(sum(referrals_given),0)::int,
    coalesce(sum(recruiting_convos),0)::int,
    coalesce(sum(out_connected),0)::int, coalesce(sum(out_voicemail),0)::int,
    coalesce(sum(out_no_answer),0)::int, coalesce(sum(out_appt_set),0)::int,
    coalesce(sum(out_not_interested),0)::int,
    coalesce(sum(src_warm_market),0)::int, coalesce(sum(src_referral),0)::int,
    coalesce(sum(src_cold),0)::int, coalesce(sum(src_social_media),0)::int,
    coalesce(sum(src_friend),0)::int, coalesce(sum(src_other),0)::int,
    coalesce(sum(appt_scheduled),0)::int, coalesce(sum(appt_held),0)::int,
    coalesce(sum(appt_no_show),0)::int, coalesce(sum(appt_rescheduled),0)::int,
    coalesce(sum(appt_cancelled),0)::int
  from public.daily_metrics
  where agent_id in (select private.my_downline())
    and activity_date between p_from and p_to;
$$;
revoke all on function public.team_breakdown(date, date) from public, anon;
grant execute on function public.team_breakdown(date, date) to authenticated;

-- Add a per-agent override marker to the roster so the SMD remembers the
-- denominator differs (03-ui.md). create-or-replace can't change a return
-- signature in place if the old one has dependents, but nothing depends on
-- this function's shape yet (P5 is its first caller), so widening it here
-- is safe -- drop first since the column list itself is changing.
drop function if exists public.team_week_summary(date);
create or replace function public.team_week_summary(p_week_start date)
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
    where c.ancestor_id = (select auth.uid())
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
  cross join lateral private.effective_target(a.id, p_week_start) t
  order by round(100.0 * coalesce(g.calls,0) / nullif(t.calls_per_week,0), 1) asc nulls first;
$$;
revoke all on function public.team_week_summary(date) from public, anon;
grant execute on function public.team_week_summary(date) to authenticated;

-- Rate-limited nudge stub (P5.5 wires real email onto this same RPC).
create table public.agent_nudges (
  agent_id   uuid not null references public.agents(id) on delete cascade,
  sent_by    uuid not null references public.agents(id),
  sent_at    timestamptz not null default now()
);
create index on public.agent_nudges (agent_id, sent_at);
alter table public.agent_nudges enable row level security;
-- No policies: reachable only via the SECURITY DEFINER RPC below, same
-- pattern as private.metrics_dirty and daily_metrics' write path.
revoke all on public.agent_nudges from anon, authenticated;

create or replace function public.nudge_agent(p_agent_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_me uuid := (select auth.uid()); v_role public.agent_role; v_org uuid;
begin
  select role, org_id into v_role, v_org from public.agents where id = v_me;
  if v_role not in ('leader','admin') then
    raise exception 'only a leader or admin can nudge an agent';
  end if;
  if not (select private.is_upline_of(p_agent_id)) then
    raise exception 'agent is not in caller''s downline';
  end if;
  if exists (
    select 1 from public.agent_nudges
    where agent_id = p_agent_id and sent_at > now() - interval '7 days'
  ) then
    raise exception 'already nudged this agent in the last 7 days';
  end if;

  insert into public.agent_nudges (agent_id, sent_by) values (p_agent_id, v_me);
  insert into public.audit_log (org_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, v_me, 'agent.nudged', 'agent', p_agent_id::text, '{}'::jsonb);
end $$;
revoke all on function public.nudge_agent(uuid) from public, anon;
grant execute on function public.nudge_agent(uuid) to authenticated;

-- Every targets write already lands in audit_log via audit_target_change /
-- targets_audit, defined in p1j_invite_only_signup.sql (action =
-- 'insert.target' or 'update.target') -- no new trigger needed here.

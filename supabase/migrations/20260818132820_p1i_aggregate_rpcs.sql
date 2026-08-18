-- The ONLY way a leader reads team data. Every one filters to my_downline()
-- and my_org(), and no return column is a name, note, or free-text field.

create or replace function public.team_week_summary(p_week_start date)
returns table (
  agent_id uuid, full_name text, depth int,
  calls_made int, appts_set int, appts_held int, premium_cents bigint,
  calls_target int, appts_held_target int, premium_cents_target bigint,
  pct_calls numeric, streak_days int, last_logged_at timestamptz
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
         g.last_at
  from scope s
  join public.agents a on a.id = s.id and a.status = 'active'
  left join agg g on g.agent_id = a.id
  cross join lateral private.effective_target(a.id, p_week_start) t
  order by round(100.0 * coalesce(g.calls,0) / nullif(t.calls_per_week,0), 1) asc nulls first;
$$;

-- SMD filter-by-agent, daily grain. Counts only.
create or replace function public.agent_daily_activity(
  p_agent_id uuid, p_from date, p_to date)
returns table (
  activity_date date, calls_made int, appts_set int, appts_held int,
  premium_cents bigint, min_calls_target int, min_met boolean
) language sql stable security definer set search_path = '' as $$
  select d::date,
         coalesce(m.calls_made,0), coalesce(m.appts_set,0), coalesce(m.appt_held,0),
         coalesce(m.premium_cents,0), t.min_calls_per_day,
         coalesce(m.calls_made,0) >= t.min_calls_per_day
  from generate_series(p_from, p_to, interval '1 day') d
  left join public.daily_metrics m
    on m.agent_id = p_agent_id and m.activity_date = d::date
  cross join lateral private.effective_target(p_agent_id, public.week_start(d::date)) t
  where (select private.is_upline_of(p_agent_id))
  order by d;
$$;

-- Powers the filtered-to-one-agent view: KPI rows, both donuts, source bar, funnel.
create or replace function public.agent_aggregate(
  p_agent_id uuid, p_from date, p_to date)
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
  where agent_id = p_agent_id
    and activity_date between p_from and p_to
    and (select private.is_upline_of(p_agent_id));
$$;

create or replace function public.team_inactive(p_days int default 7)
returns table (agent_id uuid, full_name text, last_logged_at timestamptz, days_quiet int)
language sql stable security definer set search_path = '' as $$
  select a.id, a.full_name, max(m.updated_at),
         coalesce(extract(day from now() - max(m.updated_at))::int, 999)
  from public.agent_closure c
  join public.agents a on a.id = c.descendant_id and a.status = 'active'
  left join public.daily_metrics m on m.agent_id = a.id
  where c.ancestor_id = (select auth.uid())
  group by a.id, a.full_name
  having coalesce(max(m.updated_at), 'epoch'::timestamptz) < now() - (p_days || ' days')::interval
  order by max(m.updated_at) nulls first;
$$;

-- The agent's own callback queue.
create or replace function public.my_followups(p_as_of date default current_date)
returns table (
  call_id uuid, contact_id uuid, contact_name text, company text,
  last_note text, follow_up_on date, days_late int, times_called int
) language sql stable security definer set search_path = '' as $$
  select cl.id, ct.id, ct.full_name, ct.company, cl.notes, cl.follow_up_on,
         (p_as_of - cl.follow_up_on)::int,
         (select count(*)::int from public.call_logs x where x.contact_id = ct.id)
  from public.call_logs cl
  join public.contacts ct on ct.id = cl.contact_id
  where cl.agent_id = (select auth.uid())
    and cl.follow_up_on is not null
    and cl.follow_up_done_at is null
  order by cl.follow_up_on;
$$;

grant execute on function public.team_week_summary(date)          to authenticated;
grant execute on function public.agent_daily_activity(uuid,date,date) to authenticated;
grant execute on function public.agent_aggregate(uuid,date,date)  to authenticated;
grant execute on function public.team_inactive(int)               to authenticated;
grant execute on function public.my_followups(date)               to authenticated;

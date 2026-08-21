-- team_breakdown always summed the whole downline, so /team's donuts/bars
-- didn't respect the agent multi-select filter. Add an optional agent-list
-- param: null/empty means whole downline (unchanged default), non-null
-- restricts to those agents -- still intersected with the caller's downline,
-- so a leader can't widen scope by passing ids outside it.
drop function if exists public.team_breakdown(date, date);
create or replace function public.team_breakdown(
  p_from date, p_to date, p_agent_ids uuid[] default null
)
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
    and (p_agent_ids is null or agent_id = any(p_agent_ids))
    and activity_date between p_from and p_to;
$$;
revoke all on function public.team_breakdown(date, date, uuid[]) from public, anon;
grant execute on function public.team_breakdown(date, date, uuid[]) to authenticated;

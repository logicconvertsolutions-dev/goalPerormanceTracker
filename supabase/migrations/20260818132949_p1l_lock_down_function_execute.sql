-- Postgres grants EXECUTE to PUBLIC by default, so every trigger function was
-- reachable at /rest/v1/rpc/<name>. Revoke the lot, then re-grant only the five
-- RPCs the app actually calls.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

grant execute on function public.team_week_summary(date)              to authenticated;
grant execute on function public.agent_daily_activity(uuid,date,date) to authenticated;
grant execute on function public.agent_aggregate(uuid,date,date)      to authenticated;
grant execute on function public.team_inactive(int)                   to authenticated;
grant execute on function public.my_followups(date)                   to authenticated;

-- week_start is a pure helper, safe and useful client-side.
revoke all on function public.week_start(date) from public, anon;
grant execute on function public.week_start(date) to authenticated;

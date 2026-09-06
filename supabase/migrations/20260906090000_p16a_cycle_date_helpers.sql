-- P16a: 10-day cycle date helpers, the SQL twin of TS cycleBounds()
-- (src/lib/dates.ts). Every calendar month splits into three chunks: day
-- 1-10, day 11-20, and day 21-through-end-of-month (variable length -- 8 or
-- 9 days in February, 10 or 11 elsewhere depending on the month). Mirrors
-- public.week_start()'s existing "TS and SQL sides must agree" convention;
-- same signature/security/grant shape (no security definer -- pure date
-- math, no table access -- but still explicitly locked to `authenticated`
-- only, same as week_start's own deliberate lock-down in
-- 20260818132949_p1l_lock_down_function_execute.sql: "safe and useful
-- client-side" isn't a reason to leave it reachable by anon).

create or replace function public.cycle_start(d date)
returns date language sql immutable set search_path = '' as $$
  select case
    when extract(day from d) <= 10 then date_trunc('month', d)::date
    when extract(day from d) <= 20 then date_trunc('month', d)::date + 10
    else date_trunc('month', d)::date + 20
  end;
$$;
revoke all on function public.cycle_start(date) from public, anon;
grant execute on function public.cycle_start(date) to authenticated;

create or replace function public.cycle_end(d date)
returns date language sql immutable set search_path = '' as $$
  select case
    when extract(day from d) <= 10 then date_trunc('month', d)::date + 9
    when extract(day from d) <= 20 then date_trunc('month', d)::date + 19
    else (date_trunc('month', d) + interval '1 month' - interval '1 day')::date
  end;
$$;
revoke all on function public.cycle_end(date) from public, anon;
grant execute on function public.cycle_end(date) to authenticated;

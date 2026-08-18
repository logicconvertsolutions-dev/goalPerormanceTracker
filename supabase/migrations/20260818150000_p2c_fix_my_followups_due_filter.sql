-- Bug: my_followups (p1i) returns every open follow-up regardless of date,
-- because it never filters cl.follow_up_on <= p_as_of. docs/05-testing.md and
-- docs/08-screen-specs.md both specify /today shows only due-or-overdue rows;
-- a not-yet-due follow-up (e.g. "call back in a month") was leaking into the
-- callback queue immediately after being set. Found while seeding sample data
-- for P2.5 and confirmed against the pgTAP case added in
-- supabase/tests/001_rls_and_hierarchy.sql.
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
    and cl.follow_up_on <= p_as_of
    and cl.follow_up_done_at is null
  order by cl.follow_up_on;
$$;

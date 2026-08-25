-- Adds a follow-up capture to appointments and sales (mirroring call_logs),
-- and removes contacts.company: no longer collected while logging, and no
-- longer displayed/searched anywhere in the product.

alter table public.appointments
  add column follow_up_on      date,
  add column follow_up_done_at timestamptz;

create index appointments_followup_idx on public.appointments (agent_id, follow_up_on)
  where follow_up_on is not null and follow_up_done_at is null;

alter table public.sales
  add column follow_up_on      date,
  add column follow_up_done_at timestamptz;

create index sales_followup_idx on public.sales (agent_id, follow_up_on)
  where follow_up_on is not null and follow_up_done_at is null;

-- my_followups() returns company in its result table; a column can't be
-- dropped from a RETURNS TABLE signature with CREATE OR REPLACE, so drop and
-- recreate it without that column (p1i/p2c).
drop function if exists public.my_followups(date);

create function public.my_followups(p_as_of date default current_date)
returns table (
  call_id uuid, contact_id uuid, contact_name text,
  last_note text, follow_up_on date, days_late int, times_called int
) language sql stable security definer set search_path = '' as $$
  select cl.id, ct.id, ct.full_name, cl.notes, cl.follow_up_on,
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

grant execute on function public.my_followups(date) to authenticated;

alter table public.contacts drop column company;

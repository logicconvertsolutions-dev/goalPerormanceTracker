-- pgTAP suite for P25 Phase D-1: My Day looks a week ahead.
-- (`20260921100000_p25d1_my_day_forward_window.sql`)
--
-- F13: `my_followups` refused to surface an appointment until its own date
-- arrived, so an appointment booked for next week was invisible on the one
-- screen whose job is "what am I doing today". This suite pins the new
-- horizon and, just as importantly, pins what did NOT move with it --
-- the follow-up branches, the status filter, the legacy dedup, and the
-- own-data fence.
--
-- 009 covers the call<->appointment LINK inside the queue.
-- 010 covers reschedule lineage and how days_late is measured.
-- This file covers the queue's HORIZON.
--
-- Run with: supabase test db

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

-- Same reasoning as 007/008/009: pin the session zone and the agent's zone
-- so a horizon boundary can never straddle midnight mid-run. A +7/+8
-- assertion is exactly the shape that a zone slip turns into a flake.
set local time zone 'UTC';

select plan(14);

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000ee0d', 'org_window');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('window_agent@example.com', '00000000-0000-0000-0000-00000000ee0d', null, 'associate', 'seed-tok-d1', null),
  ('window_other@example.com', '00000000-0000-0000-0000-00000000ee0d', null, 'associate', 'seed-tok-d2', null);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'window_agent@example.com', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d9', 'window_other@example.com', 'authenticated', 'authenticated');

update public.agents set full_name = 'Window Agent', time_zone = 'UTC'
  where id = '00000000-0000-0000-0000-0000000000d1';
update public.agents set full_name = 'Other Agent', time_zone = 'UTC'
  where id = '00000000-0000-0000-0000-0000000000d9';

insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1', 'Window Contact'),
  ('00000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-0000000000d9', 'Other Contact');

create or replace function tests.authenticate_as(p_agent uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_agent, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function tests.clear_authentication()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', null, true);
  perform set_config('role', 'postgres', true);
end $$;

grant usage on schema tests to authenticated;
grant execute on function tests.authenticate_as(uuid) to authenticated;
grant execute on function tests.clear_authentication() to authenticated;

-- ---------------------------------------------------------------------
-- 1. F13 -- an appointment three days out is visible TODAY.
--
--    This is the whole finding. Before D-1 the branch filtered
--    `due <= p_as_of`, so this row returned zero and an agent's only
--    warning about Thursday's appointment arrived on Thursday.
-- ---------------------------------------------------------------------
insert into public.appointments (id, agent_id, contact_id, appt_type, status,
                                 set_on, scheduled_for, appt_date)
values ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', 'follow_up', 'scheduled',
        current_date, (current_date + 3)::timestamptz + interval '14 hours', current_date + 3);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000d1');

select is(
  (select count(*)::int from public.my_followups(current_date)
    where call_id = '00000000-0000-0000-0000-0000000000d3'),
  1, 'F13: an appointment three days out reaches My Day today'
);

-- The banding signal. days_late is `p_as_of - greatest(due, set_on)`, so a
-- future row reports a NEGATIVE number -- that is what the app reads to
-- put it under Tomorrow or Later instead of badging it "Due today".
select is(
  (select days_late from public.my_followups(current_date)
    where call_id = '00000000-0000-0000-0000-0000000000d3'),
  -3, 'a forward-dated row reports a negative days_late, never 0'
);

-- ---------------------------------------------------------------------
-- 2. The horizon is exactly seven days -- inclusive at +7, closed at +8.
--
--    Asserted on the boundary rather than somewhere comfortably inside it,
--    because an off-by-one here is invisible in every other test and shows
--    up as "the appointment I booked for next Monday never appeared".
-- ---------------------------------------------------------------------
select tests.clear_authentication();

insert into public.appointments (id, agent_id, contact_id, appt_type, status,
                                 set_on, scheduled_for, appt_date)
values ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', 'follow_up', 'scheduled',
        current_date, (current_date + 7)::timestamptz + interval '10 hours', current_date + 7),
       ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', 'follow_up', 'scheduled',
        current_date, (current_date + 8)::timestamptz + interval '10 hours', current_date + 8);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000d1');

select is(
  (select count(*)::int from public.my_followups(current_date)
    where call_id = '00000000-0000-0000-0000-0000000000d4'),
  1, 'the seventh day is inside the horizon'
);

select is(
  (select count(*)::int from public.my_followups(current_date)
    where call_id = '00000000-0000-0000-0000-0000000000d5'),
  0, 'the eighth day is not -- the window is bounded, not removed'
);

-- ---------------------------------------------------------------------
-- 3. The FOLLOW-UP branches were deliberately NOT widened.
--
--    A follow-up dated next Tuesday is a task the agent scheduled for next
--    Tuesday; pulling it forward turns the callback queue into a to-do
--    list. 001 already asserts that snoozing a follow-up past today clears
--    it from the queue -- widening branch 1 would have broken that, which
--    is the same product mistake stated as a test.
-- ---------------------------------------------------------------------
select tests.clear_authentication();

insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome, follow_up_on)
values ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', current_date, 'warm_market', 'connected', current_date + 3);

-- A follow-up carried by a RESOLVED appointment (branch 4, F12) -- the
-- other narrow branch, asserted separately so widening one without the
-- other cannot slip through.
insert into public.appointments (id, agent_id, contact_id, appt_type, status,
                                 set_on, appt_date, resolved_on, follow_up_on)
values ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', 'follow_up', 'held',
        current_date, current_date, current_date, current_date + 3);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000d1');

select is(
  (select count(*)::int from public.my_followups(current_date) where kind = 'follow_up'),
  0, 'a call follow-up three days out stays out of the queue (branch 1 not widened)'
);

select is(
  (select count(*)::int from public.my_followups(current_date) where kind = 'appointment_follow_up'),
  0, 'an appointment follow-up three days out stays out too (branch 4 not widened)'
);

-- ---------------------------------------------------------------------
-- 4. What the widened window must NOT have loosened.
-- ---------------------------------------------------------------------
select tests.clear_authentication();

-- A future appointment that already has an outcome. The horizon moved;
-- the status filter did not. Without this, resolving an appointment early
-- would leave it sitting in the queue until its own date passed.
insert into public.appointments (id, agent_id, contact_id, appt_type, status,
                                 set_on, scheduled_for, appt_date, resolved_on)
values ('00000000-0000-0000-0000-0000000000d8', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', 'follow_up', 'cancelled',
        current_date, (current_date + 2)::timestamptz + interval '9 hours', current_date, current_date);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000d1');

select is(
  (select count(*)::int from public.my_followups(current_date)
    where call_id = '00000000-0000-0000-0000-0000000000d8'),
  0, 'a resolved appointment inside the window still stays out of the queue'
);

-- An overdue pending appointment must keep coming back. This is the
-- "Needs an outcome" band, and it is the one that stops stale rows
-- quietly shrinking every outcome-based denominator (F3/F10).
select tests.clear_authentication();

insert into public.appointments (id, agent_id, contact_id, appt_type, status,
                                 set_on, scheduled_for, appt_date)
values ('00000000-0000-0000-0000-0000000000db', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', 'follow_up', 'scheduled',
        current_date - 5, (current_date - 5)::timestamptz + interval '11 hours', current_date - 5);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000d1');

select is(
  (select count(*)::int from public.my_followups(current_date)
    where call_id = '00000000-0000-0000-0000-0000000000db'),
  1, 'looking forward did not stop the queue looking back: an overdue appointment still appears'
);

select is(
  (select days_late from public.my_followups(current_date)
    where call_id = '00000000-0000-0000-0000-0000000000db'),
  5, 'and it still reports how late it is'
);

-- ---------------------------------------------------------------------
-- 5. Branch 3 (legacy, call-log-only) gets the SAME horizon, and the
--    dedup still holds at distance.
--
--    Splitting the horizon by which table happens to hold the row is the
--    "no identity of its own" mistake §2 of the plan is about. And a
--    dedup that only worked for today's rows would double every
--    appointment the moment the window reached past it.
-- ---------------------------------------------------------------------
select tests.clear_authentication();

-- Unlinked: the legacy shape (D4 leaves these unlinked forever).
insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome, appointment_at)
values ('00000000-0000-0000-0000-0000000000dc', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', current_date, 'warm_market', 'appointment_set',
        (current_date + 4)::timestamptz + interval '15 hours');

select tests.authenticate_as('00000000-0000-0000-0000-0000000000d1');

select is(
  (select count(*)::int from public.my_followups(current_date)
    where call_id = '00000000-0000-0000-0000-0000000000dc'),
  1, 'a legacy call-log appointment four days out reaches My Day too (branch 3 widened)'
);

-- Linked: one booking, one row, at four days out.
select tests.clear_authentication();

insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome, appointment_at)
values ('00000000-0000-0000-0000-0000000000dd', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', current_date, 'warm_market', 'appointment_set',
        (current_date + 4)::timestamptz + interval '16 hours');

insert into public.appointments (id, agent_id, contact_id, appt_type, status,
                                 set_on, scheduled_for, appt_date, source_call_log_id)
values ('00000000-0000-0000-0000-0000000000de', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', 'follow_up', 'scheduled',
        current_date, (current_date + 4)::timestamptz + interval '16 hours', current_date + 4,
        '00000000-0000-0000-0000-0000000000dd');

select tests.authenticate_as('00000000-0000-0000-0000-0000000000d1');

select is(
  (select count(*)::int from public.my_followups(current_date)
    where call_id in ('00000000-0000-0000-0000-0000000000dd',
                      '00000000-0000-0000-0000-0000000000de')),
  1, 'a linked pair four days out still appears once, not twice (F4 holds across the window)'
);

select is(
  (select kind from public.my_followups(current_date)
    where call_id = '00000000-0000-0000-0000-0000000000de'),
  'appointment', 'and the surviving row is the appointments one'
);

-- ---------------------------------------------------------------------
-- 6. The own-data fence, restated for the wider window.
--
--    my_followups is SECURITY DEFINER and reads past RLS, so its only
--    fence is `agent_id = auth.uid()`. Widening a window is exactly the
--    change that turns a missing predicate into a visible leak, so it is
--    re-asserted here rather than assumed from 001.
-- ---------------------------------------------------------------------
select tests.clear_authentication();

insert into public.appointments (id, agent_id, contact_id, appt_type, status,
                                 set_on, scheduled_for, appt_date)
values ('00000000-0000-0000-0000-0000000000df', '00000000-0000-0000-0000-0000000000d9',
        '00000000-0000-0000-0000-0000000000da', 'follow_up', 'scheduled',
        current_date, (current_date + 3)::timestamptz + interval '13 hours', current_date + 3);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000d1');

select is(
  (select count(*)::int from public.my_followups(current_date)
    where call_id = '00000000-0000-0000-0000-0000000000df'),
  0, 'another agent''s upcoming appointment is not visible through the widened window'
);

select is(
  (select count(*)::int from public.my_followups(current_date)
    where contact_id = '00000000-0000-0000-0000-0000000000da'),
  0, 'and neither is their contact'
);

select tests.clear_authentication();

select * from finish();
rollback;

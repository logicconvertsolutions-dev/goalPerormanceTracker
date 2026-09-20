-- pgTAP suite for P25 Phase C1: the call form creates the appointment, and
-- My Day reads the appointments table.
-- (`20260920140000_p25c1_call_creates_appointment.sql`)
--
-- 007 covers what the read model COMPUTES from appointments.
-- 008 covers the INVARIANTS the appointments table holds.
-- This file covers the LINK between a call and the appointment it created:
-- that the pair counts once rather than twice (F4, which 007 pins as
-- deliberately unfixed for an UNLINKED pair), that My Day shows it once
-- rather than twice, that a legacy call-only appointment still surfaces,
-- and that an appointment can finally carry an outcome at all (F11).
--
-- Run with: supabase test db

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

-- Same reasoning as 007/008: pin the session zone and the agent's zone so a
-- booking day can never straddle midnight mid-run.
set local time zone 'UTC';

select plan(13);

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000ee09', 'org_link');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('link_agent@example.com', '00000000-0000-0000-0000-00000000ee09', null, 'associate', 'seed-tok-l1', null);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'link_agent@example.com', 'authenticated', 'authenticated');

update public.agents set full_name = 'Link Agent', time_zone = 'UTC'
  where id = '00000000-0000-0000-0000-0000000000c1';

insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c1', 'Link Contact'),
  ('00000000-0000-0000-0000-0000000000c8', '00000000-0000-0000-0000-0000000000c1', 'Legacy Contact');

-- Impersonation helper, same convention as 001/003. my_followups is
-- SECURITY DEFINER keyed on auth.uid(), so its branches cannot be asserted
-- without one.
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
-- 1. F4 CLOSED. What logCallAction now writes: a call log with
--    outcome='appointment_set', plus an appointments row pointing back at
--    it. That is ONE booking and must count as one.
--
--    007's test 5 asserts the same two rows count TWICE when they are not
--    linked, and that is still correct -- legacy rows were deliberately
--    not retro-linked (D4). The difference between these two assertions is
--    exactly what source_call_log_id buys.
-- ---------------------------------------------------------------------
insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome, appointment_at)
values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-0000000000c2', current_date, 'warm_market', 'appointment_set',
        now() + interval '2 days');

insert into public.appointments (id, agent_id, contact_id, appt_type, status,
                                 set_on, scheduled_for, appt_date, source_call_log_id)
values ('00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-0000000000c2', 'follow_up', 'scheduled',
        current_date, now() + interval '2 days', (current_date + 2), '00000000-0000-0000-0000-0000000000c3');

select public.drain_metrics(1000);

select is(
  coalesce((select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000c1' and activity_date = current_date), 0),
  1, 'a call and the appointment it created count as ONE appts_set, not two (F4 closed)'
);

select is(
  coalesce((select out_appt_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000c1' and activity_date = current_date), 0),
  1, 'out_appt_set still counts the raw call outcome -- only the appts_set contribution is deduped'
);

-- ---------------------------------------------------------------------
-- 2. E16 -- one call log produces at most one appointment, enforced by the
--    unique index rather than only by the server action. A double-tap, an
--    offline replay and two devices all arrive here.
-- ---------------------------------------------------------------------
select throws_ok(
  $$insert into public.appointments (agent_id, contact_id, appt_type, status, set_on, appt_date, source_call_log_id)
    values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2',
            'follow_up', 'scheduled', current_date, current_date + 2,
            '00000000-0000-0000-0000-0000000000c3')$$,
  '23505'::char(5),
  null::text,
  'a second appointment cannot link to the same call log (E16)'
);

-- ---------------------------------------------------------------------
-- 3. My Day shows the linked pair ONCE. Before the dedup clause landed in
--    my_followups, every appointment booked after C1 deployed would have
--    appeared twice -- once from the appointments row, once from the call
--    log's own appointment_at.
--
--    Time-travel two days forward rather than back-dating the rows: the
--    queue's horizon is `due <= p_as_of`, and p_as_of is an argument.
-- ---------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-0000-0000-0000000000c1');

select is(
  (select count(*)::int from public.my_followups(current_date + 2)),
  1, 'a linked call + appointment appears in My Day once, not twice'
);

select is(
  (select kind from public.my_followups(current_date + 2)),
  'appointment', 'the surviving row is the appointments one, not the call log'
);

select is(
  (select call_id from public.my_followups(current_date + 2)),
  '00000000-0000-0000-0000-0000000000c4'::uuid,
  'and it carries the APPOINTMENT id, which is what the resolve actions need'
);

-- ---------------------------------------------------------------------
-- 4. A legacy appointment -- one that lives only on a call log, with no
--    appointments row -- must keep surfacing. D4 leaves these unlinked
--    forever, so dropping the call_logs branch entirely would silently
--    empty My Day for every appointment booked before C1.
-- ---------------------------------------------------------------------
select tests.clear_authentication();

insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome, appointment_at)
values ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000c1',
        '00000000-0000-0000-0000-0000000000c8', current_date, 'warm_market', 'appointment_set',
        now() + interval '2 days');

select tests.authenticate_as('00000000-0000-0000-0000-0000000000c1');

select is(
  (select count(*)::int from public.my_followups(current_date + 2) where kind = 'call_appointment'),
  1, 'an appointment that exists only on a call log still reaches My Day (legacy, D4)'
);

-- ---------------------------------------------------------------------
-- 5. F11 -- an appointment booked from a call can now be resolved at all.
--    Recording the outcome takes it out of the queue and moves it from
--    Appts Scheduled to Appts Held WITHOUT touching the booking event, per
--    the rule F3 exists to enforce.
-- ---------------------------------------------------------------------
select tests.clear_authentication();

update public.appointments
   set status = 'held', resolved_on = current_date
 where id = '00000000-0000-0000-0000-0000000000c4';

select public.drain_metrics(1000);

select is(
  coalesce((select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000c1' and activity_date = current_date), 0),
  2, 'resolving does not erase the booking: appts_set still counts both bookings on the day they were made'
);

select is(
  coalesce((select appt_held from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000c1' and activity_date = current_date), 0),
  1, 'the held outcome lands on the day it was RECORDED (resolved_on), not the day the appointment was for (E6)'
);

-- coalesce, not a bare read: recompute_day drops a row whose every counter
-- is zero, so the day this appointment WAS for has no daily_metrics row at
-- all once the appointment moves off it. That is the F1 delete guard
-- working, not a missing number.
select is(
  coalesce((select appt_scheduled from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000c1' and activity_date = current_date + 2), 0),
  0, 'and it is no longer counted as scheduled on the day it was for'
);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000c1');

select is(
  (select count(*)::int from public.my_followups(current_date + 2) where kind = 'appointment'),
  0, 'a resolved appointment leaves the My Day queue'
);

-- ---------------------------------------------------------------------
-- 6. F12 -- appointments.follow_up_on has been written by the appointment
--    form since P20 and read by nothing at all. The column existed, its
--    index existed, and "call them back in two weeks" set on a held
--    appointment simply vanished.
-- ---------------------------------------------------------------------
select tests.clear_authentication();

update public.appointments
   set follow_up_on = current_date + 5
 where id = '00000000-0000-0000-0000-0000000000c4';

select tests.authenticate_as('00000000-0000-0000-0000-0000000000c1');

select is(
  (select count(*)::int from public.my_followups(current_date + 5) where kind = 'appointment_follow_up'),
  1, 'a follow-up set on a resolved appointment reaches My Day (F12)'
);

select tests.clear_authentication();

update public.appointments
   set follow_up_done_at = now()
 where id = '00000000-0000-0000-0000-0000000000c4';

select tests.authenticate_as('00000000-0000-0000-0000-0000000000c1');

select is(
  (select count(*)::int from public.my_followups(current_date + 5) where kind = 'appointment_follow_up'),
  0, 'and marking it done removes it'
);

select tests.clear_authentication();

select * from finish();
rollback;

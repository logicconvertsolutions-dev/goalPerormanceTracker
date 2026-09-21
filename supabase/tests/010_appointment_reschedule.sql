-- pgTAP suite for P25 Phase C2: reschedule lineage and the overdue rule.
-- (`20260920150000_p25c2_reschedule_and_overdue.sql`)
--
-- 007 covers what the read model computes from appointments.
-- 008 covers the identity invariants the table holds.
-- 009 covers the link between a call and the appointment it created.
-- This file covers what happens when an appointment MOVES: the old row
-- terminates, a successor is born, the two stay linked, and neither the
-- chain nor the no-show denominator can be made to lie.
--
-- Run with: supabase test db

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

set local time zone 'UTC';

select plan(15);

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000ee10', 'org_resched');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('resched_agent@example.com', '00000000-0000-0000-0000-00000000ee10', null, 'associate', 'seed-tok-r1', null);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'resched_agent@example.com', 'authenticated', 'authenticated');

update public.agents set full_name = 'Resched Agent', time_zone = 'UTC'
  where id = '00000000-0000-0000-0000-0000000000e1';

insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'Resched Contact');

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
-- 1. What rescheduleAppointmentAction writes: the original terminates as
--    `rescheduled` on the day it was recorded, a successor is created for
--    the new slot, and the two are linked.
--
--    D2 -- the successor carries its OWN set_on, so the rebooking counts
--    as a second Appts Set. That is deliberate: re-booking a prospect who
--    moved is real work the SMD is measuring, and suppressing it would
--    hide activity that happened.
-- ---------------------------------------------------------------------
insert into public.appointments (id, agent_id, contact_id, appt_type, status,
                                 set_on, scheduled_for, appt_date, expected_premium_cents)
values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000e2', 'solutions_presentation', 'scheduled',
        current_date - 2, now() + interval '1 day', current_date + 1, 120000);

insert into public.appointments (id, agent_id, contact_id, appt_type, status,
                                 set_on, scheduled_for, appt_date, expected_premium_cents)
values ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000e2', 'solutions_presentation', 'scheduled',
        current_date, now() + interval '8 days', current_date + 8, 120000);

update public.appointments
   set status = 'rescheduled', resolved_on = current_date,
       rescheduled_to_id = '00000000-0000-0000-0000-0000000000e4'
 where id = '00000000-0000-0000-0000-0000000000e3';

select public.drain_metrics(1000);

select is(
  coalesce((select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000e1' and activity_date = current_date - 2), 0),
  1, 'the original booking keeps its own Appts Set on the day it was made'
);

select is(
  coalesce((select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000e1' and activity_date = current_date), 0),
  1, 'D2: the successor counts a NEW Appts Set on the day it was rebooked'
);

select is(
  coalesce((select appt_rescheduled from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000e1' and activity_date = current_date), 0),
  1, 'the original lands in appt_rescheduled on the day the move was recorded'
);

select is(
  (select scheduled_for from public.appointments where id = '00000000-0000-0000-0000-0000000000e3'),
  (now() + interval '1 day')::timestamptz,
  'F8: the original still knows the slot it was actually for -- rescheduling does not erase it'
);

-- ---------------------------------------------------------------------
-- 2. D3 -- neither `scheduled` nor `rescheduled` may reach the no-show
--    denominator. The rate is computed in lib/metrics.ts, but the counters
--    it divides come from here, so this asserts the shape they arrive in:
--    the rescheduled original and the pending successor are both recorded,
--    and both are recorded as something OTHER than an outcome.
-- ---------------------------------------------------------------------
select is(
  coalesce((select appt_held + appt_no_show + appt_cancelled from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000e1' and activity_date = current_date), 0),
  0, 'D3: a reschedule contributes nothing to the no-show denominator'
);

-- ---------------------------------------------------------------------
-- 3. E11 -- the chain is a list, not a graph. One predecessor per
--    successor, no cycles, bounded length.
-- ---------------------------------------------------------------------
insert into public.appointments (id, agent_id, contact_id, appt_type, status, set_on, appt_date)
values ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000e2', 'follow_up', 'scheduled',
        current_date, current_date + 3);

select throws_ok(
  $$update public.appointments set rescheduled_to_id = '00000000-0000-0000-0000-0000000000e4'
     where id = '00000000-0000-0000-0000-0000000000e5'$$,
  '23505'::char(5),
  null::text,
  'E11: two appointments cannot both reschedule into the same successor'
);

select throws_ok(
  $$update public.appointments set rescheduled_to_id = '00000000-0000-0000-0000-0000000000e3'
     where id = '00000000-0000-0000-0000-0000000000e4'$$,
  null,
  'E11: A -> B -> A is rejected as a cycle'
);

select throws_ok(
  $$update public.appointments set rescheduled_to_id = id
     where id = '00000000-0000-0000-0000-0000000000e5'$$,
  null,
  'E11: a row cannot reschedule into itself (Phase B guard, still holding)'
);

-- Build a chain long enough to trip the cap. Ten links is already
-- pathological -- the cap exists to stop a runaway, not to second-guess an
-- agent whose prospect keeps moving.
-- Ten linked appointments: A1 -> A2 -> ... -> A10. Building this chain must
-- SUCCEED -- the cap is ten, and a chain of exactly ten is at the limit,
-- not over it. If any link here raised, the do-block would abort the
-- transaction and every assertion below would fail, which is the control.
do $$
declare i int; prev uuid; cur uuid;
begin
  -- Every id is kept, not just the head: the control assertion below has
  -- to count links WITHIN this chain. Counting every linked row in the
  -- table instead would also pick up the e3 -> e4 pair from section 1,
  -- which is how this assertion was wrong the first time.
  create temp table chain(id uuid, ord int);
  prev := null;
  for i in 1..10 loop
    cur := gen_random_uuid();
    insert into public.appointments (id, agent_id, contact_id, appt_type, status, set_on, appt_date)
    values (cur, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2',
            'follow_up', 'scheduled', current_date, current_date + i);
    insert into chain values (cur, i);
    if prev is not null then
      update public.appointments set rescheduled_to_id = cur where id = prev;
    end if;
    prev := cur;
  end loop;
end $$;

select is(
  (select count(*)::int from public.appointments ap
     join chain c on c.id = ap.id
    where ap.rescheduled_to_id is not null),
  9, 'control: a chain of exactly ten appointments builds without complaint'
);

-- Prepend, do not append. The HEAD is the only end that can take another
-- link: pointing at the tail would trip the unique index (the ninth row
-- already points there) and prove nothing about the depth cap.
select throws_ok(
  format(
    $$update public.appointments set rescheduled_to_id = %L where id = %L$$,
    (select id from chain where ord = 1),
    '00000000-0000-0000-0000-0000000000e5'
  ),
  null,
  'E11: prepending an eleventh link past the depth cap is rejected'
);

-- ---------------------------------------------------------------------
-- 4. E10 -- the successor is deleted. The FK nulls the predecessor's
--    pointer; the predecessor must NOT quietly re-enter the no-show
--    denominator, and must not revert to pending.
-- ---------------------------------------------------------------------
delete from public.appointments where id = '00000000-0000-0000-0000-0000000000e4';

select is(
  (select rescheduled_to_id from public.appointments where id = '00000000-0000-0000-0000-0000000000e3'),
  null, 'E10: deleting the successor nulls the predecessor''s link'
);

select is(
  (select status::text from public.appointments where id = '00000000-0000-0000-0000-0000000000e3'),
  'rescheduled', 'E10: ...and the predecessor stays terminal, so it never re-enters the denominator'
);

-- ---------------------------------------------------------------------
-- 5. E5 -- an appointment cannot be more overdue than it is old.
--
--    Logging a still-pending appointment TODAY for a date last month is
--    legitimate: the agent is catching up on paperwork. My Day used to
--    brand it "30d overdue" the instant it was saved, because days_late
--    measured from the appointment's own date regardless of when the row
--    came into existence.
-- ---------------------------------------------------------------------
insert into public.appointments (id, agent_id, contact_id, appt_type, status,
                                 set_on, scheduled_for, appt_date)
values ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-0000000000e1',
        '00000000-0000-0000-0000-0000000000e2', 'follow_up', 'scheduled',
        current_date, now() - interval '30 days', current_date - 30);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000e1');

select is(
  (select days_late from public.my_followups(current_date)
    where call_id = '00000000-0000-0000-0000-0000000000e7'),
  0, 'E5: an appointment entered today for last month is 0 days late, not 30'
);

select is(
  (select count(*)::int from public.my_followups(current_date)
    where call_id = '00000000-0000-0000-0000-0000000000e7'),
  1, '...but it is still in the queue, because it genuinely needs an outcome'
);

select is(
  (select days_late from public.my_followups(current_date + 4)
    where call_id = '00000000-0000-0000-0000-0000000000e7'),
  4, '...and it ages normally from the day the agent actually got it'
);

select tests.clear_authentication();

select * from finish();
rollback;

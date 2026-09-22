-- pgTAP suite for P29: a resolved appointment's slot cannot move.
-- (`20260922120000_p29_appointment_slot_frozen.sql`)
--
-- 008 covers the identity invariants Phase B added (set_on immutable,
-- scheduled_for surviving a NULL on resolution). This file covers the half
-- 008 could not: a DIFFERENT slot written onto a resolved row, and the
-- transitions that must stay open -- moving a pending appointment,
-- resolving it, reopening it.
--
-- It also pins the database behaviour behind the edit-form fix in
-- updateAppointmentAction: on an UPDATE, writing appointment_at alone does
-- NOT move scheduled_for, so the app has to write scheduled_for itself.
--
-- Every write runs as the owning agent, through RLS, because that is the
-- path the app takes and the one a hostile client would use.
--
-- Run with: supabase test db

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

set local time zone 'UTC';

select plan(10);

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000ff10', 'org_slot');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('slot_agent@example.com', '00000000-0000-0000-0000-00000000ff10', null, 'associate', 'seed-tok-s1', null);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'slot_agent@example.com', 'authenticated', 'authenticated');

update public.agents set full_name = 'Slot Agent', time_zone = 'UTC'
  where id = '00000000-0000-0000-0000-0000000000f1';

insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1', 'Slot Contact');

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

-- A pending appointment three days out, at 15:00 UTC.
insert into public.appointments (id, agent_id, org_id, contact_id, appt_type, status,
                                 set_on, scheduled_for, appointment_at, appt_date)
values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f1',
        '00000000-0000-0000-0000-00000000ff10', '00000000-0000-0000-0000-0000000000f2',
        'solutions_presentation', 'scheduled', current_date,
        (current_date + 3) + time '15:00', (current_date + 3) + time '15:00', current_date + 3);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000f1');


-- ---------------------------------------------------------------------
-- 1. Why updateAppointmentAction now writes scheduled_for.
--    appointment_at alone is ignored on an update: the identity trigger
--    only copies it across when scheduled_for is null.
-- ---------------------------------------------------------------------
update public.appointments
   set appointment_at = (current_date + 5) + time '15:00'
 where id = '00000000-0000-0000-0000-0000000000f3';

select is(
  (select appt_date from public.appointments where id = '00000000-0000-0000-0000-0000000000f3'),
  current_date + 3,
  'writing appointment_at alone does not move a pending appointment (the old edit-form bug)'
);

-- 2. Writing scheduled_for does, and appt_date follows it.
update public.appointments
   set scheduled_for = (current_date + 5) + time '15:00'
 where id = '00000000-0000-0000-0000-0000000000f3';

select is(
  (select appt_date from public.appointments where id = '00000000-0000-0000-0000-0000000000f3'),
  current_date + 5,
  'writing scheduled_for moves a pending appointment, and appt_date follows'
);


-- ---------------------------------------------------------------------
-- 3. Resolving is allowed, and the slot survives it.
-- ---------------------------------------------------------------------
select lives_ok(
  $$update public.appointments set status = 'held', resolved_on = current_date
    where id = '00000000-0000-0000-0000-0000000000f3'$$,
  'scheduled -> held is allowed'
);

select is(
  (select scheduled_for from public.appointments where id = '00000000-0000-0000-0000-0000000000f3'),
  ((current_date + 5) + time '15:00')::timestamptz,
  '...and the slot is unchanged by resolving'
);


-- ---------------------------------------------------------------------
-- 4. THE GUARD: a different slot on a resolved row is rejected, whether
--    the status stays the same or moves to another outcome.
-- ---------------------------------------------------------------------
select throws_ok(
  $$update public.appointments set scheduled_for = (current_date + 9) + time '10:00'
    where id = '00000000-0000-0000-0000-0000000000f3'$$,
  '23514', null,
  'a held appointment''s slot cannot be moved'
);

select throws_ok(
  $$update public.appointments set status = 'cancelled', scheduled_for = (current_date + 9) + time '10:00'
    where id = '00000000-0000-0000-0000-0000000000f3'$$,
  '23514', null,
  '...nor moved while changing it to another outcome'
);


-- ---------------------------------------------------------------------
-- 5. What must stay open on a resolved row.
-- ---------------------------------------------------------------------
select lives_ok(
  $$update public.appointments set notes = 'Brought the quote', appointment_at = null
    where id = '00000000-0000-0000-0000-0000000000f3'$$,
  'editing notes (and the form''s appointment_at = null) on a held row is allowed -- E8'
);

select lives_ok(
  $$update public.appointments set status = 'no_show'
    where id = '00000000-0000-0000-0000-0000000000f3'$$,
  'correcting the outcome without touching the slot is allowed'
);

-- Reopen, then move: once it is pending again its slot is editable again.
update public.appointments set status = 'scheduled'
 where id = '00000000-0000-0000-0000-0000000000f3';

select lives_ok(
  $$update public.appointments set scheduled_for = (current_date + 7) + time '09:00'
    where id = '00000000-0000-0000-0000-0000000000f3'$$,
  'a reopened appointment can be moved again'
);

select is(
  (select appt_date from public.appointments where id = '00000000-0000-0000-0000-0000000000f3'),
  current_date + 7,
  '...and appt_date follows the new slot'
);

select tests.clear_authentication();

select * from finish();
rollback;

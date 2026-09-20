-- pgTAP suite for the appointment identity columns added in P25 Phase B
-- (`20260920130000_p25b_appointment_identity.sql`).
--
-- 007_appointment_lifecycle.sql covers what the READ MODEL computes.
-- This file covers the INVARIANTS the appointments table itself now holds:
-- set_on never moves, scheduled_for survives resolution, resolved_on
-- tracks status, appt_date stays derivable, and the two link columns can
-- only point inside one agent's own rows.
--
-- The point of Phase B is that these hold for EVERY writer, not just the
-- server actions -- the live app, the offline replay queue submitting a
-- pre-Phase-B payload days later, the import path, psql. So the tests
-- below deliberately write the OLD way (setting appt_date and
-- appointment_at directly, exactly as the current app code does) and
-- assert the new columns come out right anyway.
--
-- Run with: supabase test db

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

-- Same reasoning as 007: pin both the session zone and the agent's zone so
-- a booking day can never straddle midnight mid-run.
set local time zone 'UTC';

select plan(10);

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000ee06', 'org_identity');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('ident_agent@example.com', '00000000-0000-0000-0000-00000000ee06', null, 'associate', 'seed-tok-i1', null),
  ('ident_other@example.com', '00000000-0000-0000-0000-00000000ee06', null, 'associate', 'seed-tok-i2', null);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'ident_agent@example.com', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d9', 'ident_other@example.com', 'authenticated', 'authenticated');

update public.agents set full_name = 'Identity Agent', time_zone = 'UTC'
  where id = '00000000-0000-0000-0000-0000000000d1';
update public.agents set full_name = 'Other Agent', time_zone = 'UTC'
  where id = '00000000-0000-0000-0000-0000000000d9';

insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1', 'Identity Contact'),
  ('00000000-0000-0000-0000-0000000000da', '00000000-0000-0000-0000-0000000000d9', 'Other Contact');


-- ---------------------------------------------------------------------
-- 1. An insert written the old way still gets a booking day.
-- ---------------------------------------------------------------------
insert into public.appointments (id, agent_id, contact_id, appt_date, appt_type, status, appointment_at)
values ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', current_date + 3, 'follow_up', 'scheduled',
        now() + interval '3 days');

select is(
  (select set_on from public.appointments where id = '00000000-0000-0000-0000-0000000000d3'),
  current_date, 'insert derives set_on = today even when the writer never mentions it'
);


-- ---------------------------------------------------------------------
-- 2. An imported row books on its own date, not the import day (F5's rule,
--    now stored rather than re-derived on every read).
-- ---------------------------------------------------------------------
insert into public.appointments (id, agent_id, contact_id, appt_date, appt_type, status, import_row_hash)
values ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', current_date - 30, 'follow_up', 'scheduled',
        'ident-import-1');

select is(
  (select set_on from public.appointments where id = '00000000-0000-0000-0000-0000000000d4'),
  current_date - 30, 'an imported appointment books on its own date, not the import day'
);


-- ---------------------------------------------------------------------
-- 3. set_on is immutable. An agent may update their own appointment row;
--    they may not rewrite when it was booked, because that silently moves
--    a past day's Appts Set. CLAUDE.md rule 1: privileged column, trigger
--    not policy.
-- ---------------------------------------------------------------------
select throws_ok(
  $$ update public.appointments set set_on = current_date - 99
       where id = '00000000-0000-0000-0000-0000000000d3' $$,
  null,
  'set_on is immutable once written'
);


-- ---------------------------------------------------------------------
-- 4. F8 -- resolving an appointment must not destroy when it was FOR.
--    This writes exactly what updateAppointmentAction writes today:
--    status away from scheduled, appointment_at nulled, appt_date moved to
--    today. Before Phase B that made the real date/time unrecoverable.
-- ---------------------------------------------------------------------
update public.appointments
   set status = 'held', appointment_at = null, appt_date = current_date
 where id = '00000000-0000-0000-0000-0000000000d3';

select is(
  (select (scheduled_for at time zone 'UTC')::date
     from public.appointments where id = '00000000-0000-0000-0000-0000000000d3'),
  current_date + 3, 'F8: resolving through the old code path preserves scheduled_for'
);


-- ---------------------------------------------------------------------
-- 5. resolved_on records the day the outcome was taken...
-- ---------------------------------------------------------------------
select is(
  (select resolved_on from public.appointments where id = '00000000-0000-0000-0000-0000000000d3'),
  current_date, 'resolved_on is the day the outcome was recorded'
);


-- ---------------------------------------------------------------------
-- 6. ...and appt_date stays derivable from the new columns, so every
--    existing reader keeps working.
-- ---------------------------------------------------------------------
select is(
  (select appt_date from public.appointments where id = '00000000-0000-0000-0000-0000000000d3'),
  current_date, 'appt_date follows resolved_on for a terminal row'
);


-- ---------------------------------------------------------------------
-- 7. Reopening a resolved appointment clears its outcome day, and
--    appt_date falls back to the slot it is for.
-- ---------------------------------------------------------------------
update public.appointments set status = 'scheduled'
 where id = '00000000-0000-0000-0000-0000000000d3';

select is(
  (select coalesce(resolved_on::text, 'null') || '/' || appt_date::text
     from public.appointments where id = '00000000-0000-0000-0000-0000000000d3'),
  'null/' || (current_date + 3)::text,
  'reopening clears resolved_on and appt_date returns to the scheduled slot'
);


-- ---------------------------------------------------------------------
-- 8. F4 -- a call log whose appointment has its own row counts ONCE.
--    Unlinked legacy rows still count twice (deliberately deferred; see
--    007 and the Phase B migration header). Linking is what fixes it, and
--    Phase C is what does the linking.
-- ---------------------------------------------------------------------
insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome, appointment_at)
values ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', current_date, 'warm_market', 'appointment_set',
        now() + interval '2 days');

insert into public.appointments (id, agent_id, contact_id, appt_date, appt_type, status, appointment_at,
                                 source_call_log_id)
values ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000d1',
        '00000000-0000-0000-0000-0000000000d2', current_date + 2, 'follow_up', 'scheduled',
        now() + interval '2 days', '00000000-0000-0000-0000-0000000000d5');

select public.drain_metrics(10000);

-- d3 (set_on today) + d6 (set_on today) = 2 appointments booked today, and
-- the call log behind d6 is NOT counted again.
select is(
  (select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000d1' and activity_date = current_date),
  2, 'F4: a linked call log is counted through its appointment, not twice'
);


-- ---------------------------------------------------------------------
-- 9. ...but the raw call outcome is untouched. out_appt_set answers "how
--    many calls set an appointment", which is still 1 and must not be
--    deduped away with it.
-- ---------------------------------------------------------------------
select is(
  (select out_appt_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000d1' and activity_date = current_date),
  1, 'the dedup does not touch out_appt_set, which counts call outcomes'
);


-- ---------------------------------------------------------------------
-- 10. E20 -- a link may only point inside the same agent's own rows.
--     Without this, one agent could attach their appointment to another
--     agent's call log and silently suppress a day of that agent's
--     Appts Set.
-- ---------------------------------------------------------------------
insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome)
values ('00000000-0000-0000-0000-0000000000db', '00000000-0000-0000-0000-0000000000d9',
        '00000000-0000-0000-0000-0000000000da', current_date, 'cold', 'appointment_set');

select throws_ok(
  $$ update public.appointments
        set source_call_log_id = '00000000-0000-0000-0000-0000000000db'
      where id = '00000000-0000-0000-0000-0000000000d6' $$,
  null,
  'E20: source_call_log_id cannot reference another agent''s call log'
);


select * from finish();
rollback;

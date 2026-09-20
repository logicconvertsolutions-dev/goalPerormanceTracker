-- pgTAP suite for the appointment half of the daily_metrics read model.
--
-- WHY THIS FILE EXISTS: 002_daily_metrics_pipeline.sql proves the
-- dirty-queue -> drain -> recompute plumbing works, but every one of its
-- assertions goes through call_logs/calls_made. Nothing asserted on
-- appts_set or any appt_* column, which is why P23 and P24 both shipped
-- green while silently breaking them (see
-- `.github/Spec Sheets/12-appointment-lifecycle-remediation.md` §1).
--
-- PHASE 0 OF P25: this file currently encodes the behaviour as it is
-- TODAY, bugs included. Each assertion marked `CURRENT (Fn)` is a defect
-- deliberately pinned so that the P25 Phase A migration has to change it.
-- When that migration lands, these assertions flip to the correct
-- behaviour in the same commit -- that inversion IS the proof the fix
-- worked, and the diff between the two revisions of this file is the
-- reviewable record of exactly which numbers changed.
--
-- Do not "fix" an assertion here on its own. Either the migration changes
-- with it, or the assertion is describing reality and should stay.
--
-- Run with: supabase test db

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

-- Pin the session zone so `current_date` and `(created_at at time zone
-- agent.time_zone)::date` can never straddle a day boundary mid-run. The
-- agent below is given the matching 'UTC' zone for the same reason --
-- without both, this suite would be flaky for the few hours a day when
-- UTC and the agent's local date disagree.
set local time zone 'UTC';

select plan(6);

-- Seeding mirrors 002: handle_new_user() rejects an auth.users insert with
-- no matching open invitation, so seed org + invitation first and let the
-- trigger create public.agents.
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000ee07', 'org_appt');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('appt_agent@example.com', '00000000-0000-0000-0000-00000000ee07', null, 'associate', 'seed-tok-a1', null);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'appt_agent@example.com', 'authenticated', 'authenticated');

update public.agents
   set full_name = 'Appt Agent', time_zone = 'UTC'
 where id = '00000000-0000-0000-0000-0000000000a1';

insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'Appt Contact');


-- ---------------------------------------------------------------------
-- 1. Baseline: booking an appointment counts once, on the day it was set.
--    This one is correct today and must stay correct after Phase A.
-- ---------------------------------------------------------------------
insert into public.appointments (id, agent_id, contact_id, appt_date, appt_type, status)
values ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', current_date, 'follow_up', 'scheduled');

select public.drain_metrics(1000);

select is(
  coalesce((select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date), 0),
  1, 'baseline: a scheduled appointment counts 1 in appts_set on the day it was set'
);


-- ---------------------------------------------------------------------
-- 2. F3 -- appts_set erosion.
--    recompute_day counts appointments *currently* in status='scheduled',
--    so resolving one retroactively erases the "set" event that created
--    it. An agent who books on Monday and holds on Friday sees Monday's
--    Appts Set fall to 0. Held can exceed Set.
-- ---------------------------------------------------------------------
update public.appointments set status = 'held'
 where id = '00000000-0000-0000-0000-0000000000a3';

select public.drain_metrics(1000);

select is(
  coalesce((select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date), 0),
  0, 'CURRENT (F3): resolving to held erases the appts_set the booking created'
);

delete from public.appointments where id = '00000000-0000-0000-0000-0000000000a3';
select public.drain_metrics(1000);


-- ---------------------------------------------------------------------
-- 3. F1 -- the delete guard drops appointment-only days.
--    recompute_day's trailing DELETE names only calls_made, appts_set,
--    sales_count, recruiting_convos and follow_ups_due. A day whose only
--    activity is a resolved appointment has all five at zero, so the row
--    is inserted and then immediately deleted -- taking appt_held and any
--    referrals_given with it.
-- ---------------------------------------------------------------------
insert into public.appointments (id, agent_id, contact_id, appt_date, appt_type, status, referrals_given)
values ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', current_date - 3, 'solutions_presentation', 'held', 2);

select public.drain_metrics(1000);

select ok(
  not exists (select 1 from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date - 3),
  'CURRENT (F1): a day whose only activity is a resolved appointment keeps no daily_metrics row'
);

delete from public.appointments where id = '00000000-0000-0000-0000-0000000000a4';
select public.drain_metrics(1000);


-- ---------------------------------------------------------------------
-- 4. F4 -- double counting across the two sources.
--    appts_set = call_logs(outcome='appointment_set') + appointments
--    (status='scheduled'), with nothing linking or deduping them. The
--    agent who logs the call AND creates the appointment row -- i.e. the
--    one using the app most correctly -- counts the same appointment
--    twice.
-- ---------------------------------------------------------------------
insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome, appointment_at)
values ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', current_date, 'warm_market', 'appointment_set',
        now() + interval '2 days');

insert into public.appointments (id, agent_id, contact_id, appt_date, appt_type, status, appointment_at)
values ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', current_date + 2, 'follow_up', 'scheduled',
        now() + interval '2 days');

select public.drain_metrics(1000);

select is(
  coalesce((select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date), 0),
  2, 'CURRENT (F4): one appointment logged through both paths counts twice in appts_set'
);

delete from public.appointments where id = '00000000-0000-0000-0000-0000000000a6';
delete from public.call_logs where id = '00000000-0000-0000-0000-0000000000a5';
select public.drain_metrics(1000);


-- ---------------------------------------------------------------------
-- 5. F5 -- imported appointments land on the import day.
--    commit-import.ts never sets created_at, so it defaults to now().
--    appts_set buckets the appointments half by created_at, so importing
--    historical rows spikes *today's* Appts Set by however many are still
--    "Scheduled", regardless of their own appt_date.
-- ---------------------------------------------------------------------
insert into public.appointments (id, agent_id, contact_id, appt_date, appt_type, status, import_row_hash)
values ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', current_date - 30, 'marketing_presentation', 'scheduled',
        'import-hash-1');

select public.drain_metrics(1000);

select is(
  coalesce((select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date), 0),
  1, 'CURRENT (F5): an imported appointment counts on the import day, not its own date'
);

delete from public.appointments where id = '00000000-0000-0000-0000-0000000000a7';
select public.drain_metrics(1000);


-- ---------------------------------------------------------------------
-- 6. F2 -- retention purge destroys historical metrics.
--    purge_old_call_logs deletes aged call_logs, which fires the
--    call_logs_metrics AFTER DELETE trigger, which re-marks that old day
--    dirty, which recomputes it to zero from now-deleted rows -- and then
--    F1's guard removes the row entirely. The read model exists precisely
--    so aggregates outlive raw-row purging, and it does not.
--    call_log_retention_months defaults to 24 NOT NULL, so this is armed
--    for every org.
-- ---------------------------------------------------------------------
update public.organizations set call_log_retention_months = 1
 where id = '00000000-0000-0000-0000-00000000ee07';

insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome)
values ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', current_date - 90, 'cold', 'connected');

select public.drain_metrics(1000);
select private.purge_old_call_logs();
select public.drain_metrics(1000);

select ok(
  not exists (select 1 from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date - 90),
  'CURRENT (F2): purging an aged call log destroys that day''s daily_metrics row'
);


select * from finish();
rollback;

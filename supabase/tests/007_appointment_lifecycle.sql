-- pgTAP suite for the appointment half of the daily_metrics read model.
--
-- WHY THIS FILE EXISTS: 002_daily_metrics_pipeline.sql proves the
-- dirty-queue -> drain -> recompute plumbing works, but every one of its
-- assertions goes through call_logs/calls_made. Nothing asserted on
-- appts_set or any appt_* column, which is why P23 and P24 both shipped
-- green while silently breaking them (see
-- `.github/Spec Sheets/12-appointment-lifecycle-remediation.md` §1).
--
-- This file was introduced in P25 Phase 0 asserting the behaviour as it
-- was THEN -- bugs included -- and flipped to the assertions below by the
-- Phase A migration (20260920120000_p25a_metrics_integrity.sql). The diff
-- between those two revisions is the record of exactly which numbers the
-- fix moved; `git log -p` this file before changing a metric definition.
--
-- Run with: supabase test db

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

-- Pin the session zone so `current_date` and the agent-local booking date
-- can never straddle a day boundary mid-run. The agent below is given the
-- matching 'UTC' zone for the same reason -- without both, this suite would
-- be flaky for the few hours a day when UTC and the agent's local date
-- disagree.
set local time zone 'UTC';

select plan(10);

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
-- 1. Booking an appointment counts once, on the day it was set.
-- ---------------------------------------------------------------------
insert into public.appointments (id, agent_id, contact_id, appt_date, appt_type, status)
values ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', current_date, 'follow_up', 'scheduled');

select public.drain_metrics(1000);

select is(
  coalesce((select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date), 0),
  1, 'a scheduled appointment counts 1 in appts_set on the day it was set'
);


-- ---------------------------------------------------------------------
-- 2. F3 FIXED -- resolving an appointment must not erase the booking.
--    P24 counted rows *currently* in status='scheduled', so resolving one
--    retroactively zeroed the day it was booked on: Appts Held could
--    exceed Appts Set, and a closed cycle's numbers changed after the
--    fact. appts_set now counts the booking event.
-- ---------------------------------------------------------------------
update public.appointments set status = 'held'
 where id = '00000000-0000-0000-0000-0000000000a3';

select public.drain_metrics(1000);

select is(
  coalesce((select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date), 0),
  1, 'F3: resolving to held preserves the appts_set the booking created'
);

delete from public.appointments where id = '00000000-0000-0000-0000-0000000000a3';
select public.drain_metrics(1000);


-- ---------------------------------------------------------------------
-- 3. F1 FIXED -- a day whose only activity is a resolved appointment must
--    keep its row. The old guard hand-listed five counters, none of which
--    a resolved appointment touches, so the row was inserted and deleted
--    again in the same call -- losing appt_held and referrals_given.
-- ---------------------------------------------------------------------
insert into public.appointments (id, agent_id, contact_id, appt_date, appt_type, status, referrals_given)
values ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', current_date - 3, 'solutions_presentation', 'held', 2);

select public.drain_metrics(1000);

select is(
  (select appt_held || '/' || referrals_given from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date - 3),
  '1/2', 'F1: a day whose only activity is a resolved appointment keeps its row, with its counters intact'
);

delete from public.appointments where id = '00000000-0000-0000-0000-0000000000a4';
select public.drain_metrics(1000);


-- ---------------------------------------------------------------------
-- 4. The delete guard still works. F1's fix must not over-correct into
--    leaving genuinely empty rows behind -- that would refill
--    daily_metrics with noise and break the "row cleaned up, not stuck"
--    guarantee 002 asserts for calls.
-- ---------------------------------------------------------------------
insert into public.appointments (id, agent_id, contact_id, appt_date, appt_type, status)
values ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', current_date - 7, 'follow_up', 'cancelled');
select public.drain_metrics(1000);

delete from public.appointments where id = '00000000-0000-0000-0000-0000000000a9';
select public.drain_metrics(1000);

select ok(
  not exists (select 1 from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date - 7),
  'delete guard: a day with every counter back at zero keeps no row'
);


-- ---------------------------------------------------------------------
-- 5. F4 DEFERRED, pinned deliberately -- see the Phase A migration header.
--    One appointment logged through both paths still counts twice.
--    Deduping needs appointments.source_call_log_id, which lands in Phase
--    B; the only Phase-A alternative was a heuristic match on
--    (contact, appointment_at), which would break on resolution (F8 nulls
--    appointment_at) and make the number flap between 2 and 1.
--
--    WHEN PHASE B LANDS: this assertion becomes 1.
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
  2, 'F4 (deferred to Phase B): one appointment logged through both paths still counts twice'
);

delete from public.appointments where id = '00000000-0000-0000-0000-0000000000a6';
delete from public.call_logs where id = '00000000-0000-0000-0000-0000000000a5';
select public.drain_metrics(1000);


-- ---------------------------------------------------------------------
-- 6. F5 FIXED -- an imported appointment counts on its own date, not on
--    the day the import ran. commit-import.ts leaves created_at at now(),
--    so bucketing purely by created_at spiked the import day.
-- ---------------------------------------------------------------------
insert into public.appointments (id, agent_id, contact_id, appt_date, appt_type, status, import_row_hash)
values ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', current_date - 30, 'marketing_presentation', 'scheduled',
        'import-hash-1');

select public.drain_metrics(1000);

select is(
  coalesce((select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date), 0)
  || '/' ||
  coalesce((select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date - 30), 0),
  '0/1', 'F5: an imported appointment counts on its own date, not the import day'
);

delete from public.appointments where id = '00000000-0000-0000-0000-0000000000a7';
select public.drain_metrics(1000);


-- ---------------------------------------------------------------------
-- 7. F2 FIXED -- retention purges raw call logs on purpose; it must not
--    also rewrite the aggregate the read model exists to preserve.
--    call_log_retention_months defaults to 24 NOT NULL, so every org is
--    exposed to this, not just ones that opted in.
-- ---------------------------------------------------------------------
update public.organizations set call_log_retention_months = 1
 where id = '00000000-0000-0000-0000-00000000ee07';

insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome)
values ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', current_date - 90, 'cold', 'connected');

select public.drain_metrics(1000);
select private.purge_old_call_logs();
select public.drain_metrics(1000);

select is(
  (select calls_made from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date - 90),
  1, 'F2: purging an aged call log leaves that day''s daily_metrics row intact'
);

-- Restore the default so the fuzz pass below can't trip the purge.
update public.organizations set call_log_retention_months = 24
 where id = '00000000-0000-0000-0000-00000000ee07';


-- ---------------------------------------------------------------------
-- 7b. The purge's suppression flag must not outlive the purge.
--
--     F2's fix works by having purge_old_call_logs set `kautis.purging`
--     so enqueue_metrics skips re-marking the days it empties. That
--     setting is transaction-local -- and transaction-local is NOT
--     function-local. A pgTAP file wraps its whole suite in a single
--     BEGIN...ROLLBACK, so the first version of this migration left the
--     flag on for every statement after test 7, silently suppressing all
--     metric marking: tests 8 and 9 below failed with appts_set = 0.
--
--     That was a real defect, not a test artifact -- any caller running
--     the purge inside a larger transaction would have hit it. The
--     function now clears the flag explicitly. This asserts the behaviour
--     that matters (marking resumes), not the flag itself.
-- ---------------------------------------------------------------------
insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome)
values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a2', current_date - 60, 'referral', 'connected');

select public.drain_metrics(1000);

select is(
  coalesce((select calls_made from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date - 60), 0),
  1, 'F2: metric marking resumes after a purge — the suppression flag does not leak into the rest of the transaction'
);


-- ---------------------------------------------------------------------
-- 8. The invariant that F3 violated, stated directly: resolving an
--    appointment NEVER reduces appts_set, whichever terminal status it
--    lands in. Four appointments booked the same day, each resolved a
--    different way.
-- ---------------------------------------------------------------------
insert into public.appointments (agent_id, contact_id, appt_date, appt_type, status)
select '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
       current_date, 'follow_up', 'scheduled'
from generate_series(1, 4);

select public.drain_metrics(1000);

do $$
declare v_id uuid; v_status text;
begin
  for v_status in select unnest(array['held', 'no_show', 'cancelled', 'rescheduled']) loop
    select id into v_id from public.appointments
      where agent_id = '00000000-0000-0000-0000-0000000000a1'
        and status = 'scheduled' and appt_date = current_date
      limit 1;
    update public.appointments set status = v_status::public.appt_status where id = v_id;
  end loop;
end $$;

select public.drain_metrics(1000);

select is(
  coalesce((select appts_set from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = current_date), 0),
  4, 'invariant: appts_set is unchanged by resolving appointments to any terminal status'
);


-- ---------------------------------------------------------------------
-- 9. Fuzz, mirroring 002's call_logs pass: random insert/update/delete
--    against appointments, then assert appts_set equals a from-scratch
--    count over BOTH sources for every touched day. This is the assertion
--    that would have caught P23 and P24 before they shipped.
-- ---------------------------------------------------------------------
do $$
declare
  i int;
  op int;
  v_id uuid;
begin
  for i in 1..100 loop
    op := (random() * 2)::int; -- 0 insert, 1 update, 2 delete
    if op = 0 or not exists (
      select 1 from public.appointments where agent_id = '00000000-0000-0000-0000-0000000000a1'
    ) then
      insert into public.appointments (agent_id, contact_id, appt_date, appt_type, status, created_at)
      values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2',
              current_date - (random() * 5)::int, 'follow_up',
              (array['scheduled','held','no_show','cancelled','rescheduled'])[1 + (random() * 4)::int]::public.appt_status,
              now() - (random() * 5)::int * interval '1 day');
    elsif op = 1 then
      select id into v_id from public.appointments
        where agent_id = '00000000-0000-0000-0000-0000000000a1' order by random() limit 1;
      update public.appointments
         set status = (array['scheduled','held','no_show','cancelled','rescheduled'])[1 + (random() * 4)::int]::public.appt_status,
             appt_date = current_date - (random() * 5)::int
       where id = v_id;
    else
      select id into v_id from public.appointments
        where agent_id = '00000000-0000-0000-0000-0000000000a1' order by random() limit 1;
      delete from public.appointments where id = v_id;
    end if;
  end loop;
end $$;

select public.drain_metrics(10000);

select ok(
  not exists (
    select d.day
    from (
      select distinct activity_date as day from public.daily_metrics
        where agent_id = '00000000-0000-0000-0000-0000000000a1'
      union
      select distinct case when import_row_hash is not null
                           then appt_date
                           else (created_at at time zone 'UTC')::date end
        from public.appointments where agent_id = '00000000-0000-0000-0000-0000000000a1'
    ) d
    where coalesce((
            select appts_set from public.daily_metrics
            where agent_id = '00000000-0000-0000-0000-0000000000a1' and activity_date = d.day
          ), 0)
      <> (
            (select count(*) from public.call_logs
              where agent_id = '00000000-0000-0000-0000-0000000000a1'
                and call_date = d.day and outcome = 'appointment_set')
          + (select count(*) from public.appointments
              where agent_id = '00000000-0000-0000-0000-0000000000a1'
                and case when import_row_hash is not null
                         then appt_date
                         else (created_at at time zone 'UTC')::date end = d.day)
          )
  ),
  'fuzz: appts_set matches a from-scratch count over both sources for every touched day'
);


select * from finish();
rollback;

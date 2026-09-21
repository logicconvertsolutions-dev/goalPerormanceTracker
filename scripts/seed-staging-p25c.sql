-- Test fixtures for the P25 Phase C staging pass.
-- Companion to `.github/Spec Sheets/13-p25-phase-c-staging-verification.md` §2.
--
-- STAGING ONLY. Never run this against production — it writes rows.
--
-- WHY THIS EXISTS
--   Staging carries almost no appointment data, so three of the features
--   Phase C adds render as empty bands there and look like they are broken
--   when they are merely unseeded: the Needs-an-outcome band, the F12
--   appointment-follow-up queue item, and F16's delete guard (which needs
--   an appointment that actually produced a sale). This seeds one case per
--   finding so §2 can be walked end to end.
--
-- Everything it creates is prefixed `ZZ Test · ` so it sorts last, is
-- searchable from the contact filter, and can be removed with the block at
-- the bottom of this file.
--
-- IT WRITES THROUGH THE TRIGGERS ON PURPOSE. Phase B's whole argument is
-- that the identity invariants hold for every writer, not just the server
-- actions -- so seeding with plain SQL is a test of that claim, not a way
-- around it. `appt_date` is derived by the trigger in every row below.
--
-- USAGE
--   Set the two ids at the top to the agent you will be testing as, then
--   run the whole file. Re-running is safe: it wipes its own previous
--   output first. Afterwards run `select public.drain_metrics(1000);`
--   (the cron does this every minute anyway) so daily_metrics catches up.

do $$
declare
  -- ── EDIT THESE ────────────────────────────────────────────────────────
  v_agent uuid := '44d0cc2c-65f6-4e1a-8074-6136cebde2b3';  -- staging: Deepak WFG
  v_org   uuid := 'e5a7baf2-c6a3-45bc-a28c-7df692db7e91';  -- staging: Kautis Staging
  v_tz    text := 'America/Toronto';                       -- must match the agent's time_zone
  -- ──────────────────────────────────────────────────────────────────────
  c_overdue uuid; c_backdated uuid; c_imported uuid; c_nextmonth uuid; c_today uuid;
  c_held1 uuid; c_held2 uuid; c_noshow uuid; c_cancel uuid; c_resched uuid; c_f12 uuid;
  a_successor uuid; a_held2 uuid;
begin
  delete from public.sales        where contact_id in (select id from public.contacts where full_name like 'ZZ Test · %');
  delete from public.appointments where contact_id in (select id from public.contacts where full_name like 'ZZ Test · %');
  delete from public.call_logs    where contact_id in (select id from public.contacts where full_name like 'ZZ Test · %');
  delete from public.contacts     where full_name like 'ZZ Test · %';

  insert into public.contacts (agent_id, org_id, full_name) values (v_agent, v_org, 'ZZ Test · Overdue Pending') returning id into c_overdue;
  insert into public.contacts (agent_id, org_id, full_name) values (v_agent, v_org, 'ZZ Test · Backdated Entry') returning id into c_backdated;
  insert into public.contacts (agent_id, org_id, full_name) values (v_agent, v_org, 'ZZ Test · Imported Row')    returning id into c_imported;
  insert into public.contacts (agent_id, org_id, full_name) values (v_agent, v_org, 'ZZ Test · Next Month')      returning id into c_nextmonth;
  insert into public.contacts (agent_id, org_id, full_name) values (v_agent, v_org, 'ZZ Test · Today 2pm')       returning id into c_today;
  insert into public.contacts (agent_id, org_id, full_name) values (v_agent, v_org, 'ZZ Test · Held One')        returning id into c_held1;
  insert into public.contacts (agent_id, org_id, full_name) values (v_agent, v_org, 'ZZ Test · Held Two Sale')   returning id into c_held2;
  insert into public.contacts (agent_id, org_id, full_name) values (v_agent, v_org, 'ZZ Test · No Show')         returning id into c_noshow;
  insert into public.contacts (agent_id, org_id, full_name) values (v_agent, v_org, 'ZZ Test · Cancelled')       returning id into c_cancel;
  insert into public.contacts (agent_id, org_id, full_name) values (v_agent, v_org, 'ZZ Test · Rescheduled')     returning id into c_resched;
  insert into public.contacts (agent_id, org_id, full_name) values (v_agent, v_org, 'ZZ Test · F12 Follow-up')   returning id into c_f12;

  -- Needs an outcome: booked a week ago FOR five days ago, still pending.
  -- Genuinely five days late, and says so.
  insert into public.appointments (agent_id, org_id, contact_id, appt_type, status, set_on, scheduled_for, appt_date, expected_premium_cents)
  values (v_agent, v_org, c_overdue, 'solutions_presentation', 'scheduled',
          current_date - 7, ((current_date - 5) + time '14:00') at time zone v_tz, current_date - 5, 180000);

  -- E5: entered TODAY for a month ago. Same due date as the imported row
  -- below, and the pair is the whole demonstration -- this one must read
  -- 0 days late and that one 30, because days_late measures from
  -- greatest(due date, set_on).
  insert into public.appointments (agent_id, org_id, contact_id, appt_type, status, set_on, scheduled_for, appt_date)
  values (v_agent, v_org, c_backdated, 'follow_up', 'scheduled',
          current_date, ((current_date - 30) + time '10:00') at time zone v_tz, current_date - 30);

  -- F6: import-shaped -- no slot at all, only a date. Opening this in the
  -- edit form must show last month; before C2 it showed today and saving
  -- moved the appointment.
  insert into public.appointments (agent_id, org_id, contact_id, appt_type, status, set_on, appt_date, import_row_hash)
  values (v_agent, v_org, c_imported, 'follow_up', 'scheduled',
          current_date - 30, current_date - 30, 'zz-test-import-hash-1');

  -- Upcoming, deliberately OUTSIDE the current cycle: the band has to
  -- ignore the period filter or this row is invisible on the page.
  insert into public.appointments (agent_id, org_id, contact_id, appt_type, status, set_on, scheduled_for, appt_date, expected_premium_cents)
  values (v_agent, v_org, c_nextmonth, 'marketing_presentation', 'scheduled',
          current_date, ((current_date + 21) + time '11:30') at time zone v_tz, current_date + 21, 240000);

  -- Today at 2pm: Upcoming all morning, and still Upcoming at 2:01 --
  -- the bands split on the calendar day, not the clock.
  insert into public.appointments (agent_id, org_id, contact_id, appt_type, status, set_on, scheduled_for, appt_date, expected_premium_cents)
  values (v_agent, v_org, c_today, 'solutions_presentation', 'scheduled',
          current_date - 2, (current_date + time '14:00') at time zone v_tz, current_date, 95000);

  -- No-show fixtures, all inside the current cycle: 2 held + 1 no-show +
  -- 1 cancelled = 25%, and it must not move when scheduled rows are added.
  insert into public.appointments (agent_id, org_id, contact_id, appt_type, status, set_on, resolved_on, appt_date, expected_premium_cents, referrals_given)
  values (v_agent, v_org, c_held1, 'solutions_presentation', 'held', current_date - 3, current_date, current_date, 150000, 2);

  insert into public.appointments (agent_id, org_id, contact_id, appt_type, status, set_on, resolved_on, appt_date, expected_premium_cents)
  values (v_agent, v_org, c_held2, 'application', 'held', current_date - 4, current_date, current_date, 300000)
  returning id into a_held2;

  insert into public.appointments (agent_id, org_id, contact_id, appt_type, status, set_on, resolved_on, appt_date)
  values (v_agent, v_org, c_noshow, 'follow_up', 'no_show', current_date - 2, current_date, current_date);

  insert into public.appointments (agent_id, org_id, contact_id, appt_type, status, set_on, resolved_on, appt_date)
  values (v_agent, v_org, c_cancel, 'follow_up', 'cancelled', current_date - 2, current_date, current_date);

  -- Reschedule pair. Successor first, so the FK target exists when the
  -- predecessor points at it.
  insert into public.appointments (agent_id, org_id, contact_id, appt_type, status, set_on, scheduled_for, appt_date, expected_premium_cents)
  values (v_agent, v_org, c_resched, 'solutions_presentation', 'scheduled',
          current_date, ((current_date + 6) + time '16:00') at time zone v_tz, current_date + 6, 120000)
  returning id into a_successor;

  insert into public.appointments (agent_id, org_id, contact_id, appt_type, status, set_on, resolved_on, appt_date, expected_premium_cents, rescheduled_to_id)
  values (v_agent, v_org, c_resched, 'solutions_presentation', 'rescheduled',
          current_date - 6, current_date, current_date, 120000, a_successor);

  -- F12: a follow-up on a RESOLVED appointment. Written by the form since
  -- P20 and read by nothing until C1.
  insert into public.appointments (agent_id, org_id, contact_id, appt_type, status, set_on, resolved_on, appt_date, follow_up_on)
  values (v_agent, v_org, c_f12, 'marketing_presentation', 'held', current_date - 10, current_date - 8, current_date - 8, current_date);

  -- F16: an appointment that produced a sale, so Delete has a live case.
  insert into public.sales (agent_id, org_id, contact_id, appointment_id, sale_date, product_type, premium_cents)
  values (v_agent, v_org, c_held2, a_held2, current_date, 'term_life', 300000);
end $$;

select public.drain_metrics(1000);

-- ---------------------------------------------------------------------
-- CLEANUP -- removes everything this file created, and nothing else.
--
--   delete from public.sales        where contact_id in (select id from public.contacts where full_name like 'ZZ Test · %');
--   delete from public.appointments where contact_id in (select id from public.contacts where full_name like 'ZZ Test · %');
--   delete from public.call_logs    where contact_id in (select id from public.contacts where full_name like 'ZZ Test · %');
--   delete from public.contacts     where full_name like 'ZZ Test · %';
--   select public.drain_metrics(1000);
--
-- Run the drain afterwards too: deleting appointments marks their days
-- dirty, and daily_metrics should be rebuilt rather than left stale.
-- ---------------------------------------------------------------------

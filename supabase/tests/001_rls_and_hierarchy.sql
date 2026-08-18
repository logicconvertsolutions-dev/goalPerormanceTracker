-- pgTAP suite per docs/05-testing.md §1 (RLS / database).
-- Run with: supabase test db  (requires local Docker stack: supabase start)
--
-- Seeds two organizations per spec:
--   org_x: smd_x -> assoc_1 -> assoc_1a
--                -> assoc_2
--   org_y: smd_y -> assoc_3
-- assoc_1 -> assoc_1a proves the closure trigger at a third level even
-- though v1 is two levels deep.
--
-- Schema note: this suite is written against the AS-APPLIED migrations in
-- supabase/migrations/, not the earlier draft in docs/02-data-model.md.
-- Deployed RPCs are exactly: team_week_summary, agent_daily_activity,
-- agent_aggregate, team_inactive, my_followups, drain_metrics,
-- provision_org, create_invitation. There is no team_day_summary RPC.

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(68);

-- ---------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'smd_x@example.com',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'assoc_1@example.com',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 'assoc_1a@example.com', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a4', 'assoc_2@example.com',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b1', 'smd_y@example.com',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'assoc_3@example.com',  '{}', 'authenticated', 'authenticated');

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000ee01', 'org_x'),
  ('00000000-0000-0000-0000-00000000ee02', 'org_y');

-- Insert order matters: upline row must exist first (same-org + closure triggers).
insert into public.agents (id, org_id, full_name, email, upline_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000ee01', 'SMD X',    'smd_x@example.com',    null, 'leader');
insert into public.agents (id, org_id, full_name, email, upline_id, role) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000ee01', 'Assoc 1',  'assoc_1@example.com',  '00000000-0000-0000-0000-0000000000a1', 'associate');
insert into public.agents (id, org_id, full_name, email, upline_id, role) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-00000000ee01', 'Assoc 1a', 'assoc_1a@example.com', '00000000-0000-0000-0000-0000000000a2', 'associate');
insert into public.agents (id, org_id, full_name, email, upline_id, role) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-00000000ee01', 'Assoc 2',  'assoc_2@example.com',  '00000000-0000-0000-0000-0000000000a1', 'associate');
insert into public.agents (id, org_id, full_name, email, upline_id, role) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000ee02', 'SMD Y',    'smd_y@example.com',    null, 'leader');
insert into public.agents (id, org_id, full_name, email, upline_id, role) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-00000000ee02', 'Assoc 3',  'assoc_3@example.com',  '00000000-0000-0000-0000-0000000000b1', 'associate');

update public.organizations set owner_id = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-00000000ee01';
update public.organizations set owner_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-00000000ee02';

insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', 'Prospect One'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a4', 'Prospect Two'),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b2', 'Prospect Three');

insert into public.call_logs (agent_id, contact_id, source, outcome) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'warm_market', 'connected'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c2', 'cold',        'voicemail'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c3', 'referral',    'connected');

insert into public.appointments (agent_id, contact_id, appt_date, status) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', current_date, 'scheduled'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c2', current_date, 'scheduled');

insert into public.sales (agent_id, sale_date, premium_cents) values
  ('00000000-0000-0000-0000-0000000000a2', current_date, 10000),
  ('00000000-0000-0000-0000-0000000000a4', current_date, 20000);

insert into public.recruiting_logs (agent_id, log_date) values
  ('00000000-0000-0000-0000-0000000000a2', current_date),
  ('00000000-0000-0000-0000-0000000000a4', current_date);

-- Impersonation helper: PostgREST's local test convention.
create or replace function tests.authenticate_as(p_agent uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_agent, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function tests.authenticate_as_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'anon', true);
end $$;

create or replace function tests.clear_authentication()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', null, true);
  perform set_config('role', 'postgres', true);
end $$;

-- ============================================================
-- RLS matrix: call_logs, appointments, sales, recruiting_logs (#1-7)
-- ============================================================

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a2'); -- assoc_1
select is((select count(*) from public.call_logs)::int, 1, 'assoc_1 selects own call_logs rows: 1 returned');
select is((select count(*) from public.call_logs where agent_id = '00000000-0000-0000-0000-0000000000a4')::int, 0,
  'assoc_1 selecting assoc_2 call_logs rows: 0 rows');
select throws_ok(
  $$insert into public.call_logs (agent_id, contact_id, source, outcome)
    values ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000c2','cold','connected')$$,
  'assoc_1 inserting call_logs with agent_id = assoc_2 is rejected'
);
select is(
  (with upd as (
     update public.call_logs set notes = 'x'
     where agent_id = '00000000-0000-0000-0000-0000000000a4'
     returning 1
   ) select count(*) from upd)::int, 0,
  'assoc_1 updating assoc_2 call_logs row: 0 rows affected'
);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a1'); -- smd_x
select is((select count(*) from public.call_logs where agent_id = '00000000-0000-0000-0000-0000000000a2')::int, 0,
  'smd_x selecting assoc_1 call_logs directly: 0 rows (aggregate-only rule)');

select tests.authenticate_as('00000000-0000-0000-0000-0000000000b1'); -- smd_y
select is((select count(*) from public.call_logs where agent_id in
    ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a4'))::int, 0,
  'smd_y selecting anything belonging to org_x: 0 rows');

select tests.authenticate_as_anon();
select is((select count(*) from public.call_logs)::int, 0, 'anon selecting call_logs: 0 rows');

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a2');
select is((select count(*) from public.appointments)::int, 1, 'assoc_1 selects own appointments: 1 row');
select is((select count(*) from public.appointments where agent_id = '00000000-0000-0000-0000-0000000000a4')::int, 0,
  'assoc_1 selecting assoc_2 appointments: 0 rows');
select is((select count(*) from public.sales)::int, 1, 'assoc_1 selects own sales: 1 row');
select is((select count(*) from public.sales where agent_id = '00000000-0000-0000-0000-0000000000a4')::int, 0,
  'assoc_1 selecting assoc_2 sales: 0 rows');
select is((select count(*) from public.recruiting_logs)::int, 1, 'assoc_1 selects own recruiting_logs: 1 row');
select is((select count(*) from public.recruiting_logs where agent_id = '00000000-0000-0000-0000-0000000000a4')::int, 0,
  'assoc_1 selecting assoc_2 recruiting_logs: 0 rows');

-- ============================================================
-- P2.5: contacts and follow-ups (docs/05-testing.md "Contacts and
-- follow-ups" integration section, adapted to run as pgTAP against RLS).
-- ============================================================

-- Unique per agent on lower(full_name): "bharadwaj" then "Bharadwaj" reuses
-- one contact rather than creating a second.
select tests.authenticate_as('00000000-0000-0000-0000-0000000000a2'); -- assoc_1
select lives_ok(
  $$insert into public.contacts (agent_id, org_id, full_name)
    values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-00000000ee01','bharadwaj')$$,
  'assoc_1 can insert a new contact "bharadwaj"'
);
select throws_ok(
  $$insert into public.contacts (agent_id, org_id, full_name)
    values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-00000000ee01','Bharadwaj')$$,
  'inserting "Bharadwaj" for the same agent violates the lower(full_name) unique index'
);
select is(
  (select count(*)::int from public.contacts
   where agent_id = '00000000-0000-0000-0000-0000000000a2' and lower(full_name) = 'bharadwaj'),
  1, 'exactly one contact row exists for assoc_1 named (any case of) bharadwaj'
);

-- Two agents may each have a contact with the same name; neither sees the other's.
select tests.authenticate_as('00000000-0000-0000-0000-0000000000a4'); -- assoc_2
select lives_ok(
  $$insert into public.contacts (agent_id, org_id, full_name)
    values ('00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-00000000ee01','Bharadwaj')$$,
  'assoc_2 can independently have their own contact named Bharadwaj'
);
select is(
  (select count(*)::int from public.contacts where agent_id = '00000000-0000-0000-0000-0000000000a2'),
  0, 'assoc_2 selecting assoc_1''s contacts: 0 rows'
);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a1'); -- smd_x
select is(
  (select count(*)::int from public.contacts), 0,
  'smd_x (upline) selecting any contacts: 0 rows — no upline policy exists on this table'
);

-- /today query shape: my_followups returns only rows due for the calling
-- agent, where follow_up_on <= today and follow_up_done_at is null.
select tests.authenticate_as('00000000-0000-0000-0000-0000000000a2'); -- assoc_1
select lives_ok(
  $$insert into public.call_logs (agent_id, contact_id, source, outcome, follow_up_on)
    select '00000000-0000-0000-0000-0000000000a2', id, 'warm_market', 'connected', current_date - 1
    from public.contacts
    where agent_id = '00000000-0000-0000-0000-0000000000a2' and lower(full_name) = 'bharadwaj'$$,
  'assoc_1 logs a call with an overdue follow-up'
);
select lives_ok(
  $$insert into public.call_logs (agent_id, contact_id, source, outcome, follow_up_on)
    select '00000000-0000-0000-0000-0000000000a2', id, 'warm_market', 'connected', current_date + 30
    from public.contacts
    where agent_id = '00000000-0000-0000-0000-0000000000a2' and lower(full_name) = 'bharadwaj'$$,
  'assoc_1 logs a second call with a not-yet-due follow-up'
);
select is(
  (select count(*)::int from public.my_followups()),
  1, 'my_followups returns exactly the one due-or-overdue row, not the future one'
);
select ok(
  (select days_late > 0 from public.my_followups() limit 1),
  'the returned follow-up is reported as overdue (days_late > 0)'
);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a4'); -- assoc_2
select is(
  (select count(*)::int from public.my_followups()), 0,
  'my_followups for assoc_2 (no follow-ups of their own) returns 0 rows'
);

-- Snooze moves the date; mark-done sets follow_up_done_at and removes it
-- from the queue.
select tests.authenticate_as('00000000-0000-0000-0000-0000000000a2');
select lives_ok(
  $$update public.call_logs set follow_up_on = follow_up_on + 7
    where agent_id = '00000000-0000-0000-0000-0000000000a2' and follow_up_on = current_date - 1$$,
  'snooze: moving follow_up_on forward 7 days succeeds'
);
select is(
  (select count(*)::int from public.my_followups()), 0,
  'after snoozing past today, my_followups returns 0 rows'
);
select lives_ok(
  $$update public.call_logs set follow_up_done_at = now()
    where agent_id = '00000000-0000-0000-0000-0000000000a2' and follow_up_on = current_date + 30$$,
  'mark-done: setting follow_up_done_at on the future row succeeds'
);
select is(
  (select count(*)::int from public.call_logs
   where agent_id = '00000000-0000-0000-0000-0000000000a2' and follow_up_done_at is not null),
  1, 'exactly one call_logs row is marked done for assoc_1'
);

-- Deleting a contact cascades its calls (and would cascade appointments/sales
-- the same way via the same on delete cascade FK).
select is(
  (select count(*)::int from public.call_logs cl
   join public.contacts ct on ct.id = cl.contact_id
   where ct.agent_id = '00000000-0000-0000-0000-0000000000a2' and lower(ct.full_name) = 'bharadwaj'),
  2, 'sanity: bharadwaj has 2 call_logs rows before delete'
);
select lives_ok(
  $$delete from public.contacts
    where agent_id = '00000000-0000-0000-0000-0000000000a2' and lower(full_name) = 'bharadwaj'$$,
  'assoc_1 deletes their bharadwaj contact'
);
select is(
  (select count(*)::int from public.call_logs where agent_id = '00000000-0000-0000-0000-0000000000a2'
   and contact_id not in (select id from public.contacts)),
  0, 'deleting a contact cascades: no orphaned call_logs rows remain'
);

-- ============================================================
-- Hierarchy and RPC tests
-- ============================================================

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a1');
select ok((select private.is_upline_of('00000000-0000-0000-0000-0000000000a2')), 'is_upline_of: smd_x -> assoc_1 true');
select ok(not (select private.is_upline_of('00000000-0000-0000-0000-0000000000b2')), 'is_upline_of: smd_x -> assoc_3 false');

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a2');
select ok(not (select private.is_upline_of('00000000-0000-0000-0000-0000000000a4')), 'is_upline_of: assoc_1 -> assoc_2 false');
select ok((select private.is_upline_of('00000000-0000-0000-0000-0000000000a2')), 'is_upline_of: self true');

select tests.clear_authentication();
select public.drain_metrics(1000); -- so team_week_summary reflects the seeded rows

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.team_week_summary(public.week_start(current_date))), 4,
  'team_week_summary as smd_x returns exactly {smd_x, assoc_1, assoc_1a, assoc_2}');

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.team_week_summary(public.week_start(current_date))), 2,
  'team_week_summary as assoc_1 returns {assoc_1, assoc_1a}');

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.agent_daily_activity(
    '00000000-0000-0000-0000-0000000000b2', current_date - 1, current_date)), 0,
  'agent_daily_activity(assoc_3,...) called by smd_x returns 0 rows');

-- Cross-org write rejected by the same-org trigger.
select tests.clear_authentication();
select throws_ok(
  $$update public.agents set upline_id = '00000000-0000-0000-0000-0000000000a1'
    where id = '00000000-0000-0000-0000-0000000000b2'$$,
  'setting assoc_3.upline_id = smd_x is rejected by the same-org trigger'
);

-- Return-shape assertion: no RPC leaks a name/note/free-text field, except
-- the deliberate exception my_followups.contact_name/company/last_note,
-- which is the agent's OWN data (never crosses the hierarchy boundary).
select is(
  (select count(*)::int from information_schema.routines r
   join information_schema.parameters p
     on p.specific_schema = r.specific_schema and p.specific_name = r.specific_name
   where r.routine_schema = 'public'
     and r.routine_name in ('team_week_summary','agent_daily_activity','agent_aggregate','team_inactive')
     and p.parameter_mode = 'OUT'
     and p.parameter_name in ('contact_name','client_name','prospect_name','notes','last_note')
  ), 0,
  'no team-facing RPC return column is a name/note/free-text field'
);

-- Closure trigger: self-row at depth 0.
select tests.clear_authentication();
select ok(
  exists (select 1 from public.agent_closure
    where ancestor_id = '00000000-0000-0000-0000-0000000000a3'
      and descendant_id = '00000000-0000-0000-0000-0000000000a3' and depth = 0),
  'closure trigger: insert agent creates self-row (id,id,0)'
);

-- Move assoc_1a from assoc_1 to assoc_2: assoc_2 sees them, assoc_1 does not,
-- smd_x still does.
update public.agents set upline_id = '00000000-0000-0000-0000-0000000000a4'
  where id = '00000000-0000-0000-0000-0000000000a3';

select ok(
  exists (select 1 from public.agent_closure
    where ancestor_id = '00000000-0000-0000-0000-0000000000a4'
      and descendant_id = '00000000-0000-0000-0000-0000000000a3'),
  'closure move: assoc_2 now sees assoc_1a'
);
select ok(
  not exists (select 1 from public.agent_closure
    where ancestor_id = '00000000-0000-0000-0000-0000000000a2'
      and descendant_id = '00000000-0000-0000-0000-0000000000a3'),
  'closure move: assoc_1 no longer sees assoc_1a'
);
select ok(
  exists (select 1 from public.agent_closure
    where ancestor_id = '00000000-0000-0000-0000-0000000000a1'
      and descendant_id = '00000000-0000-0000-0000-0000000000a3'),
  'closure move: smd_x still sees assoc_1a'
);

-- Cycle guard: setting a descendant as your own upline is rejected.
select throws_ok(
  $$update public.agents set upline_id = '00000000-0000-0000-0000-0000000000a3'
    where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'cycle guard: setting a descendant (assoc_1a) as smd_x''s upline is rejected'
);

-- Moving an agent across orgs is rejected by the same-org trigger.
select throws_ok(
  $$update public.agents set upline_id = '00000000-0000-0000-0000-0000000000b1'
    where id = '00000000-0000-0000-0000-0000000000a3'$$,
  'moving assoc_1a to smd_y (different org) is rejected'
);

-- Deactivated agent excluded from roster but history still sums.
update public.agents set status = 'inactive' where id = '00000000-0000-0000-0000-0000000000a4';
select tests.authenticate_as('00000000-0000-0000-0000-0000000000a1');
select is(
  (select count(*)::int from public.team_week_summary(public.week_start(current_date))
   where agent_id = '00000000-0000-0000-0000-0000000000a4'), 0,
  'deactivated agent excluded from team_week_summary roster'
);
select tests.clear_authentication();
select ok(
  exists (select 1 from public.daily_metrics where agent_id = '00000000-0000-0000-0000-0000000000a4'),
  'deactivated agent history still present in daily_metrics'
);
update public.agents set status = 'active' where id = '00000000-0000-0000-0000-0000000000a4';

-- ============================================================
-- Targets
-- ============================================================

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a1'); -- smd_x, leader
select lives_ok(
  $$insert into public.targets (org_id, agent_id, set_by, effective_from, calls_per_week)
    values ('00000000-0000-0000-0000-00000000ee01', null, '00000000-0000-0000-0000-0000000000a1', public.week_start(current_date), 60)$$,
  'smd_x can write an org default target'
);
select lives_ok(
  $$insert into public.targets (org_id, agent_id, set_by, effective_from, calls_per_week)
    values ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', public.week_start(current_date), 75)$$,
  'smd_x can write an override for assoc_1'
);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a2'); -- assoc_1
select throws_ok(
  $$insert into public.targets (org_id, agent_id, set_by, effective_from, calls_per_week)
    values ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a2', public.week_start(current_date) + 7, 100)$$,
  'assoc_1 cannot write any target'
);
select is((select count(*)::int from public.targets where agent_id is null and org_id = '00000000-0000-0000-0000-00000000ee01'), 1,
  'assoc_1 can read the org default');
select is((select count(*)::int from public.targets where agent_id = '00000000-0000-0000-0000-0000000000a2'), 1,
  'assoc_1 can read their own override');
select is((select count(*)::int from public.targets where agent_id = '00000000-0000-0000-0000-0000000000a4'), 0,
  'assoc_1 cannot read assoc_2''s override (not their own, not upline)');

select tests.authenticate_as('00000000-0000-0000-0000-0000000000b1'); -- smd_y
select throws_ok(
  $$insert into public.targets (org_id, agent_id, set_by, effective_from, calls_per_week)
    values ('00000000-0000-0000-0000-00000000ee01', null, '00000000-0000-0000-0000-0000000000b1', public.week_start(current_date) + 14, 90)$$,
  'smd_y cannot write into org_x'
);

-- Targets uniqueness: two org-default rows for the same effective_from rejected.
select tests.authenticate_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok(
  $$insert into public.targets (org_id, agent_id, set_by, effective_from, calls_per_week)
    values ('00000000-0000-0000-0000-00000000ee01', null, '00000000-0000-0000-0000-0000000000a1', public.week_start(current_date), 999)$$,
  'two org-default target rows for the same effective_from are rejected'
);

-- effective_target: override beats org default beats fallback.
select tests.clear_authentication();
select is(
  (select calls_per_week from private.effective_target('00000000-0000-0000-0000-0000000000a2', public.week_start(current_date))),
  75, 'effective_target: agent override (75) beats org default (60)'
);
select is(
  (select calls_per_week from private.effective_target('00000000-0000-0000-0000-0000000000a3', public.week_start(current_date))),
  60, 'effective_target: org default (60) applies where no override exists'
);
select is(
  (select calls_per_week from private.effective_target('00000000-0000-0000-0000-0000000000b2', public.week_start(current_date))),
  50, 'effective_target: fallback (50) applies where org has no target at all'
);

-- ============================================================
-- audit_log
-- ============================================================
select tests.authenticate_as('00000000-0000-0000-0000-0000000000a2');
select throws_ok(
  $$insert into public.audit_log (action, entity) values ('x','y')$$,
  'authenticated user cannot insert into audit_log'
);

-- ============================================================
-- Privilege escalation — the single most important test in the file.
-- ============================================================
select tests.authenticate_as('00000000-0000-0000-0000-0000000000a2'); -- assoc_1
select throws_ok(
  $$update public.agents set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a2'$$,
  'assoc_1 setting own role to admin is rejected'
);
select throws_ok(
  $$update public.agents set upline_id = null where id = '00000000-0000-0000-0000-0000000000a2'$$,
  'assoc_1 changing own upline_id is rejected'
);
select throws_ok(
  $$update public.agents set org_id = '00000000-0000-0000-0000-00000000ee02' where id = '00000000-0000-0000-0000-0000000000a2'$$,
  'assoc_1 changing own org_id is rejected'
);
select throws_ok(
  $$update public.agents set status = 'inactive' where id = '00000000-0000-0000-0000-0000000000a2'$$,
  'assoc_1 changing own status is rejected'
);
select lives_ok(
  $$update public.agents set full_name = 'Assoc One Renamed' where id = '00000000-0000-0000-0000-0000000000a2'$$,
  'assoc_1 updating own full_name succeeds'
);

-- ============================================================
-- daily_metrics
-- ============================================================
select tests.authenticate_as('00000000-0000-0000-0000-0000000000a2');
select ok((select count(*) from public.daily_metrics) >= 1, 'assoc_1 selects own daily_metrics rows');
select is((select count(*) from public.daily_metrics where agent_id = '00000000-0000-0000-0000-0000000000a4')::int, 0,
  'assoc_1 selecting assoc_2 daily_metrics: 0 rows');
select throws_ok(
  $$insert into public.daily_metrics (agent_id, org_id, activity_date)
    values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-00000000ee01', current_date + 30)$$,
  'authenticated user cannot directly insert into daily_metrics'
);

select * from finish();
rollback;

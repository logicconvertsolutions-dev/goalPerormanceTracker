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
-- provision_org, create_invitation, plus P5's team_target,
-- team_day_summary, team_trend, team_breakdown, nudge_agent
-- (supabase/migrations/20260818194500_p5a_team_dashboard_rpcs.sql).

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(79);

-- ---------------------------------------------------------------------
-- Seed
-- ---------------------------------------------------------------------
-- handle_new_user() (p1j_invite_only_signup.sql) rejects any auth.users
-- insert without a matching open invitation, and this suite's runner isn't
-- the owner of auth.users so it can't disable that trigger directly. Give
-- it what it wants instead: a throwaway org + a matching invitation per
-- seeded email, inserted (and left to roll back) before the real users.
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000ee01', 'org_x'),
  ('00000000-0000-0000-0000-00000000ee02', 'org_y');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('smd_x@example.com',    '00000000-0000-0000-0000-00000000ee01', null, 'leader',    'seed-tok-a1', null),
  ('assoc_1@example.com',  '00000000-0000-0000-0000-00000000ee01', null, 'associate', 'seed-tok-a2', null),
  ('assoc_1a@example.com', '00000000-0000-0000-0000-00000000ee01', null, 'associate', 'seed-tok-a3', null),
  ('assoc_2@example.com',  '00000000-0000-0000-0000-00000000ee01', null, 'associate', 'seed-tok-a4', null),
  ('smd_y@example.com',    '00000000-0000-0000-0000-00000000ee02', null, 'leader',    'seed-tok-b1', null),
  ('assoc_3@example.com',  '00000000-0000-0000-0000-00000000ee02', null, 'associate', 'seed-tok-b2', null);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'smd_x@example.com',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'assoc_1@example.com',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 'assoc_1a@example.com', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a4', 'assoc_2@example.com',  '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b1', 'smd_y@example.com',    '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'assoc_3@example.com',  '{}', 'authenticated', 'authenticated');

-- handle_new_user's trigger already inserted each agents row (id/org_id/
-- email/role from the invitation, upline_id null, full_name from the local
-- part of the email) when the auth.users insert above fired it. Reshape to
-- match this suite's fixture exactly: display names and the org_x hierarchy
-- edges. auth.uid() is null in this seed context (no tests.authenticate_as
-- called yet), so guard_agent_privileged_columns' upline_id/role/org_id/
-- status check is a no-op here (it only fires when auth.uid() is not null).
update public.agents set full_name = 'SMD X'    where id = '00000000-0000-0000-0000-0000000000a1';
update public.agents set full_name = 'Assoc 1',  upline_id = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-0000000000a2';
update public.agents set full_name = 'Assoc 1a', upline_id = '00000000-0000-0000-0000-0000000000a2' where id = '00000000-0000-0000-0000-0000000000a3';
update public.agents set full_name = 'Assoc 2',  upline_id = '00000000-0000-0000-0000-0000000000a1' where id = '00000000-0000-0000-0000-0000000000a4';
update public.agents set full_name = 'SMD Y'    where id = '00000000-0000-0000-0000-0000000000b1';
update public.agents set full_name = 'Assoc 3',  upline_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000000b2';

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

-- set_config('role', ..., true) behaves like SET LOCAL ROLE: it actually
-- switches the session's privilege-checking role, not just a GUC value. Once
-- switched to authenticated/anon, those roles need USAGE on this schema and
-- EXECUTE on these functions to call back into tests.* again (e.g. to
-- re-authenticate as a different agent, or to clear_authentication back to
-- postgres) — otherwise every impersonation after the first one fails with
-- "permission denied for schema tests".
grant usage on schema tests to authenticated, anon;
grant execute on function tests.authenticate_as(uuid) to authenticated, anon;
grant execute on function tests.authenticate_as_anon() to authenticated, anon;
grant execute on function tests.clear_authentication() to authenticated, anon;

-- private.* is deliberately never granted to authenticated/anon in
-- production (02-data-model.md: reachable only via SECURITY DEFINER RPCs,
-- not directly) -- but this suite calls private.is_upline_of/effective_target
-- etc. directly, as an impersonated role, to test the helpers in isolation.
-- Scoped to this rolled-back transaction only; never lands in a real
-- migration.
grant usage on schema private to authenticated, anon;
grant execute on all functions in schema private to authenticated, anon;

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
-- A writable CTE must be a top-level statement in Postgres, so it can't sit
-- as a scalar subquery argument inside select is(...) — run it as its own
-- top-level statement (WITH ... UPDATE ... RETURNING ... SELECT count(*)),
-- capture the count, then assert against that.
create temporary table tests_scratch_upd on commit drop as
  with upd as (
    update public.call_logs set notes = 'x'
    where agent_id = '00000000-0000-0000-0000-0000000000a4'
    returning 1
  )
  select count(*)::int as n from upd;
select is((select n from tests_scratch_upd), 0,
  'assoc_1 updating assoc_2 call_logs row: 0 rows affected'
);
drop table tests_scratch_upd;

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
     and r.routine_name in (
       'team_week_summary','agent_daily_activity','agent_aggregate','team_inactive',
       'team_target','team_day_summary','team_trend','team_breakdown'
     )
     and p.parameter_mode = 'OUT'
     and p.parameter_name in ('contact_name','client_name','prospect_name','notes','last_note')
  ), 0,
  'no team-facing RPC return column is a name/note/free-text field'
);

-- ============================================================
-- P5: team dashboard RPCs (team_target, team_day_summary, team_trend,
-- team_breakdown, nudge_agent) and the targets audit trigger.
-- ============================================================

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a1'); -- smd_x
select is(
  (select count(*)::int from public.team_target('00000000-0000-0000-0000-0000000000b2', public.week_start(current_date))),
  0, 'team_target(assoc_3,...) called by smd_x (not upline) returns 0 rows'
);
select ok(
  (select count(*)::int from public.team_target('00000000-0000-0000-0000-0000000000a2', public.week_start(current_date))) = 1,
  'team_target(assoc_1,...) called by smd_x (upline) returns 1 row'
);

select is(
  (select count(*)::int from public.team_day_summary(current_date)
   where agent_id = '00000000-0000-0000-0000-0000000000b2'),
  0, 'team_day_summary never returns an agent from another org'
);

-- team_breakdown sums only the caller's downline: smd_x's total calls_made
-- should equal assoc_1 + assoc_1a + assoc_2's daily_metrics for the period,
-- and must never include assoc_3 (org_y).
select is(
  (select calls_made from public.team_breakdown(current_date - 7, current_date)),
  (select coalesce(sum(calls_made),0)::int from public.daily_metrics
   where agent_id in (
     '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2',
     '00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a4'
   ) and activity_date between current_date - 7 and current_date),
  'team_breakdown sums exactly the caller''s downline, org_y excluded'
);

-- nudge_agent: happy path writes audit_log, rejects a non-downline target,
-- and rate-limits to one per agent per 7 days.
select tests.authenticate_as('00000000-0000-0000-0000-0000000000a1'); -- smd_x
select throws_ok(
  $$select public.nudge_agent('00000000-0000-0000-0000-0000000000b2')$$,
  'nudge_agent rejects a non-downline agent (assoc_3)'
);
select lives_ok(
  $$select public.nudge_agent('00000000-0000-0000-0000-0000000000a2')$$,
  'smd_x nudges assoc_1 successfully'
);
select is(
  (select count(*)::int from public.audit_log where action = 'agent.nudged' and entity_id = '00000000-0000-0000-0000-0000000000a2'),
  1, 'nudge_agent writes exactly one audit_log row'
);
select throws_ok(
  $$select public.nudge_agent('00000000-0000-0000-0000-0000000000a2')$$,
  'nudging the same agent again within 7 days is rejected'
);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000a2'); -- assoc_1, not a leader
select throws_ok(
  $$select public.nudge_agent('00000000-0000-0000-0000-0000000000a3')$$,
  'an associate (non-leader) cannot nudge anyone'
);

-- Every targets write lands in audit_log via the pre-existing
-- audit_target_change/targets_audit trigger (p1j_invite_only_signup.sql).
select tests.authenticate_as('00000000-0000-0000-0000-0000000000a1'); -- smd_x
select lives_ok(
  $$insert into public.targets (org_id, agent_id, set_by, effective_from, calls_per_week)
    values ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a1', public.week_start(current_date) + 21, 55)$$,
  'smd_x writes another override for assoc_2'
);
select is(
  (select count(*)::int from public.audit_log where action = 'insert.target' and metadata->>'agent_id' = '00000000-0000-0000-0000-0000000000a4'),
  1, 'targets_audit trigger logs the target write to audit_log'
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

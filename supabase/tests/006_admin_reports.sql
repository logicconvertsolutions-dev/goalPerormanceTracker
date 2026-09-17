-- pgTAP suite for P22 (supabase/migrations/20260917110000_p22_admin_reports.sql):
-- admin_activity_report / admin_targets_vs_actuals access control and
-- correctness, plus report_definitions RLS.
--
-- Run with: supabase test db

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(15);

-- ---------------------------------------------------------------------
-- Seed: one org, one leader (later role-flipped to admin, same trick as
-- 001_rls_and_hierarchy.sql's privilege-escalation section -- a plain role
-- update, not a real org-less admin signup), one associate with a call and
-- a sale logged today, and a second org used only for the org-filter check.
-- ---------------------------------------------------------------------
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000ee51', 'org_reports_suite'),
  ('00000000-0000-0000-0000-00000000ee52', 'org_reports_suite_other');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('reports_suite_leader@example.com', '00000000-0000-0000-0000-00000000ee51', null, 'leader',    'seed-tok-r1', null),
  ('reports_suite_assoc@example.com',  '00000000-0000-0000-0000-00000000ee51', null, 'associate', 'seed-tok-r2', null);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('000000000000000000000000000000d1', 'reports_suite_leader@example.com', '{}', 'authenticated', 'authenticated'),
  ('000000000000000000000000000000d2', 'reports_suite_assoc@example.com',  '{}', 'authenticated', 'authenticated');

update public.agents set upline_id = '000000000000000000000000000000d1'
  where id = '000000000000000000000000000000d2';

insert into public.contacts (id, agent_id, full_name) values
  ('000000000000000000000000000000d3', '000000000000000000000000000000d2', 'Reports Suite Contact');
insert into public.call_logs (agent_id, contact_id, call_date, source, outcome) values
  ('000000000000000000000000000000d2', '000000000000000000000000000000d3', current_date, 'warm_market', 'connected'),
  ('000000000000000000000000000000d2', '000000000000000000000000000000d3', current_date, 'warm_market', 'connected'),
  ('000000000000000000000000000000d2', '000000000000000000000000000000d3', current_date, 'warm_market', 'connected');
insert into public.sales (agent_id, org_id, contact_id, sale_date, premium_cents) values
  ('000000000000000000000000000000d2', '00000000-0000-0000-0000-00000000ee51', '000000000000000000000000000000d3', current_date, 50000);
select public.drain_metrics(1000);

-- Impersonation helpers, same convention as every other suite in this repo.
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

create or replace function tests.authenticate_as_service_role()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('role', 'service_role', true);
end $$;

create or replace function tests.clear_authentication()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', null, true);
  perform set_config('role', 'postgres', true);
end $$;

grant usage on schema tests to authenticated, anon, service_role;
grant execute on function tests.authenticate_as(uuid)         to authenticated, anon, service_role;
grant execute on function tests.authenticate_as_anon()         to authenticated, anon, service_role;
grant execute on function tests.authenticate_as_service_role() to authenticated, anon, service_role;
grant execute on function tests.clear_authentication()         to authenticated, anon, service_role;

-- ---------------------------------------------------------------------
-- Access control: neither an authenticated agent nor anon can call either
-- RPC directly -- service-role only, same as admin_daily_active_loggers.
-- ---------------------------------------------------------------------
select is(
  has_function_privilege('authenticated', 'public.admin_activity_report(date,date,uuid)', 'EXECUTE'),
  false, 'authenticated has no EXECUTE on admin_activity_report'
);
select is(
  has_function_privilege('anon', 'public.admin_activity_report(date,date,uuid)', 'EXECUTE'),
  false, 'anon has no EXECUTE on admin_activity_report'
);
select is(
  has_function_privilege('authenticated', 'public.admin_targets_vs_actuals(date,date,uuid)', 'EXECUTE'),
  false, 'authenticated has no EXECUTE on admin_targets_vs_actuals'
);
select is(
  has_function_privilege('anon', 'public.admin_targets_vs_actuals(date,date,uuid)', 'EXECUTE'),
  false, 'anon has no EXECUTE on admin_targets_vs_actuals'
);

-- ---------------------------------------------------------------------
-- admin_activity_report correctness, called as service_role.
-- ---------------------------------------------------------------------
select tests.authenticate_as_service_role();
create temporary table tmp_activity on commit drop as
  select * from public.admin_activity_report(current_date - 9, current_date, null::uuid);

select is(
  (select calls_made from tmp_activity where agent_id = '000000000000000000000000000000d2'),
  3, 'admin_activity_report sums the 3 logged calls for the associate'
);
select is(
  (select sales_count::int + premium_cents::int from tmp_activity where agent_id = '000000000000000000000000000000d2'),
  1 + 50000, 'admin_activity_report sums sales_count and premium_cents for the associate'
);
select is(
  (select count(*)::int from public.admin_activity_report(current_date - 9, current_date, '00000000-0000-0000-0000-00000000ee52')
   where agent_id = '000000000000000000000000000000d2'),
  0, 'filtering admin_activity_report by a different org excludes the associate'
);

-- ---------------------------------------------------------------------
-- admin_targets_vs_actuals correctness -- no targets row was ever inserted
-- for this org/agent, so effective_target() falls back to its own COALESCE
-- literals: 72 calls/cycle, 7 min-calls/day (P20a org_default_target_values
-- raised these from the original baseline's 50/15 -- read the live function
-- body, don't trust the baseline migration alone). A 10-day window is
-- exactly one cycle, so calls_target should equal the fallback verbatim.
-- ---------------------------------------------------------------------
create temporary table tmp_targets on commit drop as
  select * from public.admin_targets_vs_actuals(current_date - 9, current_date, null::uuid);

select is(
  (select count(*)::int from public.admin_targets_vs_actuals(current_date - 9, current_date, '00000000-0000-0000-0000-00000000ee52')
   where agent_id = '000000000000000000000000000000d2'),
  0, 'filtering admin_targets_vs_actuals by a different org excludes the associate'
);
select tests.clear_authentication();

select is(
  (select calls_target from tmp_targets where agent_id = '000000000000000000000000000000d2'),
  72, 'admin_targets_vs_actuals falls back to the 72-calls/cycle default with no target row'
);
select is(
  (select min_calls_target from tmp_targets where agent_id = '000000000000000000000000000000d2'),
  7, 'admin_targets_vs_actuals surfaces min_calls_target for parity with the Goals page'
);
select is(
  (select calls_made from tmp_targets where agent_id = '000000000000000000000000000000d2'),
  3, 'admin_targets_vs_actuals reports the same actual calls as admin_activity_report'
);

-- ---------------------------------------------------------------------
-- report_definitions RLS: a leader cannot read or write; an admin can.
-- ---------------------------------------------------------------------
select tests.authenticate_as('000000000000000000000000000000d1'); -- leader
select throws_ok(
  $$insert into public.report_definitions (created_by, report_type, name)
    values ('000000000000000000000000000000d1', 'agent_roster', 'Leader attempt')$$
); -- a leader cannot insert a saved report

-- guard_agent_privileged_columns() rejects a role change made under an
-- authenticated, non-admin session (that's the point of the throws_ok
-- above) -- clear_authentication() first, same as every other role-flip in
-- 001_rls_and_hierarchy.sql's privilege-escalation section, so this update
-- runs as the unauthenticated superuser context instead.
select tests.clear_authentication();
update public.agents set role = 'admin' where id = '000000000000000000000000000000d1';
select tests.authenticate_as('000000000000000000000000000000d1'); -- now admin
select lives_ok(
  $$insert into public.report_definitions (id, created_by, report_type, name)
    values ('000000000000000000000000000000d4', '000000000000000000000000000000d1', 'agent_roster', 'Admin report')$$,
  'an admin can insert a saved report'
);
select is(
  (select count(*)::int from public.report_definitions where id = '000000000000000000000000000000d4'),
  1, 'the admin can read the saved report back'
);
select lives_ok(
  $$delete from public.report_definitions where id = '000000000000000000000000000000d4'$$,
  'an admin can delete a saved report'
);

select * from finish();
rollback;

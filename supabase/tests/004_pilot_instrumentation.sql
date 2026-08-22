-- pgTAP suite for P7 (supabase/migrations/20260821090000_p7a_pilot_instrumentation.sql):
-- admin_daily_active_loggers' access control and correctness.
--
-- Run with: supabase test db

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(6);

-- ---------------------------------------------------------------------
-- Seed: one org, one leader, one associate, one call logged today.
-- ---------------------------------------------------------------------
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000ee41', 'org_pilot_suite');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('pilot_suite_leader@example.com', '00000000-0000-0000-0000-00000000ee41', null, 'leader',    'seed-tok-q1', null),
  ('pilot_suite_assoc@example.com',  '00000000-0000-0000-0000-00000000ee41', null, 'associate', 'seed-tok-q2', null);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('000000000000000000000000000000c1', 'pilot_suite_leader@example.com', '{}', 'authenticated', 'authenticated'),
  ('000000000000000000000000000000c2', 'pilot_suite_assoc@example.com',  '{}', 'authenticated', 'authenticated');

update public.agents set upline_id = '000000000000000000000000000000c1'
  where id = '000000000000000000000000000000c2';

insert into public.contacts (id, agent_id, full_name) values
  ('000000000000000000000000000000c3', '000000000000000000000000000000c2', 'Pilot Suite Contact');
insert into public.call_logs (agent_id, contact_id, call_date, source, outcome) values
  ('000000000000000000000000000000c2', '000000000000000000000000000000c3', current_date, 'warm_market', 'connected');
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
-- Access control: neither an authenticated agent (even a leader) nor anon
-- can call this directly -- it's service-role only, same as the P6 admin
-- RPCs.
-- ---------------------------------------------------------------------
select tests.authenticate_as('000000000000000000000000000000c1'); -- leader
select is(
  has_function_privilege('authenticated', 'public.admin_daily_active_loggers(int)', 'EXECUTE'),
  false, 'authenticated (even a leader) has no EXECUTE on admin_daily_active_loggers'
);
select tests.clear_authentication();

select is(
  has_function_privilege('anon', 'public.admin_daily_active_loggers(int)', 'EXECUTE'),
  false, 'anon has no EXECUTE on admin_daily_active_loggers'
);

-- ---------------------------------------------------------------------
-- Correctness, called as service_role.
-- ---------------------------------------------------------------------
select tests.authenticate_as_service_role();
create temporary table tmp_pilot on commit drop as
  select * from public.admin_daily_active_loggers(10)
  where agent_id = '000000000000000000000000000000c2';
select tests.clear_authentication();

select is((select count(*)::int from tmp_pilot), 10, 'exactly 10 business-day rows for the associate');

select is(
  (select count(*)::int from tmp_pilot where extract(isodow from activity_date) >= 6), 0,
  'no weekend dates appear in the window'
);

select ok(
  (select logged from tmp_pilot where activity_date = current_date),
  'today is marked logged after logging a call'
);

select is(
  (select count(*)::int from tmp_pilot where logged), 1,
  'exactly one logged day in the window (today, the only one with activity)'
);

select * from finish();
rollback;

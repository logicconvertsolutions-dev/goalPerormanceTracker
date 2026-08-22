-- pgTAP suite for P5.5 (supabase/migrations/20260819090000_p55a_notifications.sql):
-- notification_log's rate-limit constraint + lockdown, and the two
-- service-role-only RPCs the cron job uses in place of the auth.uid()-scoped
-- ones (which don't work outside a real session).
--
-- Run with: supabase test db
--
-- Note on throws_ok: pgTAP overloads throws_ok(sql, X, ...) so that a text
-- X is matched against the raised error's MESSAGE, not its SQLSTATE (a
-- SQLSTATE match needs an explicit `character` cast, and even then Postgres
-- prefers the (text,text,text) message-matching overload over the
-- (text,character,text) one for a plain string literal -- confirmed against
-- a live pgTAP instance, not assumed). Rather than fight that overload
-- resolution, every assertion here uses the unambiguous 1-arg
-- throws_ok(sql) ("did it throw, full stop") with a diag() line for
-- context, and asserts the real SQLSTATE separately via a helper.

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(12);

-- Runs `sql`, returns true if it raised exactly `expected_sqlstate`, false
-- if it raised a different error, and re-raises if it didn't throw at all
-- (a silent success would be a false positive for "permission denied").
create or replace function tests.raises_sqlstate(p_sql text, p_expected text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected % but % did not raise', p_expected, p_sql;
exception when others then
  if sqlstate = p_expected then
    return true;
  end if;
  raise notice 'expected sqlstate %, got % (%)', p_expected, sqlstate, sqlerrm;
  return false;
end $$;

-- ---------------------------------------------------------------------
-- Seed: one org, one leader, one associate, one logged call today.
-- ---------------------------------------------------------------------
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000ee10', 'org_notifications');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('notif_leader@example.com', '00000000-0000-0000-0000-00000000ee10', null, 'leader',    'seed-tok-d1', null),
  ('notif_assoc@example.com',  '00000000-0000-0000-0000-00000000ee10', null, 'associate', 'seed-tok-d2', null);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'notif_leader@example.com', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'notif_assoc@example.com',  '{}', 'authenticated', 'authenticated');

update public.agents set full_name = 'Notif Leader' where id = '00000000-0000-0000-0000-0000000000d1';
update public.agents set full_name = 'Notif Assoc', upline_id = '00000000-0000-0000-0000-0000000000d1'
  where id = '00000000-0000-0000-0000-0000000000d2';
update public.organizations set owner_id = '00000000-0000-0000-0000-0000000000d1'
  where id = '00000000-0000-0000-0000-00000000ee10';

insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d2', 'Notif Contact');
insert into public.call_logs (agent_id, contact_id, call_date, source, outcome) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d3', current_date, 'warm_market', 'connected');
select public.drain_metrics(1000);

-- Impersonation helpers, same convention as 001/002 -- each test file
-- defines its own copy since every file runs as its own rolled-back
-- transaction under `supabase test db`.
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
grant execute on function tests.authenticate_as(uuid)             to authenticated, anon, service_role;
grant execute on function tests.authenticate_as_anon()             to authenticated, anon, service_role;
grant execute on function tests.authenticate_as_service_role()     to authenticated, anon, service_role;
grant execute on function tests.clear_authentication()             to authenticated, anon, service_role;
grant execute on function tests.raises_sqlstate(text, text)        to authenticated, anon, service_role;

-- ---------------------------------------------------------------------
-- notification_log: the unique index IS the rate limit.
-- ---------------------------------------------------------------------
select lives_ok(
  $$insert into public.notification_log (agent_id, kind, local_date)
    values ('00000000-0000-0000-0000-0000000000d2', 'evening_nudge', current_date)$$,
  'first send for (agent, kind, date) is recorded'
);
select ok(
  tests.raises_sqlstate(
    $$insert into public.notification_log (agent_id, kind, local_date)
      values ('00000000-0000-0000-0000-0000000000d2', 'evening_nudge', current_date)$$,
    '23505'
  ),
  'a second send for the same (agent, kind, date) is rejected by the unique index (23505)'
);
select lives_ok(
  $$insert into public.notification_log (agent_id, kind, local_date)
    values ('00000000-0000-0000-0000-0000000000d2', 'evening_nudge', current_date + 1)$$,
  'the same kind on a different local_date is a separate, allowed row'
);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000d2');
select ok(
  tests.raises_sqlstate($$select 1 from public.notification_log$$, '42501'),
  'an authenticated agent cannot read notification_log (no policies -- service role only)'
);
select tests.clear_authentication();

select tests.authenticate_as_anon();
select ok(
  tests.raises_sqlstate($$select 1 from public.notification_log$$, '42501'),
  'anon cannot read notification_log'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------
-- system_effective_target: service-role-only wrapper around
-- private.effective_target, used by the cron job (no auth.uid() session).
-- ---------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-0000-0000-0000000000d2');
select ok(
  tests.raises_sqlstate(
    $$select * from public.system_effective_target('00000000-0000-0000-0000-0000000000d2', current_date)$$,
    '42501'
  ),
  'an authenticated agent cannot call system_effective_target directly'
);
select tests.clear_authentication();

select tests.authenticate_as_anon();
select ok(
  tests.raises_sqlstate(
    $$select * from public.system_effective_target('00000000-0000-0000-0000-0000000000d2', current_date)$$,
    '42501'
  ),
  'anon cannot call system_effective_target'
);
select tests.clear_authentication();

select tests.authenticate_as_service_role();
select lives_ok(
  $$select * from public.system_effective_target('00000000-0000-0000-0000-0000000000d2', current_date)$$,
  'the service role can call system_effective_target'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------
-- system_team_week_summary: same shape as public.team_week_summary, minus
-- the auth.uid() scoping, for the cron job's Monday digest. Uses the
-- literal current_date, not public.week_start(current_date) -- week_start()
-- is itself granted only to `authenticated`, and evaluating it inline as
-- anon would throw its own 42501 before system_team_week_summary is ever
-- reached, testing the wrong function's grant. The exact date value doesn't
-- matter for a permission check.
-- ---------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-0000-0000-0000000000d1');
select ok(
  tests.raises_sqlstate(
    $$select * from public.system_team_week_summary('00000000-0000-0000-0000-0000000000d1', current_date)$$,
    '42501'
  ),
  'an authenticated leader cannot call system_team_week_summary directly'
);
select tests.clear_authentication();

select tests.authenticate_as_anon();
select ok(
  tests.raises_sqlstate(
    $$select * from public.system_team_week_summary('00000000-0000-0000-0000-0000000000d1', current_date)$$,
    '42501'
  ),
  'anon cannot call system_team_week_summary'
);
select tests.clear_authentication();

select tests.authenticate_as_service_role();
select lives_ok(
  $$select * from public.system_team_week_summary('00000000-0000-0000-0000-0000000000d1', current_date)$$,
  'the service role can call system_team_week_summary'
);
select tests.clear_authentication();

-- Consistency check: the service-role path and the auth.uid() path must
-- agree on the same leader/week, or the cron digest would quietly diverge
-- from what the SMD sees on /team. week_start() is computed once here,
-- still as `postgres`, and passed as a GUC -- week_start() itself is
-- granted only to `authenticated`, and service_role has no reason to need
-- it (system_team_week_summary takes the week boundary as a plain date).
select set_config('test.week_start', public.week_start(current_date)::text, true);

select tests.authenticate_as('00000000-0000-0000-0000-0000000000d1');
create temporary table tmp_via_session as
  select agent_id, calls_made from public.team_week_summary(current_setting('test.week_start')::date)
  where agent_id = '00000000-0000-0000-0000-0000000000d2';
select tests.clear_authentication();

select tests.authenticate_as_service_role();
create temporary table tmp_via_service as
  select agent_id, calls_made from public.system_team_week_summary(
    '00000000-0000-0000-0000-0000000000d1', current_setting('test.week_start')::date)
  where agent_id = '00000000-0000-0000-0000-0000000000d2';
select tests.clear_authentication();

select is(
  (select calls_made from tmp_via_service where agent_id = '00000000-0000-0000-0000-0000000000d2'),
  (select calls_made from tmp_via_session where agent_id = '00000000-0000-0000-0000-0000000000d2'),
  'system_team_week_summary agrees with team_week_summary for the same leader and week'
);

select * from finish();
rollback;

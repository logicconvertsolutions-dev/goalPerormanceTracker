-- pgTAP suite for P31 (20260924100000_p31_notifications_clear_and_appt_push_title.sql):
-- the bell's soft clear (notifications.cleared_at) and the appointment push
-- title naming the appointment type.
--
-- What must hold:
--   * an owner can clear their own notifications; nothing else on the row
--     becomes writable (rule 1: grants, not policies)
--   * nobody can clear someone else's -- not a peer in another org, not the
--     upline SMD (rules 2 and 8)
--   * a cleared notification is not re-created (and so not re-pushed) by the
--     next run of the job while its source is still due
--   * the appointment alert reads "<Type label> in N min" / "<Contact> · time"
--   * a claimed evening nudge also becomes one push-flagged bell row, only
--     while the "Evening nudge" setting is on
--
-- throws_ok is used in its 1-arg form throughout, same as 001/003/012.

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(14);

-- ---------------------------------------------------------------------
-- Seed: org_x (smd_x -> assoc_x), org_y (assoc_y)
-- ---------------------------------------------------------------------
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000031e1', 'p31_org_x'),
  ('00000000-0000-0000-0000-0000000031e2', 'p31_org_y');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('p31_smd_x@example.com',   '00000000-0000-0000-0000-0000000031e1', null, 'leader',    'p31-tok-1', null),
  ('p31_assoc_x@example.com', '00000000-0000-0000-0000-0000000031e1', null, 'associate', 'p31-tok-2', null),
  ('p31_assoc_y@example.com', '00000000-0000-0000-0000-0000000031e2', null, 'associate', 'p31-tok-3', null);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000031a1', 'p31_smd_x@example.com',   '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000031a2', 'p31_assoc_x@example.com', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000031b2', 'p31_assoc_y@example.com', '{}', 'authenticated', 'authenticated');

update public.agents set full_name = 'Smd X' where id = '00000000-0000-0000-0000-0000000031a1';
update public.agents set full_name = 'Assoc X', upline_id = '00000000-0000-0000-0000-0000000031a1'
  where id = '00000000-0000-0000-0000-0000000031a2';
update public.agents set full_name = 'Assoc Y' where id = '00000000-0000-0000-0000-0000000031b2';

insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000031c1', '00000000-0000-0000-0000-0000000031a2', 'Prospect X'),
  ('00000000-0000-0000-0000-0000000031c2', '00000000-0000-0000-0000-0000000031a2', 'Prospect Z');

-- Two appointments for assoc_x inside the 15-minute window: a known type and
-- a free-text legacy one.
insert into public.appointments (id, agent_id, contact_id, appt_type, status, set_on, scheduled_for, appt_date)
values
  ('00000000-0000-0000-0000-0000000031d1', '00000000-0000-0000-0000-0000000031a2',
   '00000000-0000-0000-0000-0000000031c1', 'marketing_presentation', 'scheduled',
   current_date, now() + interval '10 minutes', (now() + interval '10 minutes')::date),
  ('00000000-0000-0000-0000-0000000031d2', '00000000-0000-0000-0000-0000000031a2',
   '00000000-0000-0000-0000-0000000031c2', 'Coffee chat', 'scheduled',
   current_date, now() + interval '12 minutes', (now() + interval '12 minutes')::date);

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

grant usage on schema tests to authenticated, anon;
grant execute on function tests.authenticate_as(uuid) to authenticated, anon;
grant execute on function tests.clear_authentication() to authenticated, anon;

-- ---------------------------------------------------------------------
-- Schema + grants
-- ---------------------------------------------------------------------
select has_column('public', 'notifications', 'cleared_at', 'notifications.cleared_at exists');
select ok(has_column_privilege('authenticated', 'public.notifications', 'cleared_at', 'UPDATE'),
  'authenticated may update cleared_at');
select ok(not has_function_privilege('authenticated', 'private.enqueue_due_pushes()', 'execute'),
  'enqueue_due_pushes is still not callable by authenticated');

-- ---------------------------------------------------------------------
-- Appointment alert wording
-- ---------------------------------------------------------------------
select private.enqueue_due_pushes();

select ok((select title ~ '^Marketing Presentation in (9|10) min$' from public.notifications
            where source_key like 'appt15:00000000-0000-0000-0000-0000000031d1:%'),
  'appointment title names the type label');
select ok((select body like 'Prospect X · %' from public.notifications
            where source_key like 'appt15:00000000-0000-0000-0000-0000000031d1:%'),
  'appointment body is "<contact> · <time>"');
select ok((select title ~ '^Coffee chat in (11|12) min$' from public.notifications
            where source_key like 'appt15:00000000-0000-0000-0000-0000000031d2:%'),
  'a free-text legacy type shows as-is');

-- ---------------------------------------------------------------------
-- Clearing
-- ---------------------------------------------------------------------
-- Another org's associate and the upline SMD both try; RLS hides the rows,
-- so each update silently touches nothing.
select tests.authenticate_as('00000000-0000-0000-0000-0000000031b2');
update public.notifications set cleared_at = now();
select tests.authenticate_as('00000000-0000-0000-0000-0000000031a1');
update public.notifications set cleared_at = now();
select tests.clear_authentication();
select is((select count(*)::int from public.notifications
            where agent_id = '00000000-0000-0000-0000-0000000031a2' and cleared_at is not null),
  0, 'another org''s associate and the upline SMD clear nothing of assoc_x''s');

select tests.authenticate_as('00000000-0000-0000-0000-0000000031a2');
select lives_ok($$ update public.notifications set cleared_at = now(), read_at = now() $$,
  'owner can clear their notifications');
select throws_ok($$ update public.notifications set pushed_at = now() $$); -- still not writable

select tests.clear_authentication();
select is((select count(*)::int from public.notifications
            where agent_id = '00000000-0000-0000-0000-0000000031a2' and cleared_at is null),
  0, 'both notifications are cleared');

-- The appointments are still inside their window: a re-run must not bring
-- the cleared alerts back.
select private.enqueue_due_pushes();
select is((select count(*)::int from public.notifications
            where agent_id = '00000000-0000-0000-0000-0000000031a2' and kind = 'appointment'),
  2, 'a cleared alert is not re-created by the next run');

-- ---------------------------------------------------------------------
-- Evening nudge -> bell + push
-- ---------------------------------------------------------------------
-- Put both associates in a zone where it is 19:00-22:59 right now (the
-- nudge's window), whatever time the suite runs. assoc_y has the nudge off.
update public.agents set time_zone = (
  select name from pg_timezone_names
  where name ~ '^Etc/GMT[+-][0-9]+$'
    and extract(hour from now() at time zone name) between 19 and 22
  order by name limit 1)
where id in ('00000000-0000-0000-0000-0000000031a2', '00000000-0000-0000-0000-0000000031b2');
insert into public.notification_prefs (agent_id, evening_nudge) values ('00000000-0000-0000-0000-0000000031b2', false)
  on conflict (agent_id) do update set evening_nudge = false;

select private.enqueue_due_notifications();
select private.enqueue_due_notifications(); -- a second run claims nothing new

select is((select count(*)::int from public.notifications
            where agent_id = '00000000-0000-0000-0000-0000000031a2' and kind = 'evening_nudge' and push and link = '/log'),
  1, 'a claimed evening nudge becomes exactly one push-flagged bell row');
select is((select count(*)::int from public.notifications
            where agent_id = '00000000-0000-0000-0000-0000000031b2' and kind = 'evening_nudge'),
  0, 'no nudge row while the Evening nudge setting is off');

select private.enqueue_due_pushes();
select is((select count(*)::int from pgmq.q_push_sends q
            join public.notifications n on n.id = (q.message ->> 'notification_id')::uuid
            where n.kind = 'evening_nudge' and n.agent_id = '00000000-0000-0000-0000-0000000031a2'),
  1, 'the nudge row is queued for web push');

select * from finish();
rollback;

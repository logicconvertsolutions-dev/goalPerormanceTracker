-- pgTAP suite for P30 (20260923100000_p30_my_day_tasks_reminders_notifications.sql):
-- tasks, reminders, the notifications feed, push subscriptions and the
-- enqueue_due_pushes() delivery job.
--
-- What must hold:
--   * every table is owner-only -- an SMD sees nothing of a downline's rows
--     (CLAUDE.md rule 2) and nothing crosses orgs (rule 8)
--   * reminders.sent_at and everything on notifications except read_at are
--     not user-writable (rule 1: grants, not policies)
--   * push_subscriptions is unreadable by authenticated; the RPCs are the
--     only way in
--   * the job claims each due item exactly once, however often it runs
--
-- throws_ok is used in its 1-arg form throughout ("did it throw"), same as
-- 001/003 -- see the P6 note at the top of 001_rls_and_hierarchy.sql.

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(34);

-- ---------------------------------------------------------------------
-- Seed: org_x (smd_x -> assoc_x), org_y (assoc_y)
-- ---------------------------------------------------------------------
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000030e1', 'p30_org_x'),
  ('00000000-0000-0000-0000-0000000030e2', 'p30_org_y');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('p30_smd_x@example.com',   '00000000-0000-0000-0000-0000000030e1', null, 'leader',    'p30-tok-1', null),
  ('p30_assoc_x@example.com', '00000000-0000-0000-0000-0000000030e1', null, 'associate', 'p30-tok-2', null),
  ('p30_assoc_y@example.com', '00000000-0000-0000-0000-0000000030e2', null, 'associate', 'p30-tok-3', null);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000030a1', 'p30_smd_x@example.com',   '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000030a2', 'p30_assoc_x@example.com', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000030b2', 'p30_assoc_y@example.com', '{}', 'authenticated', 'authenticated');

update public.agents set full_name = 'Smd X' where id = '00000000-0000-0000-0000-0000000030a1';
update public.agents set full_name = 'Assoc X', upline_id = '00000000-0000-0000-0000-0000000030a1'
  where id = '00000000-0000-0000-0000-0000000030a2';
update public.agents set full_name = 'Assoc Y' where id = '00000000-0000-0000-0000-0000000030b2';

insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000030c1', '00000000-0000-0000-0000-0000000030a2', 'Prospect X'),
  ('00000000-0000-0000-0000-0000000030c2', '00000000-0000-0000-0000-0000000030b2', 'Prospect Y');

-- An appointment for assoc_x starting in 10 minutes -> the job's 15-minute alert.
insert into public.appointments (id, agent_id, contact_id, appt_type, status, set_on, scheduled_for, appt_date)
values ('00000000-0000-0000-0000-0000000030d1', '00000000-0000-0000-0000-0000000030a2',
        '00000000-0000-0000-0000-0000000030c1', 'solutions_presentation', 'scheduled',
        current_date, now() + interval '10 minutes', (now() + interval '10 minutes')::date);

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

grant usage on schema tests to authenticated, anon;
grant execute on function tests.authenticate_as(uuid) to authenticated, anon;
grant execute on function tests.authenticate_as_anon() to authenticated, anon;
grant execute on function tests.clear_authentication() to authenticated, anon;

-- ---------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.tasks'::regclass), 'tasks: RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.reminders'::regclass), 'reminders: RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.notifications'::regclass), 'notifications: RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass), 'push_subscriptions: RLS enabled');

select ok(not has_function_privilege('authenticated', 'private.enqueue_due_pushes()', 'execute'),
  'authenticated cannot run the delivery job');
select ok(not has_function_privilege('anon', 'public.save_push_subscription(text, text, text, text)', 'execute'),
  'anon cannot save a push subscription');

-- ---------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-0000-0000-0000000030a2');

select lives_ok($$
  insert into public.tasks (id, title, kind, due_on, contact_id)
  values ('00000000-0000-0000-0000-0000000030f1', 'Call Prospect X back', 'call', current_date,
          '00000000-0000-0000-0000-0000000030c1')
$$, 'owner can add a to-do linked to their own contact');

select is((select org_id from public.tasks where id = '00000000-0000-0000-0000-0000000030f1'),
  '00000000-0000-0000-0000-0000000030e1'::uuid, 'task org_id is stamped from the agent');

select throws_ok($$
  insert into public.tasks (title, due_on, contact_id)
  values ('Sneaky', current_date, '00000000-0000-0000-0000-0000000030c2')
$$); -- another agent's contact is rejected

select throws_ok($$
  insert into public.tasks (agent_id, title, due_on)
  values ('00000000-0000-0000-0000-0000000030b2', 'Planted', current_date)
$$); -- cannot create a task owned by someone else

select lives_ok($$ update public.tasks set done_at = now() where id = '00000000-0000-0000-0000-0000000030f1' $$,
  'owner can tick a to-do off');

select tests.authenticate_as('00000000-0000-0000-0000-0000000030a1');
select is((select count(*)::int from public.tasks), 0, 'upline SMD sees none of a downline''s to-dos');
update public.tasks set title = 'hijacked' where id = '00000000-0000-0000-0000-0000000030f1';

select tests.authenticate_as('00000000-0000-0000-0000-0000000030b2');
select is((select count(*)::int from public.tasks), 0, 'another org sees no to-dos');

select tests.clear_authentication();
select is((select title from public.tasks where id = '00000000-0000-0000-0000-0000000030f1'),
  'Call Prospect X back', 'upline update touched nothing');

-- ---------------------------------------------------------------------
-- reminders
-- ---------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-0000-0000-0000000030a2');

select lives_ok($$
  insert into public.reminders (id, title, remind_at, lead_minutes)
  values ('00000000-0000-0000-0000-0000000030f2', 'Send proposal', now() - interval '1 minute', 0)
$$, 'owner can create a reminder');

select throws_ok($$
  update public.reminders set sent_at = now() where id = '00000000-0000-0000-0000-0000000030f2'
$$); -- sent_at is not user-writable

select throws_ok($$
  insert into public.reminders (title, remind_at, sent_at) values ('Pre-sent', now(), now())
$$); -- nor on insert

select tests.authenticate_as('00000000-0000-0000-0000-0000000030a1');
select is((select count(*)::int from public.reminders), 0, 'upline SMD sees none of a downline''s reminders');

-- ---------------------------------------------------------------------
-- push subscriptions
-- ---------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-0000-0000-0000000030a2');

select lives_ok($$
  select public.save_push_subscription('https://push.example.com/abc', 'p256dh-key', 'auth-key', 'test-agent')
$$, 'owner can save a push subscription through the RPC');

select throws_ok($$ select count(*) from public.push_subscriptions $$); -- table itself is unreadable

select tests.clear_authentication();
select is((select agent_id from public.push_subscriptions where endpoint = 'https://push.example.com/abc'),
  '00000000-0000-0000-0000-0000000030a2'::uuid, 'subscription stored for the caller');

-- ---------------------------------------------------------------------
-- delivery job
-- ---------------------------------------------------------------------
select private.enqueue_due_pushes();

select is((select count(*)::int from public.notifications
            where agent_id = '00000000-0000-0000-0000-0000000030a2' and kind = 'reminder'),
  1, 'due reminder becomes one notification');
select isnt((select sent_at from public.reminders where id = '00000000-0000-0000-0000-0000000030f2'),
  null, 'job marks the reminder sent');
select is((select count(*)::int from public.notifications
            where agent_id = '00000000-0000-0000-0000-0000000030a2' and kind = 'appointment'),
  1, 'appointment starting within 15 minutes becomes one notification');

select private.enqueue_due_pushes();

select is((select count(*)::int from public.notifications
            where agent_id = '00000000-0000-0000-0000-0000000030a2' and kind in ('reminder', 'appointment')),
  2, 'second run claims nothing twice');
select ok((select count(*) <= 1 from public.notifications
            where agent_id = '00000000-0000-0000-0000-0000000030a2' and kind = 'morning_brief'),
  'at most one morning brief per agent-day');
select is((select count(*)::int from pgmq.q_push_sends q
            join public.notifications n on n.id = (q.message ->> 'notification_id')::uuid
            where n.agent_id = '00000000-0000-0000-0000-0000000030a2'),
  (select count(*)::int from public.notifications
     where agent_id = '00000000-0000-0000-0000-0000000030a2' and push),
  'each push-flagged notification is enqueued exactly once');

-- ---------------------------------------------------------------------
-- notifications feed
-- ---------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-0000-0000-0000000030a2');
select ok((select count(*) >= 2 from public.notifications), 'owner sees their notifications');
select lives_ok($$ update public.notifications set read_at = now() $$, 'owner can mark notifications read');
select throws_ok($$ update public.notifications set title = 'edited' $$); -- nothing else is writable
select throws_ok($$
  insert into public.notifications (agent_id, kind, title, source_key)
  values ('00000000-0000-0000-0000-0000000030a2', 'reminder', 'fake', 'fake:1')
$$); -- only the job writes the feed

-- moving a delivered reminder re-arms it
update public.reminders set remind_at = now() + interval '1 hour' where id = '00000000-0000-0000-0000-0000000030f2';
select is((select sent_at from public.reminders where id = '00000000-0000-0000-0000-0000000030f2'),
  null, 'rescheduling a delivered reminder re-arms it');

select tests.authenticate_as('00000000-0000-0000-0000-0000000030a1');
select is((select count(*)::int from public.notifications), 0, 'upline SMD sees none of a downline''s notifications');

select tests.authenticate_as_anon();
select throws_ok($$ select count(*) from public.tasks $$); -- anon has no access at all

select tests.clear_authentication();
select * from finish();
rollback;

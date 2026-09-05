-- pgTAP suite for P14a (supabase/migrations/20260905090000_p14a_bulk_
-- notification_pipeline.sql): the pgmq-backed queue and its service-role-
-- only RPC wrappers, plus notification_log's new status/attempts columns.
--
-- Deliberately NOT covered here: the actual day-of-week/local-hour
-- eligibility logic inside private.enqueue_due_notifications() (mirrors
-- the deleted src/lib/notifications/eligibility.test.ts). That logic is a
-- function of `now()`, and pgTAP has no clock-mocking primitive here --
-- forcing a specific isodow via a fabricated time zone offset can shift the
-- hour but not the day, so a reliable "evening_nudge fires on a weekday
-- evening" assertion isn't achievable without a live clock override.
-- Correctness there is validated by the parallel-run rollout plan (compare
-- this pipeline's sent counts against the old path's for several days
-- before retiring GitHub Actions' 15-minute schedule for the per-agent
-- kinds), not a unit test.
--
-- Run with: supabase test db

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(11);

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
-- Seed: one org, one associate (enough to exercise notification_log's
-- shape -- the queue/RPC tests below don't need real agent rows at all).
-- ---------------------------------------------------------------------
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000ee20', 'org_bulk_notifications');
insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('bulk_notif_assoc@example.com', '00000000-0000-0000-0000-00000000ee20', null, 'associate', 'seed-tok-e1', null);
insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'bulk_notif_assoc@example.com', '{}', 'authenticated', 'authenticated');
update public.agents set full_name = 'Bulk Notif Assoc' where id = '00000000-0000-0000-0000-0000000000e1';
update public.organizations set owner_id = '00000000-0000-0000-0000-0000000000e1'
  where id = '00000000-0000-0000-0000-00000000ee20';

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
-- notification_log: claim-time semantics, not confirmed-send semantics
-- (P14a's whole point -- enqueue claims the slot, the drain route confirms
-- delivery separately, possibly minutes later or on a retry).
-- ---------------------------------------------------------------------
insert into public.notification_log (agent_id, kind, local_date)
values ('00000000-0000-0000-0000-0000000000e1', 'evening_nudge', current_date);

select results_eq(
  $$select status from public.notification_log
    where agent_id = '00000000-0000-0000-0000-0000000000e1' and kind = 'evening_nudge' and local_date = current_date$$,
  $$values ('queued'::public.notification_send_status)$$,
  'a freshly-claimed notification_log row defaults to status = queued, not sent'
);
select results_eq(
  $$select attempts from public.notification_log
    where agent_id = '00000000-0000-0000-0000-0000000000e1' and kind = 'evening_nudge' and local_date = current_date$$,
  $$values (0)$$,
  'attempts defaults to 0'
);

-- ---------------------------------------------------------------------
-- enqueue_due_notifications(): private, service-role/definer-only --
-- nothing about "who's due for an email" should be triggerable by an
-- ordinary session.
-- ---------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-0000-0000-0000000000e1');
select ok(
  tests.raises_sqlstate($$select private.enqueue_due_notifications()$$, '42501'),
  'an authenticated agent cannot call enqueue_due_notifications directly'
);
select tests.clear_authentication();

select tests.authenticate_as_anon();
select ok(
  tests.raises_sqlstate($$select private.enqueue_due_notifications()$$, '42501'),
  'anon cannot call enqueue_due_notifications'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------
-- The three pg_cron trigger functions (private.ping_app_route and its two
-- callers): revoked from every client role, same as enqueue_due_
-- notifications above -- pg_cron calls these directly as the job owner,
-- never through PostgREST, so there is no legitimate client-session caller
-- at all, not even service_role.
-- ---------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-0000-0000-0000000000e1');
select ok(
  tests.raises_sqlstate($$select private.ping_app_route('/api/cron/notifications/drain')$$, '42501'),
  'an authenticated agent cannot call ping_app_route'
);
select ok(
  tests.raises_sqlstate($$select private.ping_notification_drain()$$, '42501'),
  'an authenticated agent cannot call ping_notification_drain'
);
select ok(
  tests.raises_sqlstate($$select private.ping_legacy_notifications()$$, '42501'),
  'an authenticated agent cannot call ping_legacy_notifications'
);
select tests.clear_authentication();

-- ---------------------------------------------------------------------
-- pgmq wrapper RPCs: service_role only (the drain route's admin client is
-- the only intended caller) -- an ordinary session has no business popping
-- or acking messages off the send queue.
-- ---------------------------------------------------------------------
select tests.authenticate_as('00000000-0000-0000-0000-0000000000e1');
select ok(
  tests.raises_sqlstate($$select * from public.pgmq_read('notification_sends', 30, 10)$$, '42501'),
  'an authenticated agent cannot call pgmq_read'
);
select tests.clear_authentication();

select tests.authenticate_as_anon();
select ok(
  tests.raises_sqlstate($$select * from public.pgmq_read('notification_sends', 30, 10)$$, '42501'),
  'anon cannot call pgmq_read'
);
select tests.clear_authentication();

-- Functional round-trip as service_role: send a message directly via pgmq
-- (as postgres, standing in for how enqueue_due_notifications() populates
-- the queue), then pop and ack it through the same wrapper RPCs the drain
-- route actually calls.
select pgmq.send('notification_sends', jsonb_build_object(
  'agent_id', '00000000-0000-0000-0000-0000000000e1', 'kind', 'evening_nudge', 'local_date', current_date
));

select tests.authenticate_as_service_role();
select is(
  (select count(*)::int from public.pgmq_read('notification_sends', 30, 10)
   where (message->>'agent_id')::uuid = '00000000-0000-0000-0000-0000000000e1'),
  1,
  'service_role can read the message back via the pgmq_read wrapper'
);

select ok(
  (select public.pgmq_delete('notification_sends', msg_id)
   from public.pgmq_read('notification_sends', 30, 10)
   where (message->>'agent_id')::uuid = '00000000-0000-0000-0000-0000000000e1'
   limit 1),
  'service_role can delete the message via the pgmq_delete wrapper'
);
select tests.clear_authentication();

select * from finish();
rollback;

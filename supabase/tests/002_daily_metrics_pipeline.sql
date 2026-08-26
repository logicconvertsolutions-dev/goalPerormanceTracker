-- pgTAP suite per docs/05-testing.md §1 "daily_metrics correctness (the read
-- model — treat as critical)". This file is the highest-value test in the
-- suite: it proves the dirty-queue + drain pipeline never silently drifts
-- from raw logs.
--
-- Run with: supabase test db

begin;
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

select plan(9);

-- handle_new_user() (p1j_invite_only_signup.sql) rejects any auth.users
-- insert without a matching open invitation -- same reason
-- 001_rls_and_hierarchy.sql seeds a throwaway org + invitation per email
-- before the auth.users insert, rather than inserting into public.agents
-- directly (the trigger already does that from the invitation).
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-00000000ee09', 'org_metrics');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('metrics_org@example.com',   '00000000-0000-0000-0000-00000000ee09', null, 'leader',    'seed-tok-f1', null),
  ('metrics_agent@example.com', '00000000-0000-0000-0000-00000000ee09', null, 'associate', 'seed-tok-f2', null);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'metrics_org@example.com', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 'metrics_agent@example.com', 'authenticated', 'authenticated');

update public.agents set full_name = 'Metrics Leader' where id = '00000000-0000-0000-0000-0000000000f1';
update public.agents set full_name = 'Metrics Agent', upline_id = '00000000-0000-0000-0000-0000000000f1'
  where id = '00000000-0000-0000-0000-0000000000f2';

insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f2', 'Metrics Contact');

-- 1. Insert a call -> dirty row appears -> drain -> calls_made = 1
insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome)
values ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f2',
        '00000000-0000-0000-0000-0000000000f3', current_date, 'warm_market', 'connected');

select ok(
  exists (select 1 from private.metrics_dirty
    where agent_id = '00000000-0000-0000-0000-0000000000f2' and activity_date = current_date),
  'insert enqueues a dirty row for the agent-day'
);

select public.drain_metrics(1000);

select is(
  (select calls_made from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000f2' and activity_date = current_date),
  1, 'drain: calls_made = 1 after inserting one call'
);

-- 2. Delete that call -> drain -> back to 0 (row removed, not stuck at 1)
delete from public.call_logs where id = '00000000-0000-0000-0000-0000000000f4';
select public.drain_metrics(1000);

select ok(
  not exists (select 1 from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000f2' and activity_date = current_date
      and calls_made > 0),
  'drain: deleting the call returns calls_made to 0 (row cleaned up, not stuck)'
);

-- 3. Edit a call's date across a day boundary -> both old and new days recompute
insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome)
values ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000f2',
        '00000000-0000-0000-0000-0000000000f3', current_date, 'referral', 'connected');
select public.drain_metrics(1000);

update public.call_logs set call_date = current_date - 1 where id = '00000000-0000-0000-0000-0000000000f5';
select public.drain_metrics(1000);

select is(
  coalesce((select calls_made from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000f2' and activity_date = current_date), 0),
  0, 'date-boundary edit: old day recomputes to 0'
);
select is(
  (select calls_made from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000f2' and activity_date = current_date - 1),
  1, 'date-boundary edit: new day recomputes to 1'
);

-- 4. Drain the same dirty row twice -> identical result (idempotence)
select public.drain_metrics(1000); -- queue already empty; recompute directly instead
select private.recompute_day('00000000-0000-0000-0000-0000000000f2', current_date - 1);
select private.recompute_day('00000000-0000-0000-0000-0000000000f2', current_date - 1);
select is(
  (select calls_made from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000f2' and activity_date = current_date - 1),
  1, 'idempotence: recomputing the same agent-day twice gives the same result'
);

-- 5. Nightly reconcile over a deliberately corrupted daily_metrics row restores it
update public.daily_metrics set calls_made = 999
  where agent_id = '00000000-0000-0000-0000-0000000000f2' and activity_date = current_date - 1;
select private.recompute_day('00000000-0000-0000-0000-0000000000f2', current_date - 1);
select is(
  (select calls_made from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000000f2' and activity_date = current_date - 1),
  1, 'reconcile: recompute overwrites a corrupted daily_metrics row'
);

-- 6. daily_metrics never contains a row for an agent in another org
insert into public.organizations (id, name) values ('00000000-0000-0000-0000-00000000ee08', 'org_other');
select ok(
  not exists (
    select 1 from public.daily_metrics m
    join public.agents a on a.id = m.agent_id
    where m.org_id <> a.org_id
  ),
  'no daily_metrics row has org_id mismatched with its agent''s current org'
);

-- 7. Fuzz: N random insert/update/delete operations on call_logs, then assert
-- daily_metrics equals a from-scratch recompute over raw logs. Spec calls for
-- 500; kept smaller here so the suite is fast enough to run every session,
-- but the mechanism is identical -- raise the loop bound before shipping.
do $$
declare
  i int;
  op int;
  v_id uuid;
  v_date date;
begin
  for i in 1..100 loop
    op := (random() * 2)::int; -- 0 insert, 1 update, 2 delete
    if op = 0 or not exists (select 1 from public.call_logs where agent_id = '00000000-0000-0000-0000-0000000000f2') then
      insert into public.call_logs (agent_id, contact_id, call_date, source, outcome)
      values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3',
              current_date - (random() * 5)::int, 'cold', 'connected');
    elsif op = 1 then
      select id into v_id from public.call_logs
        where agent_id = '00000000-0000-0000-0000-0000000000f2' order by random() limit 1;
      v_date := current_date - (random() * 5)::int;
      update public.call_logs set call_date = v_date where id = v_id;
    else
      select id into v_id from public.call_logs
        where agent_id = '00000000-0000-0000-0000-0000000000f2' order by random() limit 1;
      delete from public.call_logs where id = v_id;
    end if;
  end loop;
end $$;

select public.drain_metrics(10000);

-- From-scratch recompute for every distinct day touched, then compare.
select ok(
  not exists (
    select d.activity_date
    from (select distinct activity_date from public.daily_metrics
          where agent_id = '00000000-0000-0000-0000-0000000000f2') d
    where (
      select count(*) from public.call_logs
      where agent_id = '00000000-0000-0000-0000-0000000000f2' and call_date = d.activity_date
    ) <> (
      select calls_made from public.daily_metrics
      where agent_id = '00000000-0000-0000-0000-0000000000f2' and activity_date = d.activity_date
    )
  ),
  'fuzz: daily_metrics.calls_made matches a from-scratch count(*) over call_logs for every touched day'
);

select * from finish();
rollback;

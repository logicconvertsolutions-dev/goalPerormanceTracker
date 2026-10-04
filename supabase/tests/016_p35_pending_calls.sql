-- pgTAP suite for P35 (20261004100000_p35_pending_calls.sql): calls waiting
-- for an outcome.
--
-- What must hold:
--   * the agent can save, list and remove their own waiting calls;
--     phone/whatsapp only; only for their own contact
--   * a waiting call is not a call: nothing in call_logs or daily_metrics
--   * the same prompt closed twice saves one row (client_request_id)
--   * nobody can edit one (no UPDATE grant) -- it is finished by logging it
--   * the upline SMD, another org's associate and anon see none (rules 1,
--     2 and 8), and no SECURITY DEFINER function reads the table (rule 2)
--   * deleting the contact removes its waiting calls
--
-- throws_ok is used in its 1-arg form throughout, same as 001/003/012.

begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000035e1', 'p35_org_x'),
  ('00000000-0000-0000-0000-0000000035e2', 'p35_org_y');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('p35_smd_x@example.com',   '00000000-0000-0000-0000-0000000035e1', null, 'leader',    'p35-tok-1', null),
  ('p35_assoc_x@example.com', '00000000-0000-0000-0000-0000000035e1', null, 'associate', 'p35-tok-2', null),
  ('p35_assoc_y@example.com', '00000000-0000-0000-0000-0000000035e2', null, 'associate', 'p35-tok-3', null);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000035a1', 'p35_smd_x@example.com',   '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000035a2', 'p35_assoc_x@example.com', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000035b2', 'p35_assoc_y@example.com', '{}', 'authenticated', 'authenticated');

update public.agents set full_name = 'Smd X' where id = '00000000-0000-0000-0000-0000000035a1';
update public.agents set full_name = 'Assoc X', upline_id = '00000000-0000-0000-0000-0000000035a1'
  where id = '00000000-0000-0000-0000-0000000035a2';
update public.agents set full_name = 'Assoc Y' where id = '00000000-0000-0000-0000-0000000035b2';

insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000035c1', '00000000-0000-0000-0000-0000000035a2', 'Prospect X'),
  ('00000000-0000-0000-0000-0000000035c2', '00000000-0000-0000-0000-0000000035a2', 'Prospect Z'),
  ('00000000-0000-0000-0000-0000000035c9', '00000000-0000-0000-0000-0000000035b2', 'Prospect of Y');

-- ---------------------------------------------------------------------
-- Owner
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000035a2","role":"authenticated"}', true);

select lives_ok($$
  insert into public.pending_calls (id, contact_id, channel, call_date, client_request_id)
  values ('00000000-0000-0000-0000-0000000035f1', '00000000-0000-0000-0000-0000000035c1', 'phone', current_date - 1, 'req-1')
$$);
select is(
  (select org_id from public.pending_calls where id = '00000000-0000-0000-0000-0000000035f1'),
  '00000000-0000-0000-0000-0000000035e1'::uuid,
  'org_id is stamped from the agent'
);
select throws_ok($$
  insert into public.pending_calls (contact_id, channel, call_date, client_request_id)
  values ('00000000-0000-0000-0000-0000000035c1', 'phone', current_date - 1, 'req-1')
$$);
select throws_ok($$
  insert into public.pending_calls (contact_id, channel, call_date)
  values ('00000000-0000-0000-0000-0000000035c1', 'sms', current_date)
$$);
select throws_ok($$
  insert into public.pending_calls (contact_id, channel, call_date)
  values ('00000000-0000-0000-0000-0000000035c9', 'phone', current_date)
$$);
select throws_ok($$
  update public.pending_calls set call_date = current_date where id = '00000000-0000-0000-0000-0000000035f1'
$$);

reset role;
select is(
  (select count(*) from public.call_logs where agent_id = '00000000-0000-0000-0000-0000000035a2'),
  0::bigint,
  'a waiting call is not a call_logs row'
);
select is(
  (select count(*) from private.metrics_dirty where agent_id = '00000000-0000-0000-0000-0000000035a2'),
  0::bigint,
  'and marks no day for the read model'
);
set local role authenticated;

-- ---------------------------------------------------------------------
-- Upline SMD, another org, anon
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000035a1","role":"authenticated"}', true);
select is((select count(*) from public.pending_calls), 0::bigint, 'the upline SMD sees no waiting calls');
delete from public.pending_calls where id = '00000000-0000-0000-0000-0000000035f1';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000035b2","role":"authenticated"}', true);
select is((select count(*) from public.pending_calls), 0::bigint, 'an associate in another org sees none');

reset role;
set local role anon;
select throws_ok($$ select count(*) from public.pending_calls $$);
reset role;

select is(
  (select count(*) from public.pending_calls where id = '00000000-0000-0000-0000-0000000035f1'),
  1::bigint,
  'the SMD''s delete removed nothing'
);

-- ---------------------------------------------------------------------
-- Removing: by the owner ("I didn't make this call"), and with the contact
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000035a2","role":"authenticated"}', true);
delete from public.pending_calls where id = '00000000-0000-0000-0000-0000000035f1';
select is((select count(*) from public.pending_calls), 0::bigint, 'the owner can remove a waiting call');

insert into public.pending_calls (contact_id, channel, call_date)
values ('00000000-0000-0000-0000-0000000035c2', 'whatsapp', current_date);
delete from public.contacts where id = '00000000-0000-0000-0000-0000000035c2';
select is((select count(*) from public.pending_calls), 0::bigint, 'deleting the contact removes its waiting calls');
reset role;

select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and p.prosrc ilike '%pending_calls%'),
  0::bigint,
  'no SECURITY DEFINER function reads pending_calls'
);

select * from finish();
rollback;

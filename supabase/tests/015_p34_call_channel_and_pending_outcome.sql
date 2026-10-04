-- pgTAP suite for P34 (20260928110000_p34_call_channel_and_pending_outcome.sql),
-- as amended by P35 (20261004100000_p35_pending_calls.sql).
--
-- P34 added call_logs.channel and briefly let outcome be null ("Outcome
-- needed"). P35 moved calls waiting for an outcome into pending_calls (pgTAP
-- 016) and made outcome required again. What must hold now:
--   * a call can be tagged phone/whatsapp; any other channel is refused
--   * a call with no outcome is refused -- every call_logs row is a
--     completed call
--   * the upline SMD reads none of it (rules 1, 2 and 8)
--
-- throws_ok is used in its 1-arg form throughout, same as 001/003/012.

begin;
create extension if not exists pgtap with schema extensions;

select plan(5);

insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000034e1', 'p34_org_x');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('p34_smd_x@example.com',   '00000000-0000-0000-0000-0000000034e1', null, 'leader',    'p34-tok-1', null),
  ('p34_assoc_x@example.com', '00000000-0000-0000-0000-0000000034e1', null, 'associate', 'p34-tok-2', null);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000034a1', 'p34_smd_x@example.com',   '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000034a2', 'p34_assoc_x@example.com', '{}', 'authenticated', 'authenticated');

update public.agents set full_name = 'Smd X' where id = '00000000-0000-0000-0000-0000000034a1';
update public.agents set full_name = 'Assoc X', upline_id = '00000000-0000-0000-0000-0000000034a1'
  where id = '00000000-0000-0000-0000-0000000034a2';

insert into public.contacts (id, agent_id, full_name, phone_number) values
  ('00000000-0000-0000-0000-0000000034c1', '00000000-0000-0000-0000-0000000034a2', 'Prospect X', '+14165550123');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000034a2","role":"authenticated"}', true);

select lives_ok($$
  insert into public.call_logs (agent_id, contact_id, call_date, source, outcome, channel)
  values ('00000000-0000-0000-0000-0000000034a2', '00000000-0000-0000-0000-0000000034c1',
          current_date, 'warm_market', 'connected', 'whatsapp')
$$);
select lives_ok($$
  insert into public.call_logs (agent_id, contact_id, call_date, source, outcome)
  values ('00000000-0000-0000-0000-0000000034a2', '00000000-0000-0000-0000-0000000034c1',
          current_date, 'warm_market', 'voicemail')
$$);
select throws_ok($$
  insert into public.call_logs (agent_id, contact_id, call_date, source, outcome, channel)
  values ('00000000-0000-0000-0000-0000000034a2', '00000000-0000-0000-0000-0000000034c1',
          current_date, 'warm_market', 'connected', 'sms')
$$);
select throws_ok($$
  insert into public.call_logs (agent_id, contact_id, call_date, source, outcome, channel)
  values ('00000000-0000-0000-0000-0000000034a2', '00000000-0000-0000-0000-0000000034c1',
          current_date, 'warm_market', null, 'phone')
$$);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000034a1","role":"authenticated"}', true);
select is(
  (select count(*) from public.call_logs where agent_id = '00000000-0000-0000-0000-0000000034a2'),
  0::bigint,
  'the upline SMD reads none of the downline''s calls or their channel'
);

select * from finish();
rollback;

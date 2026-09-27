-- pgTAP suite for P34 (20260928110000_p34_call_channel_and_pending_outcome.sql):
-- call_logs.channel and the nullable outcome behind "Outcome needed".
--
-- What must hold:
--   * an agent can save an attempt with no outcome, tagged phone/whatsapp;
--     any other channel is refused
--   * the attempt counts as a call made on its day, in no outcome bucket
--   * filling the outcome in later fills the bucket without changing
--     calls_made or the day (rule 12)
--   * the upline SMD reads none of it (rules 1, 2 and 8)
--
-- throws_ok is used in its 1-arg form throughout, same as 001/003/012.

begin;
create extension if not exists pgtap with schema extensions;

select plan(10);

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

-- ---------------------------------------------------------------------
-- The associate saves an attempt with no outcome
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000034a2","role":"authenticated"}', true);

select lives_ok($$
  insert into public.call_logs (id, agent_id, contact_id, call_date, source, outcome, channel)
  values ('00000000-0000-0000-0000-0000000034f1', '00000000-0000-0000-0000-0000000034a2',
          '00000000-0000-0000-0000-0000000034c1', current_date - 1, 'warm_market', null, 'phone')
$$);
select lives_ok($$
  insert into public.call_logs (agent_id, contact_id, call_date, source, outcome, channel)
  values ('00000000-0000-0000-0000-0000000034a2', '00000000-0000-0000-0000-0000000034c1',
          current_date - 1, 'warm_market', 'connected', 'whatsapp')
$$);
select throws_ok($$
  insert into public.call_logs (agent_id, contact_id, call_date, source, outcome, channel)
  values ('00000000-0000-0000-0000-0000000034a2', '00000000-0000-0000-0000-0000000034c1',
          current_date - 1, 'warm_market', 'connected', 'sms')
$$);

-- ---------------------------------------------------------------------
-- The upline SMD sees no call rows at all
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000034a1","role":"authenticated"}', true);
select is(
  (select count(*) from public.call_logs where agent_id = '00000000-0000-0000-0000-0000000034a2'),
  0::bigint,
  'the upline SMD reads none of the downline''s calls, outcome or channel'
);
reset role;

-- ---------------------------------------------------------------------
-- Read model
-- ---------------------------------------------------------------------
select private.recompute_day('00000000-0000-0000-0000-0000000034a2', current_date - 1);

select is(
  (select calls_made from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000034a2' and activity_date = current_date - 1),
  2,
  'an attempt with no outcome still counts as a call made'
);
select is(
  (select out_connected + out_voicemail + out_no_answer + out_appt_set + out_not_interested
     from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000034a2' and activity_date = current_date - 1),
  1,
  'it sits in no outcome bucket while the outcome is missing'
);

update public.call_logs set outcome = 'no_answer' where id = '00000000-0000-0000-0000-0000000034f1';
select is(
  (select count(*) from private.metrics_dirty
    where agent_id = '00000000-0000-0000-0000-0000000034a2' and activity_date = current_date - 1),
  1::bigint,
  'filling the outcome in re-marks the day'
);
select private.recompute_day('00000000-0000-0000-0000-0000000034a2', current_date - 1);

select is(
  (select out_no_answer from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000034a2' and activity_date = current_date - 1),
  1,
  'the filled-in outcome lands in its bucket'
);
select is(
  (select calls_made from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000034a2' and activity_date = current_date - 1),
  2,
  'calls_made is unchanged by filling the outcome in'
);
select is(
  (select count(*) from public.daily_metrics
    where agent_id = '00000000-0000-0000-0000-0000000034a2' and activity_date <> current_date - 1),
  0::bigint,
  'and nothing moved to another day'
);

select * from finish();
rollback;

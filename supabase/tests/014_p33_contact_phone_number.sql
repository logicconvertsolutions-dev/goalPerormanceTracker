-- pgTAP suite for P33 (20260928100000_p33_contact_phone_number.sql):
-- contacts.phone_number.
--
-- What must hold:
--   * the owner can store, read and clear a number (E.164 only)
--   * a number without a country code, with letters or spaces, or of the
--     wrong length is refused by the database, not just the form
--   * the upline SMD, an associate in another org and anon read nothing --
--     no contact row, so no number (rules 1, 2 and 8)
--   * nobody but the owner can write one
--   * no SECURITY DEFINER function in public/private reads phone_number,
--     so no RPC can carry it across the hierarchy boundary (rule 2)
--
-- throws_ok is used in its 1-arg form throughout, same as 001/003/012.

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- ---------------------------------------------------------------------
-- Seed: org_x (smd_x -> assoc_x), org_y (assoc_y)
-- ---------------------------------------------------------------------
insert into public.organizations (id, name) values
  ('00000000-0000-0000-0000-0000000033e1', 'p33_org_x'),
  ('00000000-0000-0000-0000-0000000033e2', 'p33_org_y');

insert into public.invitations (email, org_id, upline_id, role, token_hash, created_by) values
  ('p33_smd_x@example.com',   '00000000-0000-0000-0000-0000000033e1', null, 'leader',    'p33-tok-1', null),
  ('p33_assoc_x@example.com', '00000000-0000-0000-0000-0000000033e1', null, 'associate', 'p33-tok-2', null),
  ('p33_assoc_y@example.com', '00000000-0000-0000-0000-0000000033e2', null, 'associate', 'p33-tok-3', null);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
  ('00000000-0000-0000-0000-0000000033a1', 'p33_smd_x@example.com',   '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000033a2', 'p33_assoc_x@example.com', '{}', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000033b2', 'p33_assoc_y@example.com', '{}', 'authenticated', 'authenticated');

update public.agents set full_name = 'Smd X' where id = '00000000-0000-0000-0000-0000000033a1';
update public.agents set full_name = 'Assoc X', upline_id = '00000000-0000-0000-0000-0000000033a1'
  where id = '00000000-0000-0000-0000-0000000033a2';
update public.agents set full_name = 'Assoc Y' where id = '00000000-0000-0000-0000-0000000033b2';

insert into public.contacts (id, agent_id, full_name) values
  ('00000000-0000-0000-0000-0000000033c1', '00000000-0000-0000-0000-0000000033a2', 'Prospect X');

-- ---------------------------------------------------------------------
-- Owner
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000033a2","role":"authenticated"}', true);

select lives_ok(
  $$ update public.contacts set phone_number = '+14165550123' where id = '00000000-0000-0000-0000-0000000033c1' $$
);
select is(
  (select phone_number from public.contacts where id = '00000000-0000-0000-0000-0000000033c1'),
  '+14165550123',
  'the owner reads back their contact''s number'
);
select lives_ok(
  $$ insert into public.contacts (agent_id, full_name, phone_number)
     values ('00000000-0000-0000-0000-0000000033a2', 'Prospect UK', '+447911123456') $$
);

select throws_ok($$ update public.contacts set phone_number = '4165550123' where id = '00000000-0000-0000-0000-0000000033c1' $$);
select throws_ok($$ update public.contacts set phone_number = '+1 416 555 0123' where id = '00000000-0000-0000-0000-0000000033c1' $$);
select throws_ok($$ update public.contacts set phone_number = '+1416555abcd' where id = '00000000-0000-0000-0000-0000000033c1' $$);
select throws_ok($$ update public.contacts set phone_number = '+0165550123' where id = '00000000-0000-0000-0000-0000000033c1' $$);
select throws_ok($$ update public.contacts set phone_number = '+1234567' where id = '00000000-0000-0000-0000-0000000033c1' $$);

select lives_ok(
  $$ update public.contacts set phone_number = null where id = '00000000-0000-0000-0000-0000000033c1' $$
);
update public.contacts set phone_number = '+14165550123' where id = '00000000-0000-0000-0000-0000000033c1';

-- ---------------------------------------------------------------------
-- Upline SMD: no row, no number, no write
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000033a1","role":"authenticated"}', true);
select is(
  (select count(*) from public.contacts where phone_number is not null),
  0::bigint,
  'the upline SMD cannot read a downline contact''s number'
);
update public.contacts set phone_number = '+19995550000' where id = '00000000-0000-0000-0000-0000000033c1';

-- ---------------------------------------------------------------------
-- Another org's associate
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000033b2","role":"authenticated"}', true);
select is(
  (select count(*) from public.contacts where phone_number is not null),
  0::bigint,
  'an associate in another org cannot read the number'
);

-- ---------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------
reset role;
set local role anon;
select is(
  (select count(*) from public.contacts),
  0::bigint,
  'anon reads no contacts'
);
reset role;

select is(
  (select phone_number from public.contacts where id = '00000000-0000-0000-0000-0000000033c1'),
  '+14165550123',
  'the SMD''s update touched nothing'
);

-- ---------------------------------------------------------------------
-- No definer function reads the column
-- ---------------------------------------------------------------------
select is(
  (select count(*)
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and p.prosrc ilike '%phone_number%'),
  0::bigint,
  'no SECURITY DEFINER function in public/private reads contacts.phone_number'
);

select * from finish();
rollback;
